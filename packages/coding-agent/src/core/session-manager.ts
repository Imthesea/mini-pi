/**
 * SessionManager —— Session 文件 CRUD 操作。
 *
 * 对齐 pi 项目的 SessionManager。底层直接操作 JSONL 文件。
 * 每条 entry 以 JSON 行写入，读时逐行 parse。
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { join, basename } from "node:path";

// ── 常量 ──

const SESSION_FILE_EXT = ".jsonl";
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

// ── 类型 ──

export interface SessionInfo {
  id: string;
  path: string;
  cwd: string;
  mtime: number;
}

export interface SessionEntry {
  type: string;
  role?: string;
  content: string;
  timestamp: number;
  [key: string]: any;
}

// ── 工具 ──

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ── SessionManager ──

export class SessionManager {
  private _id: string;
  private _path: string | undefined;
  private _cwd: string;
  private _closed: boolean;

  private constructor(cwd: string, id: string, path?: string) {
    this._cwd = cwd;
    this._id = id;
    this._path = path;
    this._closed = false;
  }

  // ═══════════════════════════════════════════
  // 静态工厂
  // ═══════════════════════════════════════════

  static create(
    cwd: string,
    sessionDir?: string,
    options?: { id?: string },
  ): SessionManager {
    const dir = sessionDir ?? join(cwd, ".mimi", "sessions");
    const id = options?.id ?? generateId();
    mkdirSync(dir, { recursive: true });

    const filePath = join(dir, `${id}${SESSION_FILE_EXT}`);
    // 创建空 JSONL 文件，确保后续 open/list 能找到
    writeFileSync(filePath, "", "utf-8");
    return new SessionManager(cwd, id, filePath);
  }

  static open(filePath: string, _sessionDir?: string): SessionManager {
    if (!existsSync(filePath)) {
      throw new Error(`Session file not found: ${filePath}`);
    }
    const id = basename(filePath, SESSION_FILE_EXT);
    return new SessionManager("", id, filePath);
  }

  static continueRecent(
    cwd: string,
    sessionDir?: string,
  ): SessionManager {
    const dir = sessionDir ?? join(cwd, ".mimi", "sessions");
    if (!existsSync(dir)) {
      return SessionManager.create(cwd, sessionDir);
    }

    const files = readdirSync(dir)
      .filter((f) => f.endsWith(SESSION_FILE_EXT))
      .map((f) => ({
        id: basename(f, SESSION_FILE_EXT),
        path: join(dir, f),
      }));

    if (files.length === 0) {
      return SessionManager.create(cwd, sessionDir);
    }

    // 找 mtime 最新的
    let latest = files[0];
    let latestMtime = statSync(latest.path).mtimeMs;
    for (const f of files.slice(1)) {
      const mtime = statSync(f.path).mtimeMs;
      if (mtime > latestMtime) {
        latest = f;
        latestMtime = mtime;
      }
    }

    if (Date.now() - latestMtime < RECENT_WINDOW_MS) {
      return SessionManager.open(latest.path, sessionDir);
    }

    return SessionManager.create(cwd, sessionDir);
  }

  static inMemory(
    _cwd: string,
    options?: { id?: string },
  ): SessionManager {
    return new SessionManager(_cwd, options?.id ?? generateId());
  }

  static list(cwd: string, sessionDir?: string): SessionInfo[] {
    const dir = sessionDir ?? join(cwd, ".mimi", "sessions");
    if (!existsSync(dir)) return [];

    return readdirSync(dir)
      .filter((f) => f.endsWith(SESSION_FILE_EXT))
      .map((f) => {
        const path = join(dir, f);
        const stat = statSync(path);
        return {
          id: basename(f, SESSION_FILE_EXT),
          path,
          cwd,
          mtime: stat.mtimeMs,
        };
      })
      .sort((a, b) => b.mtime - a.mtime);
  }

  static listAll(_sessionDir?: string): SessionInfo[] {
    // V1: 只在当前 cwd 下查找，后续实现跨项目搜索
    return [];
  }

  // ═══════════════════════════════════════════
  // 实例
  // ═══════════════════════════════════════════

  get id(): string {
    return this._id;
  }

  get path(): string | undefined {
    return this._path;
  }

  async appendEntry(entry: SessionEntry): Promise<void> {
    if (this._closed) return;
    if (this._path) {
      const line = JSON.stringify(entry) + "\n";
      await appendFile(this._path, line, "utf-8");
    }
    // inMemory: no-op
  }

  readEntries(): SessionEntry[] {
    if (!this._path || !existsSync(this._path)) return [];
    const content = readFileSync(this._path, "utf-8");
    if (!content.trim()) return [];
    return content
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  }

  close(): void {
    this._closed = true;
  }
}
