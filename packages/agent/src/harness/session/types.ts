/**
 * Session 树形 entry 类型 + 错误类型。
 *
 * 从 pi 项目的 `packages/agent/src/harness/types.ts` 的 SessionTreeEntry 联合
 * + SessionStorage / SessionMetadata 翻译而来,适配 @mimi/ai 包。
 *
 * 设计的 11 种 entry 类型(每个都是 SessionTreeEntry 联合的一个变体):
 *
 * | type                  | 含义                                       | 持久化?
 * |-----------------------|--------------------------------------------|--------
 * | message               | 一条 LLM 消息(用户/助手/工具结果)        | ✅
 * | thinking_level_change | thinking level 变更记录                   | ✅
 * | model_change          | model 切换记录                            | ✅
 * | active_tools_change   | 工具激活集合变更记录                      | ✅
 * | compaction            | 压缩摘要(覆盖早于 firstKeptEntryId 的 entries) | ✅
 * | branch_summary        | 分支跳转摘要                              | ✅
 * | custom                | 声明合并扩展点(任意 data)                | ✅
 * | custom_message        | 自定义消息(可参与 context 构建)          | ✅
 * | label                 | 给某个 entry 起名字                        | ✅
 * | session_info          | session 元信息(名称等)                   | ✅
 * | leaf                  | 标记当前 leaf 指向(targetId)             | ✅
 *
 * 文件结构:
 * 1. Base 类型(SessionTreeEntryBase)
 * 2. 11 个变体定义
 * 3. SessionTreeEntry 联合
 * 4. SessionContext / SessionMetadata
 * 5. SessionError / FileError / ExecutionError
 *
 * 拆分理由:
 * - 与 plan § 4.4 一致,types.ts 仅放跨模块共享的"协议"层类型
 * - 不在此文件实现任何运行时逻辑,只是"类型契约"
 */

import type { ImageContent, TextContent, UserMessage, AssistantMessage } from "@mimi/ai";
import type { AgentMessage } from "../../types.js";

// 重新导出 AgentMessage / UserMessage / AssistantMessage,方便 session 用户使用
// (不直接导 @mimi/ai 避免上层混乱,统一在 agent 层 re-export)
export type { AgentMessage, UserMessage, AssistantMessage };

// ── Base ──

/** 所有 SessionTreeEntry 变体的共有字段 */
export interface SessionTreeEntryBase {
  /** entry 类型字面量(用于联合 narrowing) */
  type: string;
  /** 全局唯一 id(uuidv7 短 id 或完整 uuid) */
  id: string;
  /** 父 entry id;根节点的 parentId 为 null */
  parentId: string | null;
  /** ISO 8601 时间戳 */
  timestamp: string;
}

// ── 11 个变体 ──

/** message entry:一条 AgentMessage(用户/助手/工具结果) */
export interface MessageEntry extends SessionTreeEntryBase {
  type: "message";
  message: AgentMessage;
}

/** thinking level 变更 */
export interface ThinkingLevelChangeEntry extends SessionTreeEntryBase {
  type: "thinking_level_change";
  thinkingLevel: string;
}

/** model 切换 */
export interface ModelChangeEntry extends SessionTreeEntryBase {
  type: "model_change";
  provider: string;
  modelId: string;
}

/** 工具激活集合变更 */
export interface ActiveToolsChangeEntry extends SessionTreeEntryBase {
  type: "active_tools_change";
  activeToolNames: string[];
}

/** 压缩:覆盖早于 firstKeptEntryId 的所有 entries */
export interface CompactionEntry<T = unknown> extends SessionTreeEntryBase {
  type: "compaction";
  summary: string;
  /** 压缩后保留的第一条 entry id(更早的 entries 在 buildContext 时跳过) */
  firstKeptEntryId: string;
  /** 压缩前的 token 数 */
  tokensBefore: number;
  details?: T;
  fromHook?: boolean;
}

/** 分支跳转摘要(从某个 entry 跳到另一个时记录) */
export interface BranchSummaryEntry<T = unknown> extends SessionTreeEntryBase {
  type: "branch_summary";
  fromId: string;
  summary: string;
  details?: T;
  fromHook?: boolean;
}

/** 自定义 entry(声明合并扩展点,内容由 customType 决定) */
export interface CustomEntry<T = unknown> extends SessionTreeEntryBase {
  type: "custom";
  customType: string;
  data?: T;
}

/** 自定义消息(可作为 AgentMessage 参与 buildContext) */
export interface CustomMessageEntry<T = unknown> extends SessionTreeEntryBase {
  type: "custom_message";
  customType: string;
  content: string | (TextContent | ImageContent)[];
  details?: T;
  /** 是否在 UI 中显示 */
  display: boolean;
}

/** 给某个 entry 加标签(label=undefined 时清除) */
export interface LabelEntry extends SessionTreeEntryBase {
  type: "label";
  targetId: string;
  label: string | undefined;
}

/** session 元信息(名称等);legacy 名字保留 */
export interface SessionInfoEntry extends SessionTreeEntryBase {
  type: "session_info";
  name?: string;
}

/** 标记当前 leaf 位置(targetId = 当前活跃 entry id,null 表示空) */
export interface LeafEntry extends SessionTreeEntryBase {
  type: "leaf";
  targetId: string | null;
}

/** 11 个变体的联合 */
export type SessionTreeEntry =
  | MessageEntry
  | ThinkingLevelChangeEntry
  | ModelChangeEntry
  | ActiveToolsChangeEntry
  | CompactionEntry
  | BranchSummaryEntry
  | CustomEntry
  | CustomMessageEntry
  | LabelEntry
  | SessionInfoEntry
  | LeafEntry;

// ── Session 元数据 ──

/** session 基本元数据(内存/通用) */
export interface SessionMetadata {
  id: string;
  createdAt: string;
}

/** JSONL 持久化 session 的元数据 */
export interface JsonlSessionMetadata extends SessionMetadata {
  cwd: string;
  path: string;
  parentSessionPath?: string;
  metadata?: Record<string, unknown>;
}

// ── SessionContext:由 buildContext 派生的运行时状态 ──

/**
 * 从 leaf → root 的路径上派生的会话状态。
 *
 * - `messages`:经过 buildContext 处理后的 AgentMessage 列表
 * - `thinkingLevel` / `model` / `activeToolNames`:从 entry 链派生的最新值
 */
export interface SessionContext {
  messages: AgentMessage[];
  thinkingLevel: string;
  model: { provider: string; modelId: string } | null;
  activeToolNames: string[] | null;
}

// ── Session 错误 ──

/** Session 错误码 */
export type SessionErrorCode =
  | "not_found"
  | "invalid_session"
  | "invalid_entry"
  | "invalid_fork_target"
  | "storage"
  | "unknown";

/** Session 抛出的错误(存储、repo、tree 操作) */
export class SessionError extends Error {
  /** 错误码 */
  readonly code: SessionErrorCode;

  constructor(code: SessionErrorCode, message: string, cause?: Error) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "SessionError";
    this.code = code;
    // 保持正确的 prototype chain(ES5 target 需要)
    Object.setPrototypeOf(this, SessionError.prototype);
  }
}

// ── FileError / ExecutionError(env 模块共享) ──

/** 文件错误码(env 模块使用,先放这里避免循环依赖) */
export type FileErrorCode =
  | "aborted"
  | "not_found"
  | "permission_denied"
  | "not_directory"
  | "is_directory"
  | "invalid"
  | "not_supported"
  | "unknown";

/** 文件操作错误(env 模块抛出) */
export class FileError extends Error {
  readonly code: FileErrorCode;
  readonly path?: string;

  constructor(code: FileErrorCode, message: string, path?: string, cause?: Error) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "FileError";
    this.code = code;
    this.path = path;
    Object.setPrototypeOf(this, FileError.prototype);
  }
}

/** 执行错误码(env.exec 使用) */
export type ExecutionErrorCode =
  | "aborted"
  | "timeout"
  | "shell_unavailable"
  | "spawn_error"
  | "callback_error"
  | "unknown";

/** 命令执行错误(env.exec 抛出) */
export class ExecutionError extends Error {
  readonly code: ExecutionErrorCode;

  constructor(code: ExecutionErrorCode, message: string, cause?: Error) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ExecutionError";
    this.code = code;
    Object.setPrototypeOf(this, ExecutionError.prototype);
  }
}

// ── FileSystem 抽象(env 模块依赖,先声明) ──

/** 文件类型 */
export type FileKind = "file" | "directory" | "symlink";

/** 文件元信息 */
export interface FileInfo {
  name: string;
  path: string;
  kind: FileKind;
  size: number;
  mtimeMs: number;
}

/** 后端无关的 Result<T, E> 类型(env 模块基础) */
export type Result<TValue, TError> =
  | { ok: true; value: TValue }
  | { ok: false; error: TError };

/** 构造成功 Result */
export function ok<TValue, TError>(value: TValue): Result<TValue, TError> {
  return { ok: true, value };
}

/** 构造失败 Result */
export function err<TValue, TError>(error: TError): Result<TValue, TError> {
  return { ok: false, error };
}

/**
 * 把任意 unknown 标准化为 Error 实例。
 * 字符串 → Error(string),Error → 原样,其他 → JSON.stringify 兜底。
 */
export function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === "string") return new Error(error);
  try {
    return new Error(JSON.stringify(error));
  } catch {
    return new Error(String(error));
  }
}
