/**
 * env 模块 Result 工具 + 错误转换。
 *
 * 提供:
 * - `Result<T, E>` 类型的 re-export(从 session/types.ts)
 * - `ok` / `err` 构造函数的 re-export
 * - `toFileSystemError`:把任意 unknown 错误标准化为 FileError
 * - `toExecutionError`:把任意 unknown 错误标准化为 ExecutionError
 * - `getResultOrThrow`:Result 错误直接 throw(简化调用方代码)
 *
 * 与 session/types.ts 的关系:
 * - Result / ok / err / FileError / ExecutionError 已在 session/types.ts 顶层定义
 * - env/result.ts 提供**env 专属的便捷工具**(toFileSystemError / getResultOrThrow)
 * - 这样 session 模块和 env 模块的"基础类型"统一,但每个模块有自己的工具函数
 *
 * 为什么 result.ts 单独文件:
 * - plan § 4.4 显式列出 env/result.ts(50 行)
 * - toFileSystemError 这种转换函数,跨多个 env 实现复用
 * - 不并入 types.ts:types 是"零运行时"契约,result.ts 是"运行时工具"
 */

import { ExecutionError, FileError, err, ok, toError } from "../session/types.js";
import type { Result } from "../session/types.js";

// ── Re-export 基础类型 ──

export type { Result };
export { ok, err };

// ── 错误标准化 ──

/** 错误标准化选项 */
export interface ToFileSystemErrorOptions {
  /** 路径(用于构造 FileError.path) */
  path?: string;
}

/**
 * 把任意 unknown 错误标准化为 FileError。
 *
 * 行为:
 * - 已经是 FileError → 原样返回
 * - 有 `code` 字段(ENOENT 等 Node 错误)→ 映射为 FileErrorCode
 * - 有 `path` 字段 → 用作 FileError.path
 * - 其他 → FileError("unknown", message)
 */
export function toFileSystemError(
  error: unknown,
  message: string,
  options?: ToFileSystemErrorOptions,
): FileError {
  if (error instanceof FileError) return error;
  const e = toError(error);
  const path = options?.path ?? extractPath(error);
  const code = extractFileErrorCode(error);
  return new FileError(code, `${message}: ${e.message}`, path, e);
}

/**
 * 把任意 unknown 错误标准化为 ExecutionError。
 */
export function toExecutionError(
  error: unknown,
  message: string,
): ExecutionError {
  if (error instanceof ExecutionError) return error;
  const e = toError(error);
  const code = extractExecutionErrorCode(error);
  return new ExecutionError(code, `${message}: ${e.message}`, e);
}

/**
 * Result 错误直接 throw(简化调用方代码)。
 * 成功时返回值。
 */
export function getResultOrThrow<TValue, TError extends Error>(
  result: Result<TValue, TError>,
  message: string,
): TValue {
  if (result.ok) return result.value;
  throw new Error(`${message}: ${result.error.message}`, { cause: result.error });
}

// ── 内部工具 ──

/** 从未知 error 上提取 path(Node.js fs 错误有 path 字段) */
function extractPath(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "path" in error) {
    const p = (error as { path?: unknown }).path;
    if (typeof p === "string") return p;
  }
  return undefined;
}

/** 把 Node fs 错误码映射为 FileErrorCode */
function extractFileErrorCode(error: unknown): import("../session/types.js").FileErrorCode {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") {
      // 常见 Node fs 错误码 → FileErrorCode
      switch (code) {
        case "ENOENT":
          return "not_found";
        case "EACCES":
        case "EPERM":
          return "permission_denied";
        case "ENOTDIR":
          return "not_directory";
        case "EISDIR":
          return "is_directory";
        case "EINVAL":
          return "invalid";
        default:
          return "unknown";
      }
    }
  }
  return "unknown";
}

/** 把 Node child_process 错误码映射为 ExecutionErrorCode */
function extractExecutionErrorCode(error: unknown): import("../session/types.js").ExecutionErrorCode {
  if (typeof error === "object" && error !== null) {
    if ("code" in error) {
      const code = (error as { code?: unknown }).code;
      // Node spawn ENOENT(命令不存在)
      if (code === "ENOENT") return "spawn_error";
    }
    if ("killed" in error && (error as { killed?: unknown }).killed) {
      return "aborted";
    }
  }
  return "unknown";
}

// 抑制未使用警告(ok/err 在调用方用)
export { err as _err };
