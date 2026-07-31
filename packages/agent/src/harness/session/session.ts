/**
 * Session 主类 + 树形 entry 操作 + 上下文构建。
 *
 * 职责:
 * 1. 持有 SessionStorage(内存/JSONL 两种实现)
 * 2. 提供 appendXxx 便捷方法(appendMessage / appendCompaction / appendCustomEntry 等)
 * 3. 树形管理:getLeafId / setLeafId / getBranch
 * 4. 上下文构建:buildContextEntries(压缩感知) + buildContext(派生 SessionContext)
 * 5. 分支操作:moveTo(切换 leaf + 写 branch_summary)
 *
 * 设计要点:
 * - **fork 合入本类**:fork 是 session 的一个方法,操作 session 内部状态(entries + leaf),
 *   拆到独立 fork.ts 后读代码要跳两个文件;预估 350 行,远低于 500 软上限。
 * - **不依赖具体 storage**:通过 SessionStorage 接口交互,
 *   内存和 JSONL 后端共享同一行为
 * - **appendXxx 内部用 appendTypedEntry 复用公共逻辑**
 *
 * 拆分动机(plan § 4.4 决策):
 * - session.ts + fork 合并,因为 fork 强耦合 session 内部状态
 * - context-builder.ts 单独:buildContextEntries / buildContext 涉及"派生 messages",
 *   与"append 到树"职责不同(读 / 写分离)
 */

import type { ImageContent, TextContent } from "@mimi/ai";
import type { AgentMessage } from "../../types.js";
import type { SessionStorage } from "./storage.js";
import type {
  ActiveToolsChangeEntry,
  BranchSummaryEntry,
  CompactionEntry,
  CustomEntry,
  CustomMessageEntry,
  LabelEntry,
  MessageEntry,
  ModelChangeEntry,
  SessionContext,
  SessionMetadata,
  SessionTreeEntry,
  ThinkingLevelChangeEntry,
} from "./types.js";
import { SessionError } from "./types.js";
import {
  buildContextEntries,
  buildSessionContext,
  type ContextEntryTransform,
  type CustomEntryContextMessageProjector,
  defaultContextEntryTransform,
  sessionEntryToContextMessages,
} from "./context-builder.js";

// 重新导出 context-builder 的类型,方便使用方
export type { ContextEntryTransform, CustomEntryContextMessageProjector } from "./context-builder.js";

/** buildContext 选项:可注入 entry transform / custom projector */
export interface SessionContextBuildOptions {
  /** 额外的 entry transform(在默认压缩 transform 之后应用) */
  entryTransforms?: readonly ContextEntryTransform[];
  /** custom entry → AgentMessage 投影器;未提供时 custom entry 不进入 context */
  entryProjectors?: Readonly<Record<string, CustomEntryContextMessageProjector>>;
}

// ── Session 主类 ──

/**
 * Session 树形 entry 视图 + 操作入口。
 *
 * 通过 `SessionStorage` 接口与具体后端解耦:
 * - 测试场景:用 InMemorySessionStorage
 * - 生产场景:用 JsonlSessionStorage(持久化到 JSONL 文件)
 *
 * 不在构造时立即 await storage(构造同步),所有方法 async。
 */
export class Session<
  TMetadata extends SessionMetadata = SessionMetadata,
> {
  protected storage: SessionStorage<TMetadata>;
  protected contextBuildOptions: SessionContextBuildOptions;

  constructor(
    storage: SessionStorage<TMetadata>,
    contextBuildOptions: SessionContextBuildOptions = {},
  ) {
    this.storage = storage;
    this.contextBuildOptions = contextBuildOptions;
  }

  // ── 基础查询 ──

  /** 获取元数据 */
  getMetadata(): Promise<TMetadata> {
    return this.storage.getMetadata();
  }

  /** 获取底层 storage(给 repo 的 fork 用) */
  getStorage(): SessionStorage<TMetadata> {
    return this.storage;
  }

  /** 获取当前 leaf id */
  getLeafId(): Promise<string | null> {
    return this.storage.getLeafId();
  }

  /** 按 id 查询 entry */
  getEntry(id: string): Promise<SessionTreeEntry | undefined> {
    return this.storage.getEntry(id);
  }

  /** 获取所有 entries(返回拷贝) */
  getEntries(): Promise<SessionTreeEntry[]> {
    return this.storage.getEntries();
  }

  /**
   * 从 leaf 沿 parentId 链回溯到 root。
   * @param fromId 指定起点(默认 = 当前 leaf)
   */
  async getBranch(fromId?: string): Promise<SessionTreeEntry[]> {
    const leafId = fromId ?? (await this.storage.getLeafId());
    return this.storage.getPathToRoot(leafId);
  }

  // ── 上下文构建 ──

  /**
   * 构建当前 leaf 的 entry 链(经过压缩感知 transform)。
   */
  async buildContextEntries(
    options: SessionContextBuildOptions = {},
  ): Promise<SessionTreeEntry[]> {
    return buildContextEntries(
      await this.getBranch(),
      this.mergeContextBuildOptions(options),
    );
  }

  /**
   * 构建当前 leaf 的完整 SessionContext(messages + 派生 state)。
   */
  async buildContext(
    options: SessionContextBuildOptions = {},
  ): Promise<SessionContext> {
    return buildSessionContext(
      await this.getBranch(),
      this.mergeContextBuildOptions(options),
    );
  }

  /**
   * 合并默认 options + 调用方 options。
   * - entryTransforms:默认 + 调用方(按顺序叠加)
   * - entryProjectors:默认 + 调用方(后者覆盖前者同名 key)
   */
  protected mergeContextBuildOptions(
    options: SessionContextBuildOptions,
  ): SessionContextBuildOptions {
    return {
      entryTransforms: [
        ...(this.contextBuildOptions.entryTransforms ?? []),
        ...(options.entryTransforms ?? []),
      ],
      entryProjectors: {
        ...(this.contextBuildOptions.entryProjectors ?? {}),
        ...(options.entryProjectors ?? {}),
      },
    };
  }

  // ── 标签 / Session 名 ──

  getLabel(id: string): Promise<string | undefined> {
    return this.storage.getLabel(id);
  }

  /**
   * 获取 session 名称(最近一条 session_info 的 name)。
   * 名字为空字符串时返回 undefined。
   */
  async getSessionName(): Promise<string | undefined> {
    const entries = await this.storage.findEntries("session_info");
    return entries[entries.length - 1]?.name?.trim() || undefined;
  }

  // ── Append 方法(全部走 appendTypedEntry) ──

  /**
   * 通用 append:写一条 entry 到 storage 并返回 entry.id。
   * 内部用 `entry.id` 作为返回值(必须由调用方提前生成)。
   */
  private async appendTypedEntry<TEntry extends SessionTreeEntry>(
    entry: TEntry,
  ): Promise<string> {
    await this.storage.appendEntry(entry);
    return entry.id;
  }

  /** 追加一条消息(user/assistant/toolResult) */
  async appendMessage(message: AgentMessage): Promise<string> {
    return this.appendTypedEntry({
      type: "message",
      id: await this.storage.createEntryId(),
      parentId: await this.storage.getLeafId(),
      timestamp: new Date().toISOString(),
      message,
    } satisfies MessageEntry);
  }

  /** 追加一条 thinking level 变更 */
  async appendThinkingLevelChange(thinkingLevel: string): Promise<string> {
    return this.appendTypedEntry({
      type: "thinking_level_change",
      id: await this.storage.createEntryId(),
      parentId: await this.storage.getLeafId(),
      timestamp: new Date().toISOString(),
      thinkingLevel,
    } satisfies ThinkingLevelChangeEntry);
  }

  /** 追加一条 model 切换记录 */
  async appendModelChange(
    provider: string,
    modelId: string,
  ): Promise<string> {
    return this.appendTypedEntry({
      type: "model_change",
      id: await this.storage.createEntryId(),
      parentId: await this.storage.getLeafId(),
      timestamp: new Date().toISOString(),
      provider,
      modelId,
    } satisfies ModelChangeEntry);
  }

  /** 追加一条 active tools 集合变更 */
  async appendActiveToolsChange(activeToolNames: string[]): Promise<string> {
    return this.appendTypedEntry({
      type: "active_tools_change",
      id: await this.storage.createEntryId(),
      parentId: await this.storage.getLeafId(),
      timestamp: new Date().toISOString(),
      activeToolNames: [...activeToolNames],
    } satisfies ActiveToolsChangeEntry);
  }

  /** 追加一条压缩记录 */
  async appendCompaction<T = unknown>(
    summary: string,
    firstKeptEntryId: string,
    tokensBefore: number,
    details?: T,
    fromHook?: boolean,
  ): Promise<string> {
    return this.appendTypedEntry({
      type: "compaction",
      id: await this.storage.createEntryId(),
      parentId: await this.storage.getLeafId(),
      timestamp: new Date().toISOString(),
      summary,
      firstKeptEntryId,
      tokensBefore,
      details,
      fromHook,
    } satisfies CompactionEntry<T>);
  }

  /** 追加一条 custom entry(声明合并扩展点) */
  async appendCustomEntry(
    customType: string,
    data?: unknown,
  ): Promise<string> {
    return this.appendTypedEntry({
      type: "custom",
      id: await this.storage.createEntryId(),
      parentId: await this.storage.getLeafId(),
      timestamp: new Date().toISOString(),
      customType,
      data,
    } satisfies CustomEntry);
  }

  /** 追加一条 custom message(可作为 AgentMessage 参与 buildContext) */
  async appendCustomMessageEntry<T = unknown>(
    customType: string,
    content: string | (TextContent | ImageContent)[],
    display: boolean,
    details?: T,
  ): Promise<string> {
    return this.appendTypedEntry({
      type: "custom_message",
      id: await this.storage.createEntryId(),
      parentId: await this.storage.getLeafId(),
      timestamp: new Date().toISOString(),
      customType,
      content,
      details,
      display,
    } satisfies CustomMessageEntry<T>);
  }

  /** 给某个 entry 加 label(label=undefined 时清除) */
  async appendLabel(
    targetId: string,
    label: string | undefined,
  ): Promise<string> {
    if (!(await this.storage.getEntry(targetId))) {
      throw new SessionError("not_found", `Entry ${targetId} not found`);
    }
    return this.appendTypedEntry({
      type: "label",
      id: await this.storage.createEntryId(),
      parentId: await this.storage.getLeafId(),
      timestamp: new Date().toISOString(),
      targetId,
      label,
    } satisfies LabelEntry);
  }

  /** 设置 session 名称(去除换行) */
  async appendSessionName(name: string): Promise<string> {
    const sanitizedName = name.replace(/[\r\n]+/g, " ").trim();
    return this.appendTypedEntry({
      type: "session_info",
      id: await this.storage.createEntryId(),
      parentId: await this.storage.getLeafId(),
      timestamp: new Date().toISOString(),
      name: sanitizedName,
    });
  }

  // ── 树形跳转(branch) ──

  /**
   * 设置 leaf(追加一条 LeafEntry)。
   *
   * 与 `moveTo` 的区别:
   * - `setLeafId`:只追加 LeafEntry,不改 message 链(用于纯"切 leaf"场景)
   * - `moveTo`:setLeafId + 可选 BranchSummaryEntry(用于"带 summary 的分支跳转")
   */
  async setLeafId(leafId: string | null): Promise<void> {
    if (leafId !== null && !(await this.storage.getEntry(leafId))) {
      throw new SessionError("not_found", `Entry ${leafId} not found`);
    }
    await this.storage.setLeafId(leafId);
  }

  /**
   * 切换 leaf 到指定 entry。
   *
   * 行为:
   * 1. 校验 entryId 存在(null = 回到空)
   * 2. setLeafId(entryId) — 内部追加一条 LeafEntry
   * 3. 若传了 summary,追加一条 BranchSummaryEntry(parentId = entryId)
   *
   * @param entryId 目标 entry id;null 表示切到空
   * @param summary 可选的 branch summary(若提供,会追加一条 BranchSummaryEntry)
   * @returns 若追加了 BranchSummaryEntry 则返回其 id,否则 undefined
   */
  async moveTo(
    entryId: string | null,
    summary?: {
      summary: string;
      details?: unknown;
      fromHook?: boolean;
    },
  ): Promise<string | undefined> {
    if (entryId !== null && !(await this.storage.getEntry(entryId))) {
      throw new SessionError("not_found", `Entry ${entryId} not found`);
    }
    await this.storage.setLeafId(entryId);
    if (!summary) return undefined;
    return this.appendTypedEntry({
      type: "branch_summary",
      id: await this.storage.createEntryId(),
      parentId: entryId,
      timestamp: new Date().toISOString(),
      fromId: entryId ?? "root",
      summary: summary.summary,
      details: summary.details,
      fromHook: summary.fromHook,
    } satisfies BranchSummaryEntry);
  }
}

// ── 从 context-builder 转发(便于外部直接 import) ──

export {
  buildContextEntries,
  buildSessionContext,
  defaultContextEntryTransform,
  sessionEntryToContextMessages,
} from "./context-builder.js";
