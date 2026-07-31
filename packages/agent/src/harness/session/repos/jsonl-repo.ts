/**
 * JSONL SessionRepo。
 *
 * 行为:
 * - sessions 根目录:`<sessionsRoot>/<encodedCwd>/`
 * - 单 session 文件:`<encodedCwd>/<timestamp>_<sessionId>.jsonl`
 * - create:写新文件(只含 header)
 * - open:读已有文件
 * - list:扫描 encodedCwd 目录,读取每个 .jsonl 的 header(只读第一行)
 * - delete:删除文件
 * - fork:从 source 派生新文件,继承 parentSessionPath / metadata
 *
 * 与 InMemorySessionRepo 的关系:
 * - 实现相同接口,但底层是文件系统
 * - cwd 编码规则:`--<cwd-replace-separators-and-colons>--`
 *   例:`/home/user/proj` → `--home-user-proj--`
 *   例:`C:\Users\foo` → `--C-Users-foo--`(冒号也变 -)
 */

import { SessionError, toError, FileError } from "../types.js";
import type {
  JsonlSessionMetadata,
  Result,
} from "../types.js";
import type { Session } from "../session.js";
import type {
  JsonlSessionRepoApi,
  JsonlSessionCreateOptions,
  JsonlSessionListOptions,
} from "../storage.js";
import { JsonlSessionStorage, loadJsonlSessionMetadata } from "./jsonl-storage.js";
import {
  createSessionId,
  createTimestamp,
  getEntriesToFork,
  getFileSystemResultOrThrow,
  toSession,
} from "../repo-utils.js";
import type { ForkOptions } from "../repo-utils.js";

// ── JSONL repo 用的 FileSystem 子集(比 jsonl-storage 大) ──

/** JSONL session repo 需要的文件系统接口 */
export interface JsonlSessionRepoFileSystem {
  cwd: string;
  absolutePath(path: string): Promise<Result<string, FileError>>;
  joinPath(parts: string[]): Promise<Result<string, FileError>>;
  readTextFile(path: string): Promise<Result<string, FileError>>;
  readTextLines(
    path: string,
    options?: { maxLines?: number },
  ): Promise<Result<string[], FileError>>;
  writeFile(path: string, content: string): Promise<Result<void, FileError>>;
  appendFile(path: string, content: string): Promise<Result<void, FileError>>;
  listDir(path: string): Promise<Result<Array<{ name: string; path: string; kind: string }>, FileError>>;
  exists(path: string): Promise<Result<boolean, FileError>>;
  createDir(
    path: string,
    options?: { recursive?: boolean },
  ): Promise<Result<void, FileError>>;
  remove(
    path: string,
    options?: { recursive?: boolean; force?: boolean },
  ): Promise<Result<void, FileError>>;
}

// ── 工具:把 cwd 编码成目录名 ──

/** 把 cwd 编码成目录名:`/home/user/proj` → `--home-user-proj--`
 * 规则:把 `/`、`\`、`:` 都视为 separator,连续多个 separator 合并为单个 `-`。
 * 例:
 *   `/home` → `--home--`
 *   `C:/Users/foo` → `--C-Users-foo--`(`:/` 合并为 `-`)
 *   `C:\Users\foo` → `--C-Users-foo--`
 */
function encodeCwd(cwd: string): string {
  return `--${cwd
    .replace(/^[/\\]/, "")
    .replace(/[/\\:]+/g, "-")
    }--`;
}

// ── JsonlSessionRepo 主类 ──

/**
 * JSONL 文件版 SessionRepo。
 *
 * 构造时只需传 fs(sessionsRoot 用绝对路径解析)。
 */
export class JsonlSessionRepo implements JsonlSessionRepoApi {
  private readonly fs: JsonlSessionRepoFileSystem;
  private readonly sessionsRootInput: string;
  private sessionsRoot: string | undefined;

  constructor(options: {
    fs: JsonlSessionRepoFileSystem;
    sessionsRoot: string;
  }) {
    this.fs = options.fs;
    this.sessionsRootInput = options.sessionsRoot;
  }

  /** 解析 sessionsRoot(懒加载,首次访问时) */
  private async getSessionsRoot(): Promise<string> {
    if (!this.sessionsRoot) {
      this.sessionsRoot = getFileSystemResultOrThrow(
        await this.fs.absolutePath(this.sessionsRootInput),
        `Failed to resolve sessions root ${this.sessionsRootInput}`,
      );
    }
    return this.sessionsRoot;
  }

  /** 解析某个 cwd 对应的 session 目录 */
  private async getSessionDir(cwd: string): Promise<string> {
    return getFileSystemResultOrThrow(
      await this.fs.joinPath([await this.getSessionsRoot(), encodeCwd(cwd)]),
      `Failed to resolve session directory for ${cwd}`,
    );
  }

  /** 拼出 session 文件路径 */
  private async createSessionFilePath(
    cwd: string,
    sessionId: string,
    timestamp: string,
  ): Promise<string> {
    return getFileSystemResultOrThrow(
      await this.fs.joinPath([
        await this.getSessionDir(cwd),
        `${timestamp.replace(/[:.]/g, "-")}_${sessionId}.jsonl`,
      ]),
      `Failed to resolve session file path for ${sessionId}`,
    );
  }

  // ── SessionRepo 接口 ──

  async create(
    options: JsonlSessionCreateOptions,
  ): Promise<Session<JsonlSessionMetadata>> {
    const id = options.id ?? createSessionId();
    const createdAt = createTimestamp();
    const sessionDir = await this.getSessionDir(options.cwd);
    getFileSystemResultOrThrow(
      await this.fs.createDir(sessionDir, { recursive: true }),
      `Failed to create session directory ${sessionDir}`,
    );
    const filePath = await this.createSessionFilePath(options.cwd, id, createdAt);
    const storage = await JsonlSessionStorage.create(this.fs, filePath, {
      cwd: options.cwd,
      sessionId: id,
      parentSessionPath: options.parentSessionPath,
      metadata: options.metadata,
    });
    return toSession(storage);
  }

  async open(metadata: JsonlSessionMetadata): Promise<Session<JsonlSessionMetadata>> {
    if (
      !getFileSystemResultOrThrow(
        await this.fs.exists(metadata.path),
        `Failed to check session ${metadata.path}`,
      )
    ) {
      throw new SessionError("not_found", `Session not found: ${metadata.path}`);
    }
    const storage = await JsonlSessionStorage.open(this.fs, metadata.path);
    return toSession(storage);
  }

  async list(options: JsonlSessionListOptions = {}): Promise<JsonlSessionMetadata[]> {
    const dirs = options.cwd
      ? [await this.getSessionDir(options.cwd)]
      : await this.listSessionDirs();
    const sessions: JsonlSessionMetadata[] = [];
    for (const dir of dirs) {
      if (
        !getFileSystemResultOrThrow(
          await this.fs.exists(dir),
          `Failed to check session directory ${dir}`,
        )
      ) {
        continue;
      }
      const files = getFileSystemResultOrThrow(
        await this.fs.listDir(dir),
        `Failed to list sessions in ${dir}`,
      ).filter((file) => file.kind !== "directory" && file.name.endsWith(".jsonl"));
      for (const file of files) {
        try {
          sessions.push(await loadJsonlSessionMetadata(this.fs, file.path));
        } catch (error) {
          // 解析失败的 invalid_session 跳过(避免一个坏文件阻塞整个 list)
          const cause = toError(error);
          if (!(cause instanceof SessionError) || cause.code !== "invalid_session") {
            throw cause;
          }
        }
      }
    }
    // 按 createdAt 倒序
    sessions.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return sessions;
  }

  async delete(metadata: JsonlSessionMetadata): Promise<void> {
    getFileSystemResultOrThrow(
      await this.fs.remove(metadata.path, { force: true }),
      `Failed to delete session ${metadata.path}`,
    );
  }

  async fork(
    sourceMetadata: JsonlSessionMetadata,
    options: JsonlSessionCreateOptions & ForkOptions,
  ): Promise<Session<JsonlSessionMetadata>> {
    const source = await this.open(sourceMetadata);
    const forkedEntries = await getEntriesToFork(source.getStorage(), options);
    const id = options.id ?? createSessionId();
    const createdAt = createTimestamp();
    const sessionDir = await this.getSessionDir(options.cwd);
    getFileSystemResultOrThrow(
      await this.fs.createDir(sessionDir, { recursive: true }),
      `Failed to create session directory ${sessionDir}`,
    );
    const storage = await JsonlSessionStorage.create(
      this.fs,
      await this.createSessionFilePath(options.cwd, id, createdAt),
      {
        cwd: options.cwd,
        sessionId: id,
        parentSessionPath: options.parentSessionPath ?? sourceMetadata.path,
        metadata: options.metadata ?? sourceMetadata.metadata,
      },
    );
    for (const entry of forkedEntries) {
      await storage.appendEntry(entry);
    }
    return toSession(storage);
  }

  /** 列出 sessionsRoot 下所有子目录(每个对应一个 cwd) */
  private async listSessionDirs(): Promise<string[]> {
    const sessionsRoot = await this.getSessionsRoot();
    if (
      !getFileSystemResultOrThrow(
        await this.fs.exists(sessionsRoot),
        `Failed to check sessions root ${sessionsRoot}`,
      )
    ) {
      return [];
    }
    const entries = getFileSystemResultOrThrow(
      await this.fs.listDir(sessionsRoot),
      `Failed to list sessions root ${sessionsRoot}`,
    );
    return entries.filter((entry) => entry.kind === "directory").map((entry) => entry.path);
  }
}
