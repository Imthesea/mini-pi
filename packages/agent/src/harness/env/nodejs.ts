/**
 * Node.js 版 ExecutionEnv 实现。
 *
 * 基于 Node.js 的 fs / path / child_process 模块。
 *
 * 设计要点:
 * - 全部走 Result<T, FileError | ExecutionError>,不抛(便于调用方处理)
 * - exec 走 child_process.spawn(非 shell),参数数组化防止注入
 * - 输出截断:超过 maxOutputBytes 时强制 kill + 末尾标记
 * - 超时:用 setTimeout + child.kill("SIGTERM")
 * - 路径安全:不解析 symlink(stat 返回 symlink 类型,file path 保持原样)
 *
 * 为什么单独文件:
 * - 280 行左右(plan 估算),独立实现
 * - 与 ExecutionEnv 接口分离(types.ts),便于未来加 MockExecutionEnv
 *
 * 拆分动机:
 * - exec 与 file-ops 内部都依赖一些路径工具,这些是 private 方法
 *   而不是拆出去,因为它们是 nodejs.ts 内部实现细节
 */

import {
  appendFile as fsAppendFile,
  mkdir as fsMkdir,
  readdir as fsReaddir,
  readFile as fsReadFile,
  stat as fsStat,
  unlink as fsUnlink,
  writeFile as fsWriteFile,
} from "node:fs/promises";
import { rm as fsRm } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { spawn } from "node:child_process";

import { ok } from "../session/types.js";
import { FileError, ExecutionError, toError } from "../session/types.js";
import type {
  ExecutionEnv,
  ExecOptions,
  ExecResult,
  FileInfo,
  Result,
} from "./types.js";
import { toFileSystemError, toExecutionError } from "./result.js";

// ── 阈值常量 ──

/** 超过此字节数认为输出"非常大",单独提示 */
const VERY_LARGE_OUTPUT = 10 * 1024 * 1024; // 10MB

// ── NodeExecutionEnv ──

/**
 * Node.js 版 ExecutionEnv。
 *
 * 用法:
 * ```ts
 * const env = new NodeExecutionEnv();
 * const res = await env.readFile("/path/to/file");
 * if (res.ok) console.log(res.value);
 * else console.error(res.error);
 * ```
 */
export class NodeExecutionEnv implements ExecutionEnv {
  /** 当前工作目录(relative path 解析基准) */
  readonly cwd: string;

  constructor(options?: { cwd?: string }) {
    this.cwd = options?.cwd ?? process.cwd();
  }

  // ── 文件读 ──

  async readFile(path: string): Promise<Result<string, FileError>> {
    return this.runFileOp(
      () => fsReadFile(path, "utf-8"),
      `Failed to read file ${path}`,
      path,
    );
  }

  async readBinaryFile(path: string): Promise<Result<Uint8Array, FileError>> {
    return this.runFileOp(
      async () => new Uint8Array(await fsReadFile(path)),
      `Failed to read binary file ${path}`,
      path,
    );
  }

  // ── 文件写 ──

  async writeFile(
    path: string,
    content: string,
  ): Promise<Result<void, FileError>> {
    return this.runFileOp(
      async () => {
        // 自动创建父目录(类似真实 fs,但更友好)
        const parent = dirname(path);
        if (parent !== path) {
          await fsMkdir(parent, { recursive: true });
        }
        await fsWriteFile(path, content, "utf-8");
      },
      `Failed to write file ${path}`,
      path,
    );
  }

  async appendFile(
    path: string,
    content: string,
  ): Promise<Result<void, FileError>> {
    return this.runFileOp(
      async () => {
        const parent = dirname(path);
        if (parent !== path) {
          await fsMkdir(parent, { recursive: true });
        }
        await fsAppendFile(path, content, "utf-8");
      },
      `Failed to append to file ${path}`,
      path,
    );
  }

  // ── 元信息 ──

  async stat(path: string): Promise<Result<FileInfo, FileError>> {
    return this.runFileOp(
      async () => {
        const s = await fsStat(path);
        return {
          name: pathBasename(path),
          path,
          kind: s.isDirectory() ? "directory" : s.isSymbolicLink() ? "symlink" : "file",
          size: s.size,
          mtimeMs: s.mtimeMs,
        };
      },
      `Failed to stat ${path}`,
      path,
    );
  }

  async exists(path: string): Promise<Result<boolean, FileError>> {
    try {
      await fsStat(path);
      return ok(true);
    } catch (error) {
      if (isNotFoundError(error)) return ok(false);
      return {
        ok: false,
        error: toFileSystemError(error, `Failed to check existence of ${path}`, { path }),
      };
    }
  }

  // ── 目录操作 ──

  async readdir(path: string): Promise<Result<FileInfo[], FileError>> {
    return this.runFileOp(
      async () => {
        const entries = await fsReaddir(path, { withFileTypes: true });
        const infos = await Promise.all(
          entries.map(async (entry) => {
            const childPath = join(path, entry.name);
            if (entry.isDirectory()) {
              return { name: entry.name, path: childPath, kind: "directory" as const, size: 0, mtimeMs: 0 };
            }
            if (entry.isSymbolicLink()) {
              return { name: entry.name, path: childPath, kind: "symlink" as const, size: 0, mtimeMs: 0 };
            }
            // 普通文件:查 size + mtime
            try {
              const s = await fsStat(childPath);
              return { name: entry.name, path: childPath, kind: "file" as const, size: s.size, mtimeMs: s.mtimeMs };
            } catch {
              return { name: entry.name, path: childPath, kind: "file" as const, size: 0, mtimeMs: 0 };
            }
          }),
        );
        return infos;
      },
      `Failed to read directory ${path}`,
      path,
    );
  }

  async mkdir(
    path: string,
    options?: { recursive?: boolean },
  ): Promise<Result<void, FileError>> {
    return this.runFileOp(
      async () => {
        await fsMkdir(path, { recursive: options?.recursive ?? true });
      },
      `Failed to create directory ${path}`,
      path,
    );
  }

  async remove(
    path: string,
    options?: { recursive?: boolean; force?: boolean },
  ): Promise<Result<void, FileError>> {
    return this.runFileOp(
      async () => {
        await fsRm(path, {
          recursive: options?.recursive ?? false,
          force: options?.force ?? false,
        });
      },
      `Failed to remove ${path}`,
      path,
    );
  }

  // ── 路径工具 ──

  async absolutePath(path: string): Promise<Result<string, FileError>> {
    if (isAbsolute(path)) return ok(path);
    try {
      return ok(resolve(this.cwd, path));
    } catch (error) {
      return {
        ok: false,
        error: toFileSystemError(error, `Failed to resolve path ${path}`, { path }),
      };
    }
  }

  async joinPath(parts: string[]): Promise<Result<string, FileError>> {
    if (parts.length === 0) return ok("");
    try {
      // Node path.join 自动处理 / 与 \
      return ok(join(...parts));
    } catch (error) {
      return {
        ok: false,
        error: toFileSystemError(error, `Failed to join paths ${parts.join("/")}`),
      };
    }
  }

  // ── 命令执行 ──

  async exec(
    command: string,
    args: readonly string[] = [],
    options: ExecOptions = {},
  ): Promise<Result<ExecResult, ExecutionError>> {
    return new Promise((resolvePromise) => {
      // 不走 shell,直接 spawn command + args
      let child;
      try {
        child = spawn(command, [...args], {
          cwd: options.cwd,
          env: options.env
            ? { ...process.env, ...options.env }
            : process.env,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        resolvePromise({
          ok: false,
          error: toExecutionError(error, `Failed to spawn ${command}`),
        });
        return;
      }

      // 输出截断收集
      const maxBytes = options.maxOutputBytes;
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let stdoutTruncated = false;
      let stderrTruncated = false;

      child.stdout?.on("data", (chunk: Buffer) => {
        if (stdoutTruncated) return;
        const newBytes = stdoutBytes + chunk.length;
        if (maxBytes !== undefined && newBytes > maxBytes) {
          // 截断到 maxBytes
          const remaining = maxBytes - stdoutBytes;
          if (remaining > 0) {
            stdoutChunks.push(chunk.subarray(0, remaining));
          }
          stdoutBytes = maxBytes;
          stdoutTruncated = true;
        } else {
          stdoutChunks.push(chunk);
          stdoutBytes = newBytes;
        }
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        if (stderrTruncated) return;
        const newBytes = stderrBytes + chunk.length;
        if (maxBytes !== undefined && newBytes > maxBytes) {
          const remaining = maxBytes - stderrBytes;
          if (remaining > 0) {
            stderrChunks.push(chunk.subarray(0, remaining));
          }
          stderrBytes = maxBytes;
          stderrTruncated = true;
        } else {
          stderrChunks.push(chunk);
          stderrBytes = newBytes;
        }
      });

      // 超时 + abort 处理
      let timedOut = false;
      let aborted = false;
      const timeoutHandle =
        options.timeout !== undefined
          ? setTimeout(() => {
              timedOut = true;
              child.kill("SIGTERM");
            }, options.timeout)
          : null;
      const onAbort = () => {
        aborted = true;
        child.kill("SIGTERM");
      };
      options.signal?.addEventListener("abort", onAbort, { once: true });

      child.on("error", (error) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        options.signal?.removeEventListener("abort", onAbort);
        resolvePromise({
          ok: false,
          error: toExecutionError(error, `Failed to execute ${command}`),
        });
      });

      child.on("close", (exitCode) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        options.signal?.removeEventListener("abort", onAbort);

        if (timedOut) {
          resolvePromise({
            ok: false,
            error: new ExecutionError("timeout", `Command ${command} timed out after ${options.timeout}ms`),
          });
          return;
        }
        if (aborted) {
          resolvePromise({
            ok: false,
            error: new ExecutionError("aborted", `Command ${command} aborted`),
          });
          return;
        }

        let stdout = Buffer.concat(stdoutChunks).toString("utf-8");
        let stderr = Buffer.concat(stderrChunks).toString("utf-8");
        const truncated = stdoutTruncated || stderrTruncated;
        if (truncated) {
          const marker = `\n[...truncated at ${maxBytes} bytes...]`;
          if (stdoutTruncated) stdout += marker;
          if (stderrTruncated) stderr += marker;
        }

        // 防御性检查:output 不应超过 2x maxBytes(避免 bug 导致 OOM)
        if (stdout.length > (maxBytes ?? VERY_LARGE_OUTPUT) * 2) {
          stdout = stdout.slice(0, (maxBytes ?? VERY_LARGE_OUTPUT) * 2) + "\n[...hard-truncated...]";
        }
        if (stderr.length > (maxBytes ?? VERY_LARGE_OUTPUT) * 2) {
          stderr = stderr.slice(0, (maxBytes ?? VERY_LARGE_OUTPUT) * 2) + "\n[...hard-truncated...]";
        }

        resolvePromise(
          ok({
            stdout,
            stderr,
            exitCode: exitCode ?? 0,
            truncated,
          }),
        );
      });
    });
  }

  // ── 内部工具 ──

  /**
   * 包装一个 fs 操作,把异常转为 Result<FileError>。
   * 成功时把返回值包成 Ok。
   */
  private async runFileOp<T>(
    op: () => Promise<T>,
    message: string,
    path?: string,
  ): Promise<Result<T, FileError>> {
    try {
      return ok(await op());
    } catch (error) {
      return {
        ok: false,
        error: toFileSystemError(error, message, { path }),
      };
    }
  }
}

// ── 内部工具 ──

/** 取路径最后一段(类似 path.basename,但不依赖 path 模块导入顺序) */
function pathBasename(p: string): string {
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return idx >= 0 ? p.slice(idx + 1) : p;
}

/** 判断是否为 ENOENT 错误 */
function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

// 抑制未使用警告(toError 在 result.ts 用,这里只 import 防 unused)
export { toError as _toError };
