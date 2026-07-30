/**
 * DefaultAgentHarnessHooks 内部状态:handlers / observers / cleanups 的封装。
 *
 * 文件定位:
 * - 把主类的"状态管理"抽出来,便于独立单测
 * - 主类专注于 emit 路由 + 公共 API,状态 CRUD 委托给这里
 *
 * 三个数据结构:
 * 1. handlers: Map<eventType, Handler[]>
 *    - key 是事件 type(如 "context" / "tool_call")
 *    - value 是订阅该事件的 handler 列表(按注册顺序)
 * 2. observers: Set<Observer>
 *    - 收到所有事件(只读)
 * 3. cleanups: Cleanup[]
 *    - clear / dispose 时执行
 *
 * 设计原则:
 * - 不暴露内部数据结构(Set / Map),只暴露操作方法
 * - 每个方法独立可测
 * - deleteHandler / deleteObserver 返回 boolean,便于主类知道是否真的删除了
 */

import type { HookHandler, HookObserver } from "../types/harness.js";
import type { AgentHarnessHookEvent, AgentHarnessHookName } from "./types.js";

// ── 内部类型 ──

/** 内部 cleanup 函数(可能返回 Promise,但 fire-and-forget 不需要 await) */
type Cleanup = () => void | Promise<void>;

/** 内部 observer 形状(handler 也兼容此形状,但语义不同) */
type Observer = HookObserver<AgentHarnessHookEvent, any>;

// ── 状态类 ──

/**
 * DefaultAgentHarnessHooks 内部状态管理。
 *
 * 职责:
 * - 维护 handlers / observers / cleanups 三个集合
 * - 提供增删改查方法
 * - 提供快照遍历(emit 时按当前快照派发,避免遍历过程中突变)
 *
 * 与 DefaultAgentHarnessHooks 的关系:
 * - DefaultAgentHarnessHooks 持有本类的一个实例
 * - 本类不感知事件语义,只做"数据增删改查"
 */
export class DefaultAgentHarnessHooksState {
  // ── 私有字段 ──

  /**
   * 事件 handlers。
   * key = 事件 type,value = 该 type 的所有 handlers(按注册顺序)。
   */
  #handlers: Map<AgentHarnessHookName, HookHandler<any, any>[]> = new Map();

  /** 观察者集合(只读,无 type 区分) */
  #observers: Set<Observer> = new Set();

  /** cleanup 函数列表(按注册顺序) */
  #cleanups: Cleanup[] = [];

  // ── Handlers API ──

  /**
   * 添加一个 handler 到指定事件 type。
   * 同一 type 可添加多个 handler,执行时按注册顺序。
   *
   * @param type    事件 type
   * @param handler handler 函数
   * @returns 取消订阅的函数
   */
  addHandler(
    type: AgentHarnessHookName,
    handler: HookHandler<any, any>,
  ): () => void {
    const list = this.#handlers.get(type);
    if (list) {
      list.push(handler);
    } else {
      this.#handlers.set(type, [handler]);
    }

    // 返回取消订阅函数:从列表中移除
    return () => {
      this.deleteHandler(type, handler);
    };
  }

  /**
   * 删除指定 type 的指定 handler。
   *
   * @returns true 表示真的删除了;false 表示 handler 不在列表中
   */
  deleteHandler(
    type: AgentHarnessHookName,
    handler: HookHandler<any, any>,
  ): boolean {
    const list = this.#handlers.get(type);
    if (!list) return false;

    const index = list.indexOf(handler);
    if (index === -1) return false;

    list.splice(index, 1);

    // 列表空了:删除 Map key,避免空 list 占用内存
    if (list.length === 0) {
      this.#handlers.delete(type);
    }

    return true;
  }

  /**
   * 获取指定 type 的所有 handlers(只读快照)。
   * 调用方遍历快照时不会被新增的 handler 影响。
   */
  getHandlers(type: AgentHarnessHookName): ReadonlyArray<HookHandler<any, any>> {
    return this.#handlers.get(type) ?? [];
  }

  /**
   * 获取所有非空 type 的 handler 总数(供测试用)。
   */
  totalHandlerCount(): number {
    let count = 0;
    for (const list of this.#handlers.values()) {
      count += list.length;
    }
    return count;
  }

  // ── Observers API ──

  /**
   * 添加一个 observer。
   *
   * @param observer 观察者函数
   * @returns 取消订阅函数
   */
  addObserver(observer: Observer): () => void {
    this.#observers.add(observer);
    return () => {
      this.deleteObserver(observer);
    };
  }

  /**
   * 删除 observer。
   *
   * @returns true 表示真的删除了
   */
  deleteObserver(observer: Observer): boolean {
    return this.#observers.delete(observer);
  }

  /**
   * 获取所有 observers(只读快照)。
   */
  getObservers(): ReadonlyArray<Observer> {
    return Array.from(this.#observers);
  }

  /**
   * 获取 observer 总数(供测试用)。
   */
  observerCount(): number {
    return this.#observers.size;
  }

  // ── Cleanups API ──

  /**
   * 注册一个 cleanup 函数。
   *
   * @param cleanup 清理函数(可能 async)
   * @returns 取消注册的函数(若 cleanup 还未执行,阻止其执行)
   */
  addCleanup(cleanup: Cleanup): () => void {
    this.#cleanups.push(cleanup);
    let cancelled = false;
    return () => {
      if (cancelled) return;
      cancelled = true;
      const index = this.#cleanups.indexOf(cleanup);
      if (index !== -1) {
        this.#cleanups.splice(index, 1);
      }
    };
  }

  /**
   * 获取并清空所有 cleanups(快照)。
   *
   * 调用方负责"执行快照中的每个 cleanup",即使中途有新的 cleanup 被注册,
   * 也不会被本轮 clear 处理。
   */
  drainCleanups(): Cleanup[] {
    const snapshot = this.#cleanups;
    this.#cleanups = [];
    return snapshot;
  }

  /**
   * 获取 cleanup 总数(供测试用)。
   */
  cleanupCount(): number {
    return this.#cleanups.length;
  }

  // ── 整体操作 ──

  /**
   * 清空所有 handlers / observers / cleanups。
   *
   * 注意:不直接调用 cleanups,只 drain 出列表交给调用方执行。
   * (执行阶段是"主类"职责,不是 state 职责)
   */
  reset(): void {
    this.#handlers.clear();
    this.#observers.clear();
    this.#cleanups = [];
  }
}
