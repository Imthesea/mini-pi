/**
 * env 模块共享类型 + 错误类型 re-export。
 *
 * 职责:
 * 1. 定义 ExecutionEnv 接口(env 模块对外契约)
 * 2. 定义 ExecOptions(命令执行参数)
 * 3. 重新导出 Result/FileError/ExecutionError 等基础类型
 *    (这些类型在 session/types.ts 中定义,因为类型零依赖、env 模块也要用)
 *
 * 设计动机:
 * - types.ts 是"零依赖基础类型层",env 模块复用其 Result / 错误
 * - env/types.ts 只定义 env 专属契约,不重复 Result 等通用类型
 * - 这种"基础类型集中"vs"模块专属类型分文件"的模式与 plan § 4.4 一致
 *
 * 文件拆分理由:
 * - plan 显式列出 env/types.ts(120 行),所以独立文件而非合并到 nodejs.ts
 * - ExecutionEnv 接口未来可能有多种实现(测试 mock、远程执行等),
 *   单独文件便于其他实现者 import 接口
 */

// ── 从 session/types 重新导出基础类型(env 模块用) ──

import type {
  Result,
  FileErrorCode,
  ExecutionErrorCode,
  FileKind,
  FileInfo,
} from "../session/types.js";
import { ok, err, toError, FileError, ExecutionError } from "../session/types.js";

export type {
  Result,
  FileErrorCode,
  ExecutionErrorCode,
  FileKind,
  FileInfo,
};
export { ok, err, toError, FileError, ExecutionError };

// ── ExecutionEnv 接口 ──

/**
 * 后端无关的执行环境契约。
 *
 * 设计要点:
 * - 全部方法返回 `Result<T, FileError | ExecutionError>`,不抛(便于调用方处理错误)
 * - 路径安全:不自动解析 symlink(避免 TOCTOU 攻击)
 * - exec 走 child_process.spawn(非 shell),参数数组化防止注入
 *
 * 实现:
 * - `NodeExecutionEnv`(`nodejs.ts`):基于 Node.js fs/child_process 的实现
 * - 未来可加 `MockExecutionEnv`(测试)、`RemoteExecutionEnv`(远程执行)等
 */
export interface ExecutionEnv {
  /**
   * 当前工作目录(相对路径解析基准)。
   * 这是必填字段(实现侧负责提供),
   * 便于 `absolutePath(relativePath)` 等方法不需要额外传 cwd。
   */
  readonly cwd: string;

  // ── 文件读 ──

  /**
   * 读文本文件。
   * - 文件不存在 → Err(FileError "not_found")
   * - 路径指向目录 → Err(FileError "is_directory")
   * - 权限不足 → Err(FileError "permission_denied")
   */
  readFile(path: string): Promise<Result<string, FileError>>;

  /**
   * 读二进制文件(返回 Uint8Array)。
   */
  readBinaryFile(path: string): Promise<Result<Uint8Array, FileError>>;

  // ── 文件写 ──

  /**
   * 写文本文件(覆盖)。
   * - 父目录不存在 → 自动创建(recursive: true 语义)
   * - 路径指向目录 → Err(FileError "is_directory")
   */
  writeFile(path: string, content: string): Promise<Result<void, FileError>>;

  /**
   * 追加文本到文件末尾(不存在则创建)。
   */
  appendFile(path: string, content: string): Promise<Result<void, FileError>>;

  // ── 元信息 ──

  /**
   * 取文件/目录元信息。
   * - 不存在 → Err(FileError "not_found")
   * - 是 symlink 不自动 follow,返回 symlink 类型
   */
  stat(path: string): Promise<Result<FileInfo, FileError>>;

  /**
   * 路径是否存在(不抛错)。
   */
  exists(path: string): Promise<Result<boolean, FileError>>;

  // ── 目录操作 ──

  /**
   * 列目录内容(只列直接子项,不递归)。
   * - 不是目录 → Err(FileError "not_directory")
   */
  readdir(path: string): Promise<Result<FileInfo[], FileError>>;

  /**
   * 创建目录。
   * - recursive 默认 true(类似 `mkdir -p`)
   * - 已存在且 recursive:true → Ok(幂等)
   */
  mkdir(path: string, options?: { recursive?: boolean }): Promise<Result<void, FileError>>;

  /**
   * 删除文件或目录。
   * - force:true 时不存在不报错
   * - recursive:true 时删除非空目录
   */
  remove(
    path: string,
    options?: { recursive?: boolean; force?: boolean },
  ): Promise<Result<void, FileError>>;

  // ── 路径工具 ──

  /** 解析为绝对路径(相对路径基于 cwd) */
  absolutePath(path: string): Promise<Result<string, FileError>>;

  /** 拼接多个路径段(规范化处理 `/` 与 `\`) */
  joinPath(parts: string[]): Promise<Result<string, FileError>>;

  // ── 命令执行 ──

  /**
   * 执行外部命令。
   *
   * 行为:
   * - 成功(退出码 0)→ Ok({ stdout, stderr, exitCode: 0 })
   * - 非 0 退出码 → **仍然 Ok**({ exitCode: N }),由调用方判断
   * - spawn 失败(命令不存在)→ Err(ExecutionError "spawn_error")
   * - 超时 → Err(ExecutionError "timeout")
   * - 用户取消(AbortSignal)→ Err(ExecutionError "aborted")
   * - 输出超过 maxOutputBytes → stdout/stderr 截断,末尾加 "...truncated..."
   *
   * 安全:
   * - 走 child_process.spawn(非 shell),参数数组化防止注入
   * - 不接受 symlink 解析
   */
  exec(
    command: string,
    args?: readonly string[],
    options?: ExecOptions,
  ): Promise<Result<ExecResult, ExecutionError>>;
}

// ── Exec 选项 ──

/** exec 命令选项 */
export interface ExecOptions {
  /** 工作目录 */
  cwd?: string;
  /** 进程环境变量(默认继承 process.env) */
  env?: Readonly<Record<string, string>>;
  /** 超时(毫秒);超时后强制 kill 子进程 */
  timeout?: number;
  /** stdout/stderr 单边最大字节数;超过则截断 */
  maxOutputBytes?: number;
  /** 取消信号 */
  signal?: AbortSignal;
}

/** exec 命令结果 */
export interface ExecResult {
  /** 标准输出(已截断到 maxOutputBytes) */
  stdout: string;
  /** 标准错误(已截断到 maxOutputBytes) */
  stderr: string;
  /** 退出码(0 = 成功) */
  exitCode: number;
  /** 输出是否被截断(任一边超 maxOutputBytes) */
  truncated: boolean;
}
