/**
 * Session repo 共享工具。
 *
 * 包含:
 * - createSessionId:生成新 session id
 * - createTimestamp:生成 ISO 8601 时间戳
 * - toSession:把 storage 包成 Session
 * - getFileSystemResultOrThrow:Result → throw SessionError 转换(env 用)
 * - getEntriesToFork:从已有 session 切分要 fork 的 entries 子集
 *
 * 拆分理由:
 * - memory-repo 和 jsonl-repo 都依赖这些工具
 * - 集中放一处便于统一管理(getEntriesToFork 的 fork 逻辑复杂)
 * - 不放在 types.ts 因为这些都是"运行时函数"而非"类型"
 */

import { SessionError, toError } from "./types.js";
import type {
  FileError,
  Result,
  SessionMetadata,
  SessionTreeEntry,
} from "./types.js";
import type { SessionStorage } from "./storage.js";
import { Session } from "./session.js";
import { generateShortId, uuidv7 } from "./uuidv7.js";

/** 生成一个 session id(完整 uuidv7) */
export function createSessionId(): string {
  return uuidv7();
}

/** 生成 ISO 8601 时间戳 */
export function createTimestamp(): string {
  return new Date().toISOString();
}

/** 把 SessionStorage 包装成 Session 实例(避免直接 new Session 暴露) */
export function toSession<TMetadata extends SessionMetadata>(
  storage: SessionStorage<TMetadata>,
): Session<TMetadata> {
  return new Session(storage);
}

/**
 * 把 FileSystem Result 错误转换为 SessionError 并 throw。
 *
 * 用途:FileSystem 风格(env)→ Session 抛错风格。
 * - "not_found" → SessionError("not_found")
 * - 其他 FileError → SessionError("storage", 原 message, 原 cause)
 */
export function getFileSystemResultOrThrow<TValue>(
  result: Result<TValue, FileError>,
  message: string,
): TValue {
  if (result.ok) return result.value;
  const code = result.error.code === "not_found" ? "not_found" : "storage";
  throw new SessionError(code, `${message}: ${result.error.message}`, toError(result.error));
}

/** fork 选项 */
export interface ForkOptions {
  /** fork 起点 entry id;不传 = fork 整个 session */
  entryId?: string;
  /**
   * - "before"(默认):保留到 targetId 之前(不包含 targetId);要求 targetId 是 user message
   * - "at":保留到 targetId(含)
   */
  position?: "before" | "at";
  /** 新 session id(可选) */
  id?: string;
}

/**
 * 从一个 session 切出要 fork 的 entries 子集。
 *
 * 行为:
 * - 无 entryId:返回整个 entries(完整 fork)
 * - entryId + position="at":返回到 targetId 的路径(含)
 * - entryId + position="before"(默认):返回到 targetId 父节点的路径;
 *   要求 targetId 是 user message,否则抛 invalid_fork_target
 *
 * 用于 memory-repo / jsonl-repo 的 fork 实现。
 */
export async function getEntriesToFork(
  storage: SessionStorage,
  options: ForkOptions,
): Promise<SessionTreeEntry[]> {
  if (!options.entryId) return storage.getEntries();
  const target = await storage.getEntry(options.entryId);
  if (!target) {
    throw new SessionError(
      "invalid_fork_target",
      `Entry ${options.entryId} not found`,
    );
  }
  let effectiveLeafId: string | null;
  if ((options.position ?? "before") === "at") {
    effectiveLeafId = target.id;
  } else {
    if (target.type !== "message" || target.message.role !== "user") {
      throw new SessionError(
        "invalid_fork_target",
        `Entry ${options.entryId} is not a user message`,
      );
    }
    effectiveLeafId = target.parentId;
  }
  return storage.getPathToRoot(effectiveLeafId);
}

// 抑制 "value is declared but never used" 警告
// generateShortId 用于 Session 内 appendEntry 等地方时可能需要 re-export
export { generateShortId };
