/**
 * Session 上下文构建器。
 *
 * 职责:把 session 树形 entries 转换为:
 * 1. `buildContextEntries` — 压缩感知后的 entry 列表
 * 2. `buildSessionContext` — AgentMessage[] + 派生 state(thinkingLevel / model / activeToolNames)
 * 3. 单 entry → messages 的转换函数 `sessionEntryToContextMessages`
 *
 * 与 session.ts 的关系:
 * - session.ts 持有 storage + 调用本模块
 * - 本模块是**纯函数**集合,无副作用,易测
 *
 * 拆分理由(plan § 4.4 决策):
 * - buildContextEntries / buildContext 是"派生 messages",与"append 到树"职责不同
 * - 这两个函数是公开的纯函数,外部可直接 import(测试和 tool 集成场景)
 *
 * 压缩感知逻辑:
 * - 从 leaf 沿 parentId 链回溯时,找到"最后一条 compaction entry"
 * - compaction 之前的 entries 只保留 firstKeptEntryId 之后的部分
 * - compaction 之后的 entries 全部保留(它们是"压缩之后的新增")
 */

import type { ImageContent, TextContent } from "@mimi/ai";
import type { AgentMessage } from "../../types.js";
import type {
  CompactionEntry,
  CustomEntry,
  SessionContext,
  SessionTreeEntry,
} from "./types.js";

// ── 自定义 entry 投影器类型 ──

/** 把一条 entry 链转换为新链的 transform */
export type ContextEntryTransform = (
  entries: readonly SessionTreeEntry[],
) => readonly SessionTreeEntry[];

/** 把一个 custom entry 投影为 AgentMessage 列表 */
export type CustomEntryContextMessageProjector = (
  entry: CustomEntry,
  index: number,
  entries: readonly SessionTreeEntry[],
) => readonly AgentMessage[] | undefined;

/** buildContext 选项 */
export interface SessionContextBuildOptions {
  /** 默认压缩 transform 之后的额外 transforms */
  entryTransforms?: readonly ContextEntryTransform[];
  /** custom entry → messages 投影器;未提供时不进 context */
  entryProjectors?: Readonly<Record<string, CustomEntryContextMessageProjector>>;
}

// ── 派生 state(从路径上各 entry 收集) ──

/**
 * 从 leaf → root 路径上派生的会话状态(不含 messages)。
 *
 * 取值规则(对每种 entry,后写入的覆盖先写入的):
 * - thinking_level_change → thinkingLevel
 * - model_change → model
 * - message(assistant) → model(从 message.provider / model 字段取)
 * - active_tools_change → activeToolNames
 */
function deriveSessionContextState(
  pathEntries: readonly SessionTreeEntry[],
): Omit<SessionContext, "messages"> {
  let thinkingLevel = "off";
  let model: { provider: string; modelId: string } | null = null;
  let activeToolNames: string[] | null = null;

  for (const entry of pathEntries) {
    if (entry.type === "thinking_level_change") {
      thinkingLevel = entry.thinkingLevel;
    } else if (entry.type === "model_change") {
      model = { provider: entry.provider, modelId: entry.modelId };
    } else if (entry.type === "message" && entry.message.role === "assistant") {
      model = {
        provider: entry.message.provider,
        modelId: entry.message.model,
      };
    } else if (entry.type === "active_tools_change") {
      activeToolNames = [...entry.activeToolNames];
    }
  }

  return { thinkingLevel, model, activeToolNames };
}

// ── 压缩感知 transform ──

/**
 * 默认的"压缩感知"entry transform。
 *
 * 行为:
 * 1. 找到路径上**最后一条** compaction entry
 * 2. 若无 compaction:返回完整 pathEntries
 * 3. 若有 compaction:返回 [compaction] + [compaction 前但 firstKeptEntryId 之后的部分] + [compaction 后的部分]
 *
 * 举例:
 *   path: [A, B, C, compaction, E, F]
 *   firstKeptEntryId = C
 *   → result: [compaction, C, E, F]  (A 和 B 被压缩掉)
 */
export function defaultContextEntryTransform(
  pathEntries: readonly SessionTreeEntry[],
): SessionTreeEntry[] {
  // 找最后一条 compaction
  let compaction: CompactionEntry | null = null;
  for (const entry of pathEntries) {
    if (entry.type === "compaction") {
      compaction = entry;
    }
  }
  if (!compaction) {
    return [...pathEntries];
  }

  // 压缩 = [compaction] + [compaction 之前,firstKeptEntryId 之后] + [compaction 之后]
  const entries: SessionTreeEntry[] = [compaction];
  const compactionIdx = pathEntries.findIndex(
    (entry) => entry.type === "compaction" && entry.id === compaction.id,
  );
  let foundFirstKept = false;
  for (let i = 0; i < compactionIdx; i++) {
    const entry = pathEntries[i]!;
    if (entry.id === compaction.firstKeptEntryId) foundFirstKept = true;
    if (foundFirstKept) entries.push(entry);
  }
  for (let i = compactionIdx + 1; i < pathEntries.length; i++) {
    entries.push(pathEntries[i]!);
  }
  return entries;
}

// ── 公开 API ──

/**
 * 构造 buildContext 的 entries(经过默认压缩 transform + 调用方 transforms)。
 */
export function buildContextEntries(
  pathEntries: readonly SessionTreeEntry[],
  options: SessionContextBuildOptions = {},
): SessionTreeEntry[] {
  let entries = defaultContextEntryTransform(pathEntries);
  for (const transform of options.entryTransforms ?? []) {
    entries = [...transform(entries)];
  }
  return entries;
}

/**
 * 把单条 entry 转为 AgentMessage 列表(用于 buildSessionContext 的 flatMap 阶段)。
 *
 * 行为:
 * - message entry → [entry.message]
 * - custom_message → [createCustomMessage 风格的 AgentMessage(由调用方 build)]
 *   注:这里直接构造一个 role=custom 的 AgentMessage;
 *   实际项目可由 buildAssistantMessage / getDefaultCustomProjector 投影
 * - compaction → [compaction_summary 消息]
 * - branch_summary(有 summary) → [branch_summary 消息]
 * - custom → [options.entryProjectors?.[customType]?.(entry) ?? []]
 * - 其他:跳过
 */
export function sessionEntryToContextMessages(
  entry: SessionTreeEntry,
  _index: number,
  _entries: readonly SessionTreeEntry[],
  options: SessionContextBuildOptions = {},
): AgentMessage[] {
  if (entry.type === "message") {
    return [entry.message as AgentMessage];
  }
  if (entry.type === "compaction") {
    return [
      {
        role: "custom",
        customType: "compaction_summary",
        content: entry.summary,
        details: { tokensBefore: entry.tokensBefore },
        display: true,
        timestamp: new Date(entry.timestamp).getTime(),
      } as unknown as AgentMessage,
    ];
  }
  if (entry.type === "branch_summary" && entry.summary) {
    return [
      {
        role: "custom",
        customType: "branch_summary",
        content: entry.summary,
        details: { fromId: entry.fromId },
        display: true,
        timestamp: new Date(entry.timestamp).getTime(),
      } as unknown as AgentMessage,
    ];
  }
  if (entry.type === "custom") {
    return [
      ...(options.entryProjectors?.[entry.customType]?.(entry, _index, _entries) ?? []),
    ];
  }
  return [];
}

/**
 * 构造 SessionContext:从 leaf → root 路径上派生 state + messages。
 */
export function buildSessionContext(
  pathEntries: readonly SessionTreeEntry[],
  options: SessionContextBuildOptions = {},
): SessionContext {
  const state = deriveSessionContextState(pathEntries);
  const contextEntries = buildContextEntries(pathEntries, options);
  const messages = contextEntries.flatMap((entry, index) =>
    sessionEntryToContextMessages(entry, index, contextEntries, options),
  );
  return { ...state, messages };
}
