/**
 * Harness 内部事件总线。
 *
 * 职责:
 * - 管理事件订阅者集合
 * - 并行派发事件给所有订阅者
 * - 提供 Subscription 句柄(可 for await 迭代,可 cancel)
 *
 * 为什么从 agent-harness.ts 拆出来:
 * - EventBus 是独立类,不依赖 AgentHarness 的任何内部状态
 * - 拆分后既可独立测试,又减少 agent-harness.ts 行数
 */

import type { AgentHarnessEvent } from "../types/events.js";

// ── 订阅相关类型 ──

/**
 * 事件订阅句柄。
 *
 * 调用方拿到后可以用 for await 迭代 AgentHarnessEvent,
 * 或调用 cancel() 主动取消订阅。
 */
export interface Subscription {
  /** 异步迭代器 */
  [Symbol.asyncIterator](): AsyncIterator<AgentHarnessEvent>;
  /** 取消订阅 */
  cancel(): void;
}

/** 内部事件订阅者 */
type Subscriber = (event: AgentHarnessEvent) => void | Promise<void>;

// ── EventBus ──

/**
 * Harness 内部事件总线。
 *
 * 设计要点:
 * - 一个 EventBus 实例被 AgentHarness 持有,所有 subscribe() 返回的
 *   Subscription 共享同一个 EventBus(但各自有独立的 queue / resolveNext)
 * - 用 Set 而非数组存储订阅者:subscribe/unsubscribe 频繁,O(1) 删除优于数组
 */
export class EventBus {
  // 订阅者集合:每个订阅者是一个 (event) => void | Promise<void> 函数
  private subscribers: Set<Subscriber> = new Set();

  /**
   * 派发事件给所有订阅者(并行)。
   *
   * 设计要点:
   * - 同步订阅者立即执行完,不等
   * - 异步订阅者收集到 promises,最后 Promise.all 等全部完成
   * - 这样同步订阅者不会被异步订阅者阻塞
   */
  async emit(event: AgentHarnessEvent): Promise<void> {
    // 收集所有异步订阅者返回的 Promise,最后统一 await
    const promises: Promise<void>[] = [];

    // 遍历所有订阅者,逐个派发事件
    for (const sub of this.subscribers) {
      // 调用订阅者:可能是同步(void),也可能是异步(Promise)
      const result = sub(event);

      // 如果返回的是 Promise,收集起来最后并行等待
      if (result instanceof Promise) {
        promises.push(result);
      }
      // 同步订阅者:已经执行完了,跳过
    }

    // 有异步订阅者才 await;全是同步的话直接返回,避免无谓的微任务
    if (promises.length > 0) {
      await Promise.all(promises);
    }
  }

  /** 添加订阅者,返回取消订阅函数 */
  subscribe(subscriber: Subscriber): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  /** 清空所有订阅者 */
  clear(): void {
    this.subscribers.clear();
  }
}
