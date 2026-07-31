/**
 * Subscription 工厂。
 *
 * 职责:
 * - 给定一个 EventBus,创建一对多独立 Subscription
 * - 每个 Subscription 有自己的 queue / resolveNext
 * - Subscription 可 for await 迭代,或 cancel 主动取消
 *
 * 为什么从 agent-harness.ts 拆出来:
 * - subscribe() 内部用了 50+ 行闭包变量(queue / resolveNext / cancelled),
 *   在主类里显得拥挤
 * - 抽成纯函数后,agent-harness.ts 瘦身,subscription 逻辑独立可测
 * - 复用:其他类需要类似订阅语义时可直接 import
 */

import type { AgentHarnessEvent } from "../types/events.js";
import type { EventBus, Subscription } from "./event-bus.js";

/**
 * 基于 EventBus 创建一个 Subscription。
 *
 * 行为:
 * - 调用 createSubscription 立即订阅 EventBus
 * - 返回的 Subscription 拥有独立的 queue
 * - 多个 Subscription 之间互不干扰
 * - cancel() 后:
 *   - 不再接收新事件
 *   - 释放 EventBus 上的订阅
 *   - 若有 pending 的 for await,resolve `{ done: true }` 让其退出
 */
export function createSubscription(eventBus: EventBus): Subscription {
  const queue: AgentHarnessEvent[] = [];
  let resolveNext: ((event: AgentHarnessEvent | null) => void) | null = null;
  let cancelled = false;

  const unsubscribe = eventBus.subscribe((event) => {
    if (cancelled) return;
    if (resolveNext) {
      const r = resolveNext;
      resolveNext = null;
      r(event);
    } else {
      queue.push(event);
    }
  });

  return {
    [Symbol.asyncIterator](): AsyncIterator<AgentHarnessEvent> {
      return {
        next: async (): Promise<IteratorResult<AgentHarnessEvent>> => {
          if (cancelled) {
            return { value: undefined, done: true };
          }
          const next = queue.shift();
          if (next) {
            return { value: next, done: false };
          }
          return new Promise((resolve) => {
            resolveNext = (event) => {
              if (event === null) {
                resolve({ value: undefined, done: true });
              } else {
                resolve({ value: event, done: false });
              }
            };
          });
        },
        return: async (): Promise<IteratorResult<AgentHarnessEvent>> => {
          cancelled = true;
          unsubscribe();
          return { value: undefined, done: true };
        },
      };
    },
    cancel: () => {
      cancelled = true;
      unsubscribe();
      // 关键:resolve pending 的 for await,否则 cancel 后 for await 永远挂起
      if (resolveNext) {
        const r = resolveNext;
        resolveNext = null;
        r(null);
      }
    },
  };
}
