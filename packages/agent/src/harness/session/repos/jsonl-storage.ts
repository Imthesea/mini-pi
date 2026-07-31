/**
 * JSONL SessionStorage。
 *
 * 行为:
 * - 一个 session 一个 JSONL 文件(`<sessionsRoot>/<encodedCwd>/<timestamp>_<id>.jsonl`)
 * - 第 1 行是 session header(type="session" version=3,带 cwd / id / timestamp / parentSession)
 * - 后续每行一条 entry(JSON 序列化)
 * - appendEntry / setLeafId 都用同步 `fs.appendFile`(单 session 单写,无并发风险)
 * - 启动时全文件 reload 到 entries 数组 + byId 索引 + leafId
 *
 * 与 InMemorySessionStorage 的关系:
 * - 实现相同接口,但底层是文件
 * - 私有构造,只能通过 `JsonlSessionStorage.create` / `JsonlSessionStorage.open` 初始化
 *   (因为必须先有 header 才能构造)
 *
 * FileSystem 注入:
 * - 本类只接受一个最小化的 FileSystem 子集
 *   (readTextFile / readTextLines / writeFile / appendFile)
 * - 这样可以 mock(测试用内存 fs)或用 NodeExecutionEnv(生产)
 */

import { toError, FileError, SessionError } from "../types.js";
import type {
  FileError as FileErrorT,
  JsonlSessionMetadata,
  LeafEntry,
  Result,
  SessionTreeEntry,
} from "../types.js";
import type { SessionStorage } from "../storage.js";
import { generateShortId } from "../uuidv7.js";
import { getFileSystemResultOrThrow } from "../repo-utils.js";

// ── JSONL 文件系统子集 ──

/** JSONL session storage 需要的最小文件系统接口(便于 mock) */
export interface JsonlSessionStorageFileSystem {
  readTextFile(path: string): Promise<Result<string, FileErrorT>>;
  readTextLines(
    path: string,
    options?: { maxLines?: number },
  ): Promise<Result<string[], FileErrorT>>;
  writeFile(
    path: string,
    content: string,
  ): Promise<Result<void, FileErrorT>>;
  appendFile(
    path: string,
    content: string,
  ): Promise<Result<void, FileErrorT>>;
}

// ── Session Header ──

/** JSONL 文件第 1 行格式 */
interface SessionHeader {
  type: "session";
  /** 当前固定 3(向后兼容) */
  version: 3;
  id: string;
  /** ISO 8601 时间戳 */
  timestamp: string;
  cwd: string;
  parentSession?: string;
  metadata?: Record<string, unknown>;
}

// ── 内部工具(从 memory-storage 复用的部分) ──

function updateLabelCache(
  labelsById: Map<string, string>,
  entry: SessionTreeEntry,
): void {
  if (entry.type !== "label") return;
  const label = entry.label?.trim();
  if (label) {
    labelsById.set(entry.targetId, label);
  } else {
    labelsById.delete(entry.targetId);
  }
}

function buildLabelsById(entries: SessionTreeEntry[]): Map<string, string> {
  const labelsById = new Map<string, string>();
  for (const entry of entries) {
    updateLabelCache(labelsById, entry);
  }
  return labelsById;
}

function leafIdAfterEntry(entry: SessionTreeEntry): string | null {
  return entry.type === "leaf" ? entry.targetId : entry.id;
}

function invalidSession(
  filePath: string,
  message: string,
  cause?: Error,
): SessionError {
  return new SessionError(
    "invalid_session",
    `Invalid JSONL session file ${filePath}: ${message}`,
    cause,
  );
}

function invalidEntry(
  filePath: string,
  lineNumber: number,
  message: string,
  cause?: Error,
): SessionError {
  return new SessionError(
    "invalid_entry",
    `Invalid JSONL session file ${filePath}: line ${lineNumber} ${message}`,
    cause,
  );
}

// ── Header / Entry 解析 ──

/** 解析第 1 行 header,失败抛 SessionError */
function parseHeaderLine(
  line: string,
  filePath: string,
): SessionHeader {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    throw invalidSession(filePath, "first line is not a valid session header", toError(error));
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw invalidSession(filePath, "first line is not a valid session header");
  }
  const header = parsed as Partial<SessionHeader>;
  if (header.type !== "session") {
    throw invalidSession(filePath, "first line is not a valid session header");
  }
  if (header.version !== 3) {
    throw invalidSession(filePath, "unsupported session version");
  }
  if (typeof header.id !== "string" || !header.id) {
    throw invalidSession(filePath, "session header is missing id");
  }
  if (typeof header.timestamp !== "string" || !header.timestamp) {
    throw invalidSession(filePath, "session header is missing timestamp");
  }
  if (typeof header.cwd !== "string" || !header.cwd) {
    throw invalidSession(filePath, "session header is missing cwd");
  }
  if (header.parentSession !== undefined && typeof header.parentSession !== "string") {
    throw invalidSession(filePath, "session header parentSession must be a string");
  }
  if (
    header.metadata !== undefined &&
    (typeof header.metadata !== "object" || header.metadata === null || Array.isArray(header.metadata))
  ) {
    throw invalidSession(filePath, "session header metadata must be an object");
  }
  return {
    type: "session",
    version: 3,
    id: header.id,
    timestamp: header.timestamp,
    cwd: header.cwd,
    parentSession: header.parentSession,
    metadata: header.metadata,
  };
}

/** 解析一条 entry,失败抛 SessionError */
function parseEntryLine(
  line: string,
  filePath: string,
  lineNumber: number,
): SessionTreeEntry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    throw invalidEntry(filePath, lineNumber, "is not valid JSON", toError(error));
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw invalidEntry(filePath, lineNumber, "is not a valid session entry");
  }
  const entry = parsed as {
    type?: unknown;
    id?: unknown;
    parentId?: unknown;
    timestamp?: unknown;
    targetId?: unknown;
  };
  if (typeof entry.type !== "string") {
    throw invalidEntry(filePath, lineNumber, "is missing entry type");
  }
  if (typeof entry.id !== "string" || !entry.id) {
    throw invalidEntry(filePath, lineNumber, "is missing entry id");
  }
  if (entry.parentId !== null && typeof entry.parentId !== "string") {
    throw invalidEntry(filePath, lineNumber, "has invalid parentId");
  }
  if (typeof entry.timestamp !== "string" || !entry.timestamp) {
    throw invalidEntry(filePath, lineNumber, "is missing timestamp");
  }
  if (entry.type === "leaf" && entry.targetId !== null && typeof entry.targetId !== "string") {
    throw invalidEntry(filePath, lineNumber, "has invalid targetId");
  }
  return entry as unknown as SessionTreeEntry;
}

function headerToSessionMetadata(
  header: SessionHeader,
  path: string,
): JsonlSessionMetadata {
  return {
    id: header.id,
    createdAt: header.timestamp,
    cwd: header.cwd,
    path,
    parentSessionPath: header.parentSession,
    metadata: header.metadata,
  };
}

// ── 公开 loadJsonlSessionMetadata(给 JsonlSessionRepo.list 用) ──

/**
 * 只读取 header 行的元数据(用于 list 场景,避免加载全部 entries)。
 * 失败抛 SessionError。
 */
export async function loadJsonlSessionMetadata(
  fs: JsonlSessionStorageFileSystem,
  filePath: string,
): Promise<JsonlSessionMetadata> {
  const lines = getFileSystemResultOrThrow(
    await fs.readTextLines(filePath, { maxLines: 1 }),
    `Failed to read session header ${filePath}`,
  );
  const line = lines[0];
  if (line?.trim()) {
    return headerToSessionMetadata(parseHeaderLine(line, filePath), filePath);
  }
  throw invalidSession(filePath, "missing session header");
}

/** 完整加载一个 session 文件(header + 全部 entries) */
async function loadJsonlStorage(
  fs: JsonlSessionStorageFileSystem,
  filePath: string,
): Promise<{
  header: SessionHeader;
  entries: SessionTreeEntry[];
  leafId: string | null;
}> {
  const content = getFileSystemResultOrThrow(
    await fs.readTextFile(filePath),
    `Failed to read session ${filePath}`,
  );
  const lines = content.split("\n").filter((line) => line.trim());
  if (lines.length === 0) {
    throw invalidSession(filePath, "missing session header");
  }

  const header = parseHeaderLine(lines[0]!, filePath);
  const entries: SessionTreeEntry[] = [];
  let leafId: string | null = null;
  for (let i = 1; i < lines.length; i++) {
    const entry = parseEntryLine(lines[i]!, filePath, i + 1);
    entries.push(entry);
    leafId = leafIdAfterEntry(entry);
  }
  return { header, entries, leafId };
}

// ── JsonlSessionStorage 主类 ──

/**
 * JSONL 文件版 SessionStorage。
 *
 * 私有构造,只能通过 `JsonlSessionStorage.create` / `JsonlSessionStorage.open` 初始化。
 */
export class JsonlSessionStorage
  implements SessionStorage<JsonlSessionMetadata>
{
  private readonly fs: JsonlSessionStorageFileSystem;
  private readonly filePath: string;
  private readonly metadata: JsonlSessionMetadata;
  private entries: SessionTreeEntry[];
  private readonly byId: Map<string, SessionTreeEntry>;
  private readonly labelsById: Map<string, string>;
  private currentLeafId: string | null;

  private constructor(
    fs: JsonlSessionStorageFileSystem,
    filePath: string,
    header: SessionHeader,
    entries: SessionTreeEntry[],
    leafId: string | null,
  ) {
    this.fs = fs;
    this.filePath = filePath;
    this.metadata = headerToSessionMetadata(header, this.filePath);
    this.entries = entries;
    this.byId = new Map(entries.map((entry) => [entry.id, entry]));
    this.labelsById = buildLabelsById(entries);
    this.currentLeafId = leafId;
  }

  /** 打开一个已存在的 JSONL 文件 */
  static async open(
    fs: JsonlSessionStorageFileSystem,
    filePath: string,
  ): Promise<JsonlSessionStorage> {
    const loaded = await loadJsonlStorage(fs, filePath);
    return new JsonlSessionStorage(
      fs,
      filePath,
      loaded.header,
      loaded.entries,
      loaded.leafId,
    );
  }

  /** 创建新 JSONL session(写 header) */
  static async create(
    fs: JsonlSessionStorageFileSystem,
    filePath: string,
    options: {
      cwd: string;
      sessionId: string;
      parentSessionPath?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<JsonlSessionStorage> {
    const header: SessionHeader = {
      type: "session",
      version: 3,
      id: options.sessionId,
      timestamp: new Date().toISOString(),
      cwd: options.cwd,
      parentSession: options.parentSessionPath,
      metadata: options.metadata,
    };
    getFileSystemResultOrThrow(
      await fs.writeFile(filePath, `${JSON.stringify(header)}\n`),
      `Failed to create session ${filePath}`,
    );
    return new JsonlSessionStorage(fs, filePath, header, [], null);
  }

  // ── SessionStorage 接口 ──

  async getMetadata(): Promise<JsonlSessionMetadata> {
    return this.metadata;
  }

  async getLeafId(): Promise<string | null> {
    if (this.currentLeafId !== null && !this.byId.has(this.currentLeafId)) {
      throw new SessionError(
        "invalid_session",
        `Entry ${this.currentLeafId} not found`,
      );
    }
    return this.currentLeafId;
  }

  async setLeafId(leafId: string | null): Promise<void> {
    if (leafId !== null && !this.byId.has(leafId)) {
      throw new SessionError("not_found", `Entry ${leafId} not found`);
    }
    const entry: LeafEntry = {
      type: "leaf",
      id: generateShortId(this.byId),
      parentId: this.currentLeafId,
      timestamp: new Date().toISOString(),
      targetId: leafId,
    };
    getFileSystemResultOrThrow(
      await this.fs.appendFile(this.filePath, `${JSON.stringify(entry)}\n`),
      `Failed to append session leaf ${entry.id}`,
    );
    this.entries.push(entry);
    this.byId.set(entry.id, entry);
    this.currentLeafId = leafId;
  }

  async createEntryId(): Promise<string> {
    return generateShortId(this.byId);
  }

  async appendEntry(entry: SessionTreeEntry): Promise<void> {
    getFileSystemResultOrThrow(
      await this.fs.appendFile(this.filePath, `${JSON.stringify(entry)}\n`),
      `Failed to append session entry ${entry.id}`,
    );
    this.entries.push(entry);
    this.byId.set(entry.id, entry);
    updateLabelCache(this.labelsById, entry);
    this.currentLeafId = leafIdAfterEntry(entry);
  }

  async getEntry(id: string): Promise<SessionTreeEntry | undefined> {
    return this.byId.get(id);
  }

  async findEntries<TType extends SessionTreeEntry["type"]>(
    type: TType,
  ): Promise<Array<Extract<SessionTreeEntry, { type: TType }>>> {
    return this.entries.filter(
      (entry): entry is Extract<SessionTreeEntry, { type: TType }> =>
        entry.type === type,
    );
  }

  async getLabel(id: string): Promise<string | undefined> {
    return this.labelsById.get(id);
  }

  async getPathToRoot(leafId: string | null): Promise<SessionTreeEntry[]> {
    if (leafId === null) return [];
    const path: SessionTreeEntry[] = [];
    let current = this.byId.get(leafId);
    if (!current) {
      throw new SessionError("not_found", `Entry ${leafId} not found`);
    }
    while (current) {
      path.unshift(current);
      if (!current.parentId) break;
      const parent = this.byId.get(current.parentId);
      if (!parent) {
        throw new SessionError(
          "invalid_session",
          `Entry ${current.parentId} not found`,
        );
      }
      current = parent;
    }
    return path;
  }

  async getEntries(): Promise<SessionTreeEntry[]> {
    return [...this.entries];
  }
}

// 抑制 "FileError is imported but never used" 警告(FileError 是导出类型给外部用)
export { FileError };
