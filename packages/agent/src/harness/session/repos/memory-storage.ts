/**
 * 内存版 SessionStorage。
 *
 * 行为:
 * - entries 存在 `entries: SessionTreeEntry[]`(顺序保持 append 顺序)
 * - byId / labelsById 索引加快查询
 * - leafId 在每次 appendEntry / setLeafId 时更新
 * - 构造时按顺序遍历 entries 重建 leafId(保证打开已有 session 也正确)
 *
 * 用途:测试、单进程内存 session,无需持久化。
 * 持久化场景请用 JsonlSessionStorage(jsonl-storage.ts)。
 *
 * 设计要点:
 * - 私有字段全小写前缀(用 ts private)
 * - 所有 get 方法返回拷贝或新数组,防止外部绕过 appendEntry 改内部状态
 * - setLeafId 必须追加一条 LeafEntry,而不是仅改 leafId 变量
 *   (这样 leaf 迁移历史在树中可追溯,fork / branch_summary 依赖此)
 */

import type { SessionStorage } from "../storage.js";
import type {
  LeafEntry,
  SessionMetadata,
  SessionTreeEntry,
} from "../types.js";
import { SessionError } from "../types.js";
import { generateShortId } from "../uuidv7.js";

// ── 内部工具 ──

/** 更新 label 缓存(label 变化时调用) */
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

/** 遍历 entries 构建 label 缓存 */
function buildLabelsById(entries: SessionTreeEntry[]): Map<string, string> {
  const labelsById = new Map<string, string>();
  for (const entry of entries) {
    updateLabelCache(labelsById, entry);
  }
  return labelsById;
}

/**
 * 根据 entry 计算它之后的 leaf 指向。
 *
 * - leaf entry:指向其 targetId(可能为 null)
 * - 其他 entry:指向其 id
 *
 * 这是"逐 entry 遍历"得到 leaf 终态的依据。
 */
function leafIdAfterEntry(entry: SessionTreeEntry): string | null {
  return entry.type === "leaf" ? entry.targetId : entry.id;
}

// ── 内存 SessionStorage ──

/**
 * 内存版 SessionStorage,无持久化。
 * 适用:测试、单进程短期 session。
 */
export class InMemorySessionStorage<
  TMetadata extends SessionMetadata = SessionMetadata,
> implements SessionStorage<TMetadata> {
  private readonly metadata: TMetadata;
  private entries: SessionTreeEntry[];
  private readonly byId: Map<string, SessionTreeEntry>;
  private readonly labelsById: Map<string, string>;
  private leafId: string | null;

  constructor(options?: {
    entries?: SessionTreeEntry[];
    metadata?: TMetadata;
  }) {
    this.entries = options?.entries ? [...options.entries] : [];
    this.byId = new Map(this.entries.map((entry) => [entry.id, entry]));
    this.labelsById = buildLabelsById(this.entries);

    // 重建 leafId:遍历 entries,每条 entry 都"覆盖"前一条
    // 终态 leafId 等于最后一条 entry 的 leafIdAfterEntry
    this.leafId = null;
    for (const entry of this.entries) {
      this.leafId = leafIdAfterEntry(entry);
    }
    if (this.leafId !== null && !this.byId.has(this.leafId)) {
      throw new SessionError(
        "invalid_session",
        `Entry ${this.leafId} not found`,
      );
    }

    // 默认 metadata
    this.metadata = (options?.metadata ?? {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    }) as TMetadata;
  }

  // ── SessionStorage 接口实现 ──

  async getMetadata(): Promise<TMetadata> {
    return this.metadata;
  }

  async getLeafId(): Promise<string | null> {
    if (this.leafId !== null && !this.byId.has(this.leafId)) {
      throw new SessionError(
        "invalid_session",
        `Entry ${this.leafId} not found`,
      );
    }
    return this.leafId;
  }

  async setLeafId(leafId: string | null): Promise<void> {
    if (leafId !== null && !this.byId.has(leafId)) {
      throw new SessionError("not_found", `Entry ${leafId} not found`);
    }
    const entry: LeafEntry = {
      type: "leaf",
      id: generateShortId(this.byId),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      targetId: leafId,
    };
    this.entries.push(entry);
    this.byId.set(entry.id, entry);
    this.leafId = leafId;
  }

  async createEntryId(): Promise<string> {
    return generateShortId(this.byId);
  }

  async appendEntry(entry: SessionTreeEntry): Promise<void> {
    // 校验 parent 引用
    if (entry.parentId !== null && !this.byId.has(entry.parentId)) {
      throw new SessionError(
        "invalid_session",
        `Entry ${entry.parentId} not found`,
      );
    }
    this.entries.push(entry);
    this.byId.set(entry.id, entry);
    updateLabelCache(this.labelsById, entry);
    this.leafId = leafIdAfterEntry(entry);
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
    if (!current) throw new SessionError("not_found", `Entry ${leafId} not found`);
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
