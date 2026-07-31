/**
 * env 模块公共 API 入口。
 *
 * 导出:
 * - ExecutionEnv 接口(供 mock 实现)
 * - NodeExecutionEnv 实现(生产用)
 * - 错误类型(FileError / ExecutionError)
 * - 工具类型(Result / ok / err)
 * - 工具函数(toFileSystemError / toExecutionError / getResultOrThrow)
 *
 * 设计:薄入口,只 re-export,不做编排
 */

export type {
  ExecutionEnv,
  ExecOptions,
  ExecResult,
  FileInfo,
  FileKind,
  FileErrorCode,
  ExecutionErrorCode,
  Result,
} from "./types.js";

export { NodeExecutionEnv } from "./nodejs.js";

export { FileError, ExecutionError } from "./types.js";

export {
  ok,
  err,
  toFileSystemError,
  toExecutionError,
  getResultOrThrow,
  type ToFileSystemErrorOptions,
} from "./result.js";
