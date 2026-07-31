/**
 * SessionStorage 接口契约。
 *
 * 从 pi 项目的 SessionStorage 接口翻译,定义"树形 entry 持久化后端"的最小行为。
 * 实现有 InMemorySessionStorage(memory-storage.ts)和 JsonlSessionStorage(jsonl-storage.ts)两种。
 *
 * 设计要点:
 * - 接口是异步的(appendEntry / getEntry 等),便于实现侧选择同步/异步策略
 * - 不暴露"entries 数组"的可变引用,getEntries() 返回拷贝
 * - findEntries 是泛型,按 type 字段字面量 narrow 返回
 *
 * 与 SessionError 的关系:
 * - getLeafId / getEntry / setLeafId 等若发现 entry 不存在,抛 `SessionError("not_found")`
 * - getPathToRoot 若发现链路断裂(子引用父但父不存在),抛 `SessionError("invalid_session")`
 *
 * 拆分理由:
 * - 与 types.ts 区分:types 是"数据形状",storage 是"操作契约"
 * - 接口的演进(新增方法)与数据形状解耦
 */

import type { LeafEntry, SessionMetadata, SessionTreeEntry, JsonlSessionMetadata } from "./types.js";
import type { Session } from "./session.js";

/** SessionRepo 的 create 选项 */
export interface SessionCreateOptions {
  id?: string;
}

/** SessionRepo 的 fork 选项 */
export interface SessionForkOptions {
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
 * Session 仓库接口:管理多个 session 的生命周期。
 *
 * 实现:
 * - `InMemorySessionRepo`(`repos/memory-repo.ts`):测试用
 * - `JsonlSessionRepo`(`repos/jsonl-repo.ts`):JSONL 文件持久化
 *
 * 泛型:
 * - TMetadata:session 元数据形状(基本 SessionMetadata 或 JsonlSessionMetadata)
 * - TCreateOptions:create() 接受的额外选项(因 backend 而异)
 * - TListOptions:list() 接受的过滤选项
 */
export interface SessionRepo<
  TMetadata extends SessionMetadata = SessionMetadata,
  TCreateOptions extends SessionCreateOptions = SessionCreateOptions,
  TListOptions = void,
> {
  /** 创建一个新 session(可能落盘) */
  create(options: TCreateOptions): Promise<Session<TMetadata>>;
  /** 按 metadata 打开已有 session */
  open(metadata: TMetadata): Promise<Session<TMetadata>>;
  /** 列出所有 session 的 metadata */
  list(options?: TListOptions): Promise<TMetadata[]>;
  /** 删除一个 session(可能落盘) */
  delete(metadata: TMetadata): Promise<void>;
  /**
   * 从 source 派生新 session。
   * entryId / position / id 选项见 SessionForkOptions。
   */
  fork(
    source: TMetadata,
    options: SessionForkOptions & TCreateOptions,
  ): Promise<Session<TMetadata>>;
}

// ── JSONL 后端专用类型 ──

/** JSONL SessionRepo 的 create 选项:在通用选项基础上,要求 cwd + 可选 parent */
export interface JsonlSessionCreateOptions extends SessionCreateOptions {
  /** session 归属的 cwd(JSONL 按 cwd 分目录存储) */
  cwd: string;
  /** 父 session 文件路径(fork 时继承) */
  parentSessionPath?: string;
  /** 任意 JSON 可序列化的元数据 */
  metadata?: Record<string, unknown>;
}

/** JSONL SessionRepo 的 list 选项:支持按 cwd 过滤 */
export interface JsonlSessionListOptions {
  /** 只列出该 cwd 下的 session;不传 = 列所有 cwd */
  cwd?: string;
}

/** JSONL SessionRepo 实现的接口类型别名(便于类签名复用) */
export type JsonlSessionRepoApi = SessionRepo<
  JsonlSessionMetadata,
  JsonlSessionCreateOptions,
  JsonlSessionListOptions
>;

/**
 * Session 树形 entry 持久化后端的最小契约。
 *
 * 实现:
 * - `InMemorySessionStorage`(`repos/memory-storage.ts`):测试用,无持久化
 * - `JsonlSessionStorage`(`repos/jsonl-storage.ts`):JSONL 文件持久化
 */
export interface SessionStorage<TMetadata extends SessionMetadata = SessionMetadata> {
  /** 获取 session 元数据(id / createdAt / cwd / path 等) */
  getMetadata(): Promise<TMetadata>;

  /** 获取当前 leaf 指向的 entry id;空 session 返回 null */
  getLeafId(): Promise<string | null>;

  /**
   * 持久化一个 leaf entry,记录"当前活跃的 entry 是 leafId"。
   *
   * 关键:这会**追加一条 LeafEntry 到 entries 树**,而不是简单地改内存变量。
   * 这样 leaf 的迁移历史也可追溯。
   *
   * @throws SessionError("not_found") 当 leafId 指向不存在的 entry
   */
  setLeafId(leafId: string | null): Promise<void>;

  /**
   * 生成一个不与已有 id 冲突的 entry id。
   * 使用 uuidv7 短 id(末 8 位),冲突时重试 100 次,失败兜底用完整 uuid。
   */
  createEntryId(): Promise<string>;

  /**
   * 追加一个 entry 到树。
   *
   * 副作用:
   * - 更新 byId 索引
   * - 更新 labelsById(若是 label entry)
   * - 更新 currentLeafId(若非 leaf entry,leaf = entry.id;若是 leaf entry,leaf = entry.targetId)
   *
   * @throws SessionError("invalid_session") 当 entry.parentId 指向不存在的 entry
   */
  appendEntry(entry: SessionTreeEntry): Promise<void>;

  /**
   * 按 id 查询 entry。
   * @returns entry 或 undefined(不是 throw)
   */
  getEntry(id: string): Promise<SessionTreeEntry | undefined>;

  /**
   * 按 type 字面量过滤所有匹配的 entries。
   * 泛型约束保证返回类型是 `Extract<SessionTreeEntry, { type: TType }>[]`。
   */
  findEntries<TType extends SessionTreeEntry["type"]>(
    type: TType,
  ): Promise<Array<Extract<SessionTreeEntry, { type: TType }>>>;

  /**
   * 获取某个 entry 的最近一个 label(若有)。
   * label entry 自身带 `targetId`,通过 labelsById 缓存快速查找。
   */
  getLabel(id: string): Promise<string | undefined>;

  /**
   * 从 leaf 沿 parentId 链回溯到 root,返回 [root, ..., leaf] 的有序路径。
   * 空 session(leafId=null)返回 []。
   *
   * @throws SessionError("not_found") 当 leafId 指向不存在的 entry
   * @throws SessionError("invalid_session") 当父引用断裂
   */
  getPathToRoot(leafId: string | null): Promise<SessionTreeEntry[]>;

  /**
   * 返回 entries 列表的拷贝(避免外部修改内部状态)。
   */
  getEntries(): Promise<SessionTreeEntry[]>;
}

/** 供 storage 实现复用:append 一条 leaf entry */
export function buildLeafEntry(
  currentLeafId: string | null,
  targetId: string | null,
  newId: string,
  timestamp: string,
): LeafEntry {
  return {
    type: "leaf",
    id: newId,
    parentId: currentLeafId,
    timestamp,
    targetId,
  };
}
