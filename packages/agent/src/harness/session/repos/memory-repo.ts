/**
 * 内存 SessionRepo。
 *
 * 职责:管理 InMemorySessionStorage 实例的"仓库"——提供
 * - create:开新 session
 * - open:按 metadata 找回已有 session
 * - list:列出所有 session metadata
 * - delete:关闭并删除 session
 * - fork:从 source 派生新 session(可指定 fork 起点)
 *
 * 与 JsonlSessionRepo 的关系:
 * - 共享 SessionRepo 接口
 * - 行为完全一致,只是底层 storage 不同
 *
 * 拆分理由:
 * - repo 是"session 集合管理",与单个 session 的 storage 接口职责不同
 * - 单元测试容易(mock storage 或用真实 InMemorySessionStorage)
 *
 * 设计:
 * - `sessions: Map<sessionId, Session<SessionMetadata>>`:持有所有打开的 session
 * - `fork` 复用 repo-utils 的 `getEntriesToFork` 计算要复制的 entries 子集
 */

import type { SessionMetadata } from "../types.js";
import { SessionError } from "../types.js";
import type { SessionRepo } from "../storage.js";
import { Session } from "../session.js";
import { InMemorySessionStorage } from "./memory-storage.js";
import {
  createSessionId,
  createTimestamp,
  getEntriesToFork,
  toSession,
} from "../repo-utils.js";
import type { ForkOptions } from "../repo-utils.js";

/** SessionRepo 通用 create 选项 */
export interface InMemorySessionCreateOptions {
  id?: string;
}

/** 内存 SessionRepo */
export class InMemorySessionRepo implements SessionRepo<
  SessionMetadata,
  InMemorySessionCreateOptions
> {
  private readonly sessions = new Map<string, Session<SessionMetadata>>();

  /** 开新 session;若指定 id 则用,否则自动生成 */
  async create(
    options: InMemorySessionCreateOptions = {},
  ): Promise<Session<SessionMetadata>> {
    const metadata: SessionMetadata = {
      id: options.id ?? createSessionId(),
      createdAt: createTimestamp(),
    };
    const storage = new InMemorySessionStorage({ metadata });
    const session = toSession(storage);
    this.sessions.set(metadata.id, session);
    return session;
  }

  /** 按 metadata 找回已有 session;不存在抛 not_found */
  async open(metadata: SessionMetadata): Promise<Session<SessionMetadata>> {
    const session = this.sessions.get(metadata.id);
    if (!session) {
      throw new SessionError("not_found", `Session not found: ${metadata.id}`);
    }
    return session;
  }

  /** 列出所有 session 的 metadata */
  async list(): Promise<SessionMetadata[]> {
    return Promise.all(
      [...this.sessions.values()].map((session) => session.getMetadata()),
    );
  }

  /** 删除 session(从 map 移除) */
  async delete(metadata: SessionMetadata): Promise<void> {
    this.sessions.delete(metadata.id);
  }

  /**
   * 从 source 派生新 session。
   *
   * @param sourceMetadata 源 session 的 metadata
   * @param options fork 选项(entryId / position / id)
   */
  async fork(
    sourceMetadata: SessionMetadata,
    options: ForkOptions & InMemorySessionCreateOptions,
  ): Promise<Session<SessionMetadata>> {
    const source = await this.open(sourceMetadata);
    const forkedEntries = await getEntriesToFork(source.getStorage(), options);
    const metadata: SessionMetadata = {
      id: options.id ?? createSessionId(),
      createdAt: createTimestamp(),
    };
    const storage = new InMemorySessionStorage({
      metadata,
      entries: forkedEntries,
    });
    const session = toSession(storage);
    this.sessions.set(metadata.id, session);
    return session;
  }
}
