/**
 * SessionManager — 会话文件的 CRUD。
 *
 * 从 pi 项目 core/session-manager.ts 复刻（V1 最小化）。
 * V1 只保留：create / open / continueRecent / inMemory / list /
 *           appendMessage / getSessionId / getSessionFile / getCwd /
 *           getEntries / getHeader / getLeafEntry / buildSessionContext
 */

import type { AgentMessage } from "@mimi/agent";
import { randomUUID } from "crypto";
import { createCompactionSummaryMessage } from "./messages.js";
import {
  appendFileSync,
  closeSync,
  createReadStream,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  statSync,
  writeFileSync,
} from "fs";
import { readdir } from "fs/promises";
import { join, resolve } from "path";
import { createInterface } from "readline";
import { StringDecoder } from "string_decoder";
import { getAgentDir as getDefaultAgentDir } from "../config.js";

/** 当前会话文件格式版本 */
export const CURRENT_SESSION_VERSION = 3;

/** 创建唯一的会话 ID */
function createSessionId(): string {
  return randomUUID();
}

/** 校验会话 ID 格式是否合法 */
export function assertValidSessionId(id: string): void {
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(id)) {
    throw new Error(
      "Session id must be non-empty, contain only alphanumeric characters, '-', '_', and '.', and start and end with an alphanumeric character",
    );
  }
}

/** 生成唯一的短 ID（8 位 hex，带碰撞检测） */
function generateId(byId: { has(id: string): boolean }): string {
  for (let i = 0; i < 100; i++) {
    const id = randomUUID().slice(0, 8);
    if (!byId.has(id)) return id;
  }
  return randomUUID();
}

// ═══════════════════════════════════════════
// 入口类型（V1 最小化）
// ═══════════════════════════════════════════

/** 会话头部——JSONL 文件的第一行 */
export interface SessionHeader {
  type: "session";
  /** 格式版本号 */
  version?: number;
  /** 会话唯一 ID */
  id: string;
  /** 创建时间戳 */
  timestamp: string;
  /** 会话启动时的 cwd */
  cwd: string;
}

/** 会话条目的公共基础字段 */
export interface SessionEntryBase {
  type: string;
  /** 条目唯一 ID */
  id: string;
  /** 父条目 ID，null 表示根条目 */
  parentId: string | null;
  /** 条目时间戳 */
  timestamp: string;
}

/** 消息类型的会话条目 */
export interface SessionMessageEntry extends SessionEntryBase {
  type: "message";
  /** 完整的 agent 消息 */
  message: AgentMessage;
}

/** 思考级别变更条目 */
export interface ThinkingLevelChangeEntry extends SessionEntryBase {
  type: "thinking_level_change";
  /** 思考级别 */
  thinkingLevel: string;
}

/** 模型变更条目 */
export interface ModelChangeEntry extends SessionEntryBase {
  type: "model_change";
  /** provider 标识 */
  provider: string;
  /** 模型 ID */
  modelId: string;
}

/** 会话条目联合类型 */
/** 压缩摘要条目 */
export interface CompactionEntry<T = unknown> extends SessionEntryBase {
  type: "compaction";
  /** 生成的摘要文本 */
  summary: string;
  /** 压缩后第一个被保留的条目 id */
  firstKeptEntryId: string;
  /** 压缩前的 token 数 */
  tokensBefore: number;
  /** 扩展特定数据 */
  details?: T;
  /** 是否由扩展生成 */
  fromHook?: boolean;
}

export type SessionEntry =
  | SessionMessageEntry
  | ThinkingLevelChangeEntry
  | ModelChangeEntry
  | CompactionEntry;

/** 文件条目——包含头部和所有会话条目 */
export type FileEntry = SessionHeader | SessionEntry;

/** 构建后的会话上下文——供 LLM 使用 */
export interface SessionContext {
  /** 从当前叶子回溯得到的消息列表 */
  messages: AgentMessage[];
  /** 当前生效的思考级别 */
  thinkingLevel: string;
  /** 当前生效的模型信息 */
  model: { provider: string; modelId: string } | null;
}

/** 会话概要信息——供会话列表展示 */
export interface SessionInfo {
  /** 会话文件路径 */
  path: string;
  /** 会话 ID */
  id: string;
  /** 工作目录 */
  cwd: string;
  /** 消息数量 */
  messageCount: number;
  /** 第一条用户消息 */
  firstMessage: string;
}

// ═══════════════════════════════════════════
// 条目解析与上下文构建
// ═══════════════════════════════════════════

/** 解析单行 JSONL 为条目；非法行返回 null */
function parseSessionEntryLine(line: string): FileEntry | null {
  if (!line.trim()) return null;
  try { return JSON.parse(line) as FileEntry; } catch { return null; }
}

/** 从会话文件中读取全部条目（同步、流式，按 1MB 分块） */
export function loadEntriesFromFile(filePath: string): FileEntry[] {
  const resolvedFilePath = resolve(filePath);
  if (!existsSync(resolvedFilePath)) return [];
  const entries: FileEntry[] = [];
  const fd = openSync(resolvedFilePath, "r");
  try {
    const decoder = new StringDecoder("utf8");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let pending = "";
    while (true) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      pending += decoder.write(buffer.subarray(0, bytesRead));
      let lineStart = 0;
      let newlineIndex = pending.indexOf("\n", lineStart);
      while (newlineIndex !== -1) {
        const entry = parseSessionEntryLine(pending.slice(lineStart, newlineIndex));
        if (entry) entries.push(entry);
        lineStart = newlineIndex + 1;
        newlineIndex = pending.indexOf("\n", lineStart);
      }
      pending = pending.slice(lineStart);
    }
    pending += decoder.end();
    const finalEntry = parseSessionEntryLine(pending);
    if (finalEntry) entries.push(finalEntry);
  } finally { closeSync(fd); }
  // 校验会话头部
  if (entries.length === 0) return entries;
  const header = entries[0];
  if (header.type !== "session" || typeof (header as { id?: unknown }).id !== "string") return [];
  return entries;
}

/** 用条目构建内存索引（id → 条目） */
function buildEntryIndex(entries: SessionEntry[]): Map<string, SessionEntry> {
  const index = new Map<string, SessionEntry>();
  for (const entry of entries) index.set(entry.id, entry);
  return index;
}

/** 根据叶子 ID 从树中间溯到根，返回路径上的所有条目 */
function buildSessionPath(entries: SessionEntry[], leafId: string | null): SessionEntry[] {
  const index = buildEntryIndex(entries);
  if (leafId === null) return [];
  let leaf = leafId ? index.get(leafId) : undefined;
  leaf ??= entries[entries.length - 1];
  if (!leaf) return [];
  const path: SessionEntry[] = [];
  let current: SessionEntry | undefined = leaf;
  while (current) {
    path.push(current);
    current = current.parentId ? index.get(current.parentId) : undefined;
  }
  path.reverse();
  return path;
}

/** 沿路径读取最近一次的 thinkingLevel 和 model 设置 */
function getSessionContextSettings(path: SessionEntry[]): Pick<SessionContext, "thinkingLevel" | "model"> {
  let thinkingLevel = "off";
  let model: { provider: string; modelId: string } | null = null;
  for (const entry of path) {
    if (entry.type === "thinking_level_change") thinkingLevel = entry.thinkingLevel;
    else if (entry.type === "model_change") model = { provider: entry.provider, modelId: entry.modelId };
    else if (entry.type === "message" && entry.message.role === "assistant") {
      model = { provider: entry.message.provider, modelId: entry.message.model };
    }
  }
  return { thinkingLevel, model };
}

/** 将单个会话条目投影为 LLM/运行时消息 */
export function sessionEntryToContextMessages(entry: SessionEntry): AgentMessage[] {
  if (entry.type === "message") {
    const message = entry.message;
    if ((message.role === "user" || message.role === "assistant" || message.role === "toolResult") && message.content == null) {
      return [{ ...message, content: [] }];
    }
    return [message];
  }
  if (entry.type === "compaction") {
    return [createCompactionSummaryMessage(entry.summary, entry.tokensBefore, entry.timestamp) as any];
  }
  return [];
}

/** 构建会话上下文——从当前叶子回溯，返回供 LLM 使用的消息列表 */
export function buildSessionContext(
  entries: SessionEntry[],
  leafId: string | null = null,
): SessionContext {
  const path = buildSessionPath(entries, leafId);
  const { thinkingLevel, model } = getSessionContextSettings(path);
  const messages = path.flatMap(sessionEntryToContextMessages);
  return { messages, thinkingLevel, model };
}

// ═══════════════════════════════════════════
// 会话目录管理
// ═══════════════════════════════════════════

/** 路径解析辅助 */
function resolvePath(p: string): string { return resolve(p); }

/** 路径规范化辅助 */
function normalizePath(p: string): string { return resolve(p); }

/** 计算指定 cwd 的默认会话目录路径——将 cwd 编码为安全目录名 */
function getDefaultSessionDirPath(cwd: string, agentDir: string = getDefaultAgentDir()): string {
  const resolvedCwd = resolvePath(cwd);
  const resolvedAgentDir = resolvePath(agentDir);
  const safePath = `--${resolvedCwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  return join(resolvedAgentDir, "sessions", safePath);
}

/** 获取默认会话目录，不存在时自动创建 */
export function getDefaultSessionDir(cwd: string, agentDir: string = getDefaultAgentDir()): string {
  const sessionDir = getDefaultSessionDirPath(cwd, agentDir);
  if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true });
  return sessionDir;
}

/** 尽力读取会话头部，用于会话发现 */
function readSessionHeaderForDiscovery(filePath: string): SessionHeader | null {
  const fd = openSync(filePath, "r");
  try {
    const decoder = new StringDecoder("utf8");
    const buffer = Buffer.allocUnsafe(4096);
    const bytesRead = readSync(fd, buffer, 0, buffer.length, null);
    if (bytesRead === 0) return null;
    const firstLine = decoder.write(buffer.subarray(0, bytesRead)).split("\n")[0];
    const entry = parseSessionEntryLine(firstLine);
    if (entry?.type === "session") return entry;
    return null;
  } finally { closeSync(fd); }
}

/** 检查会话头部 cwd 是否匹配目标工作目录 */
function sessionCwdMatches(cwd: string | undefined, resolvedCwd: string): boolean {
  return cwd !== undefined && cwd !== "" && resolvePath(cwd) === resolvedCwd;
}

/** 提取头部中的 cwd 字段 */
function getSessionHeaderCwd(header: SessionHeader): string | undefined {
  const cwd = (header as { cwd?: unknown }).cwd;
  return typeof cwd === "string" ? cwd : undefined;
}

/** 查找目录下最近的会话文件 */
export function findMostRecentSession(sessionDir: string, cwd?: string): string | null {
  const resolvedSessionDir = normalizePath(sessionDir);
  const resolvedCwd = cwd ? resolvePath(cwd) : undefined;
  try {
    const files = readdirSync(resolvedSessionDir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => join(resolvedSessionDir, f))
      .map((path) => ({ path, header: readSessionHeaderForDiscovery(path) }))
      .filter((file): file is { path: string; header: SessionHeader } =>
        file.header !== null && (!resolvedCwd || sessionCwdMatches(getSessionHeaderCwd(file.header), resolvedCwd)))
      .map(({ path }) => ({ path, mtime: statSync(path).mtime }))
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    return files[0]?.path || null;
  } catch { return null; }
}

/** 构建单个会话文件的概要信息 */
async function buildSessionInfo(filePath: string): Promise<SessionInfo | null> {
  try {
    let header: SessionHeader | null = null;
    let messageCount = 0;
    let firstMessage = "";
    const rl = createInterface({ input: createReadStream(filePath, { encoding: "utf8" }), crlfDelay: Infinity });
    for await (const line of rl) {
      const entry = parseSessionEntryLine(line);
      if (!entry) continue;
      if (!header) {
        if (entry.type !== "session") return null;
        header = entry;
        continue;
      }
      if (entry.type !== "message") continue;
      messageCount++;
      if (!firstMessage && entry.message.role === "user") {
        const content = entry.message.content;
        firstMessage = typeof content === "string" ? content : Array.isArray(content) ? content.filter((c: any) => c.type === "text").map((c: any) => c.text).join(" ") : "";
      }
    }
    if (!header) return null;
    const cwd = typeof header.cwd === "string" ? header.cwd : "";
    return { path: filePath, id: header.id, cwd, messageCount, firstMessage: firstMessage || "(no messages)" };
  } catch { return null; }
}

/** 并发生成目录下所有会话文件的概要信息 */
async function listSessionsFromDir(dir: string): Promise<SessionInfo[]> {
  const sessions: SessionInfo[] = [];
  if (!existsSync(dir)) return sessions;
  try {
    const dirEntries = await readdir(dir);
    const files = dirEntries.filter((f) => f.endsWith(".jsonl")).map((f) => join(dir, f));
    for (const file of files) {
      const info = await buildSessionInfo(file);
      if (info) sessions.push(info);
    }
  } catch { /* 目录访问失败，返回空列表 */ }
  return sessions;
}

// ═══════════════════════════════════════════
// SessionManager 类
// ═══════════════════════════════════════════

/**
 * 将会话作为仅追加的树来管理，存储在 JSONL 文件中。
 *
 * 使用 buildSessionContext() 获取供 LLM 使用的解析后的消息列表，
 * 它沿着从根到当前叶子的路径行走。
 */
export class SessionManager {
  /** 当前会话的唯一 ID（头部中的 id） */
  private sessionId: string = "";
  /** 当前会话文件路径；未持久化时为 undefined */
  private sessionFile: string | undefined;
  /** 会话目录（存放 .jsonl 会话文件的目录） */
  private sessionDir: string;
  /** 会话启动时的工作目录 */
  private cwd: string;
  /** 是否持久化到磁盘 */
  private persist: boolean;
  /** 是否已将头部写入磁盘 */
  private flushed: boolean = false;
  /** 从会话文件读取的全部条目（含头部） */
  private fileEntries: FileEntry[] = [];
  /** 条目索引：id → 条目 */
  private byId: Map<string, SessionEntry> = new Map();
  /** 当前叶子条目 id；null 表示无条目 */
  private leafId: string | null = null;

  private constructor(
    cwd: string, sessionDir: string, sessionFile: string | undefined,
    persist: boolean, newSessionId?: string,
  ) {
    this.cwd = resolvePath(cwd);
    this.sessionDir = normalizePath(sessionDir);
    this.persist = persist;
    if (persist && this.sessionDir && !existsSync(this.sessionDir)) mkdirSync(this.sessionDir, { recursive: true });
    if (sessionFile) this._setSessionFile(sessionFile);
    else this.newSession(newSessionId);
  }

  /** 切换到不同的会话文件 */
  private _setSessionFile(sessionFile: string): void {
    this.sessionFile = resolvePath(sessionFile);
    if (existsSync(this.sessionFile)) {
      this.fileEntries = loadEntriesFromFile(this.sessionFile);
      if (this.fileEntries.length === 0) {
        if (statSync(this.sessionFile).size > 0) throw new Error(`Invalid session file: ${this.sessionFile}`);
        this.newSession();
        this._rewriteFile();
        this.flushed = true;
        return;
      }
      const header = this.fileEntries.find((e) => e.type === "session") as SessionHeader | undefined;
      this.sessionId = header?.id ?? createSessionId();
      this._buildIndex();
      this.flushed = true;
    } else {
      this.newSession();
    }
  }

  /** 创建一个新会话 */
  newSession(id?: string): string | undefined {
    if (id !== undefined) assertValidSessionId(id);
    this.sessionId = id ?? createSessionId();
    const timestamp = new Date().toISOString();
    const header: SessionHeader = {
      type: "session", version: CURRENT_SESSION_VERSION,
      id: this.sessionId, timestamp, cwd: this.cwd,
    };
    this.fileEntries = [header];
    this.byId.clear();
    this.leafId = null;
    this.flushed = false;
    if (this.persist) {
      const fileTimestamp = timestamp.replace(/[:.]/g, "-");
      this.sessionFile = join(this.getSessionDir(), `${fileTimestamp}_${this.sessionId}.jsonl`);
    }
    return this.sessionFile;
  }

  /** 从 fileEntries 全量重建内存索引 */
  private _buildIndex(): void {
    this.byId.clear();
    this.leafId = null;
    for (const entry of this.fileEntries) {
      if (entry.type === "session") continue;
      this.byId.set(entry.id, entry);
      this.leafId = entry.id;
    }
  }

  /** 将全部内存条目整体重写回文件 */
  private _rewriteFile(): void {
    if (!this.persist || !this.sessionFile) return;
    const fd = openSync(this.sessionFile, "w");
    try { for (const entry of this.fileEntries) writeFileSync(fd, `${JSON.stringify(entry)}\n`); }
    finally { closeSync(fd); }
  }

  /** 是否持久化到磁盘 */
  isPersisted(): boolean { return this.persist; }

  /** 获取会话工作目录 */
  getCwd(): string { return this.cwd; }

  /** 获取会话目录 */
  getSessionDir(): string { return this.sessionDir; }

  /** 获取会话 ID */
  getSessionId(): string { return this.sessionId; }

  /** 获取会话文件路径（未持久化时为 undefined） */
  getSessionFile(): string | undefined { return this.sessionFile; }

  /**
   * 持久化单条条目——已有 assistant 后走追加，否则延迟到首条 assistant 时整文件写入。
   * 对调用方透明：入队和磁盘写入的顺序与父级在内存中的顺序一致。
   */
  _persist(entry: SessionEntry): void {
    if (!this.persist || !this.sessionFile) return;
    const hasAssistant = this.fileEntries.some((e) => e.type === "message" && e.message.role === "assistant");
    if (!hasAssistant) { this.flushed = false; return; }
    if (!this.flushed) {
      const fd = openSync(this.sessionFile, "wx");
      try { for (const e of this.fileEntries) writeFileSync(fd, `${JSON.stringify(e)}\n`); }
      finally { closeSync(fd); }
      this.flushed = true;
    } else {
      appendFileSync(this.sessionFile, `${JSON.stringify(entry)}\n`);
    }
  }

  /** 追加条目到内存（fileEntries/byId/leafId）并持久化 */
  private _appendEntry(entry: SessionEntry): void {
    this.fileEntries.push(entry);
    this.byId.set(entry.id, entry);
    this.leafId = entry.id;
    this._persist(entry);
  }

  /** 在当前叶子下追加一条消息作为子条目，然后推进叶子。返回条目 id */
  appendMessage(message: AgentMessage): string {
    const entry: SessionMessageEntry = {
      type: "message", id: generateId(this.byId), parentId: this.leafId,
      timestamp: new Date().toISOString(), message,
    };
    this._appendEntry(entry);
    return entry.id;
  }

  /** 在当前叶子下追加一条思考级别变更，然后推进叶子。返回条目 id */
  appendThinkingLevelChange(thinkingLevel: string): string {
    const entry: ThinkingLevelChangeEntry = {
      type: "thinking_level_change", id: generateId(this.byId), parentId: this.leafId,
      timestamp: new Date().toISOString(), thinkingLevel,
    };
    this._appendEntry(entry);
    return entry.id;
  }

  /** 在当前叶子下追加一条模型变更，然后推进叶子。返回条目 id */
  appendModelChange(provider: string, modelId: string): string {
    const entry: ModelChangeEntry = {
      type: "model_change", id: generateId(this.byId), parentId: this.leafId,
      timestamp: new Date().toISOString(), provider, modelId,
    };
    this._appendEntry(entry);
    return entry.id;
  }

  /** 在当前叶子下追加一条压缩摘要，然后推进叶子。返回条目 id */
  appendCompaction<T = unknown>(
    summary: string,
    firstKeptEntryId: string,
    tokensBefore: number,
    details?: T,
    fromHook?: boolean,
  ): string {
    const entry: CompactionEntry<T> = {
      type: "compaction", id: generateId(this.byId), parentId: this.leafId,
      timestamp: new Date().toISOString(), summary, firstKeptEntryId, tokensBefore, details, fromHook,
    };
    this._appendEntry(entry);
    return entry.id;
  }

  /** 获取当前叶子 ID */
  getLeafId(): string | null { return this.leafId; }

  /** 获取当前叶子条目 */
  getLeafEntry(): SessionEntry | undefined { return this.leafId ? this.byId.get(this.leafId) : undefined; }

  /** 获取所有会话条目（不含头部）。返回浅拷贝 */
  getEntries(): SessionEntry[] {
    return this.fileEntries.filter((e): e is SessionEntry => e.type !== "session");
  }

  /** 获取会话头部 */
  getHeader(): SessionHeader | null {
    const h = this.fileEntries.find((e) => e.type === "session");
    return h ? (h as SessionHeader) : null;
  }

  /** 构建会话上下文——从当前叶子出发，返回供 LLM 使用的消息列表 */
  buildSessionContext(): SessionContext {
    return buildSessionContext(this.getEntries(), this.leafId);
  }

  // ═══════════════════════════════════════════
  // 静态工厂方法
  // ═══════════════════════════════════════════

  /** 创建新会话 */
  static create(cwd: string, sessionDir?: string, options?: { id?: string }): SessionManager {
    const dir = sessionDir ? normalizePath(sessionDir) : getDefaultSessionDir(cwd);
    return new SessionManager(cwd, dir, undefined, true, options?.id);
  }

  /** 打开指定的会话文件 */
  static open(path: string, sessionDir?: string): SessionManager {
    const resolvedPath = resolvePath(path);
    let header: SessionHeader | null = null;
    if (existsSync(resolvedPath)) { header = readSessionHeaderForDiscovery(resolvedPath); }
    const cwd = (header ? getSessionHeaderCwd(header) : undefined) ?? process.cwd();
    const dir = sessionDir ? normalizePath(sessionDir) : resolve(resolvedPath, "..");
    return new SessionManager(cwd, dir, resolvedPath, true);
  }

  /** 继续最近的会话；若没有则创建新会话 */
  static continueRecent(cwd: string, sessionDir?: string): SessionManager {
    const dir = sessionDir ? normalizePath(sessionDir) : getDefaultSessionDir(cwd);
    const filterCwd = sessionDir !== undefined && dir !== getDefaultSessionDirPath(cwd);
    const mostRecent = findMostRecentSession(dir, filterCwd ? cwd : undefined);
    if (mostRecent) return new SessionManager(cwd, dir, mostRecent, true);
    return new SessionManager(cwd, dir, undefined, true);
  }

  /** 创建一个内存会话（不持久化到文件） */
  static inMemory(cwd: string = process.cwd(), options?: { id?: string }): SessionManager {
    return new SessionManager(cwd, "", undefined, false, options?.id);
  }

  /** 列出一个目录下的所有会话 */
  static async list(cwd: string, sessionDir?: string): Promise<SessionInfo[]> {
    const dir = sessionDir ? normalizePath(sessionDir) : getDefaultSessionDir(cwd);
    const filterCwd = sessionDir !== undefined && dir !== getDefaultSessionDirPath(cwd);
    const resolvedCwd = resolvePath(cwd);
    const sessions = (await listSessionsFromDir(dir)).filter((session) => !filterCwd || sessionCwdMatches(session.cwd, resolvedCwd));
    return sessions;
  }

  /** 列出所有项目目录下的所有会话（V1 桩——不支持全局会话目录） */
  static async listAll(): Promise<SessionInfo[]> {
    return [];
  }
}
