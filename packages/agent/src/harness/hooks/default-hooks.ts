/**
 * DefaultAgentHarnessHooks —— 钩子系统的默认实现。
 *
 * 文件定位:
 * - 钩子系统的核心类,提供 observe / on / emit / addCleanup / clear / dispose API
 * - 内部持有 state(handlers / observers / cleanups 管理) + context
 * - emit 时按事件 type 路由到对应的 5 种语义函数(semantics.ts)
 *
 * 设计原则:
 * - 主类公共 API 与 dispatch 紧密耦合(observe/on 走 state.addHandler,
 *   clear/dispose 走 state.drainCleanups + state.reset),不分离
 * - 5 种语义函数独立在 semantics.ts(纯函数,易测)
 * - 内部状态在 default-hooks-state.ts(纯 CRUD,易测)
 * - 事件 type 在 types.ts(8 核心 + 12 预声明)
 *
 * 派发顺序(spec 约定):
 * 1. observers 先派发(并行,fire-and-forget,单 observer 抛错不影响其他)
 * 2. handlers 再派发(走对应 semantics:context / tool_call / tool_result /
 *    session_before_xxx / fire-and-forget)
 */

import type { AgentMessage } from "../../types.js";
import type { HookHandler, HookObserver } from "../types/harness.js";
import type {
  AgentHarnessHookContext,
  AgentHarnessHookEvent,
  AgentHarnessHookName,
  AgentHarnessHookContextFacade,
} from "./types.js";
import { DefaultAgentHarnessHooksState } from "./default-hooks-state.js";
import {
  runContextSemantics,
  runFireAndForgetSemantics,
  runSessionBeforeSemantics,
  runToolCallSemantics,
  runToolResultSemantics,
} from "./semantics.js";

// ── 构造选项 ──

/**
 * DefaultAgentHarnessHooks 构造选项。
 */
export interface DefaultAgentHarnessHooksOptions {
  /**
   * 初始 context。包含 harness / session facade / models facade。
   * 后续可调 setContext 切换(立即生效,影响下一次 emit 派发的 ctx)。
   */
  context: AgentHarnessHookContext;
}

// ── 主类 ──

/**
 * 钩子系统默认实现。
 *
 * 公共 API:
 * - `context` / `setContext`:读写 context
 * - `observe(handler)`:注册 observer(只读),返回 unsubscribe
 * - `on(type, handler)`:注册 handler(参与语义),返回 unsubscribe
 * - `emit(event, signal?)`:派发事件,返回 ResultOf<TEvent> | undefined
 * - `addCleanup(cleanup)`:注册 cleanup,返回 unsubscribe
 * - `clear()`:清空 handlers + observers + 执行 cleanups
 * - `dispose()`:同 clear
 *
 * emit 路由:
 * | event.type              | 走哪个语义               |
 * |-------------------------|--------------------------|
 * | "context"               | runContextSemantics       |
 * | "tool_call"             | runToolCallSemantics      |
 * | "tool_result"           | runToolResultSemantics    |
 * | "session_before_*"      | runSessionBeforeSemantics |
 * | 其他                    | runFireAndForgetSemantics |
 */
export class DefaultAgentHarnessHooks {
  // ── 私有字段 ──

  /** 当前 context(handler / observer 收到的 ctx 引用) */
  #context: AgentHarnessHookContext;

  /** 内部状态(handlers / observers / cleanups) */
  readonly #state: DefaultAgentHarnessHooksState = new DefaultAgentHarnessHooksState();

  /** 是否已 dispose(dispose 后 emit 行为待定,本 Task 阶段:仍可 emit 但无 handler) */
  #disposed = false;

  // ── 构造 ──

  constructor(options: DefaultAgentHarnessHooksOptions) {
    this.#context = options.context;
  }

  // ── Context 读写 ──

  /**
   * 获取当前 context。
   *
   * 返回的是引用(非快照),setContext 后会切换到新 ctx。
   */
  get context(): AgentHarnessHookContext {
    return this.#context;
  }

  /**
   * 设置 context(立即生效)。
   *
   * 下一次 emit 派发时,所有 handler / observer 收到的 ctx 就是新值。
   * 当前正在执行的 emit 不受影响(它持有的是旧 ctx 引用)。
   */
  setContext(ctx: AgentHarnessHookContext): void {
    this.#context = ctx;
  }

  // ── Observer 注册 ──

  /**
   * 注册一个 observer(只读,接收所有事件)。
   *
   * observer 的返回值会被忽略——它只用于"观察"(埋点 / 日志 / 统计)。
   * observer 抛错被吞掉(不影响其他 observer 或 handler 派发)。
   *
   * @param observer observer 函数
   * @returns 取消订阅函数
   */
  observe(observer: HookObserver<AgentHarnessHookEvent, AgentHarnessHookContext>): () => void {
    return this.#state.addObserver(observer);
  }

  // ── Handler 注册 ──

  /**
   * 注册一个 handler(参与对应 type 的语义)。
   *
   * 不同 type 的 handler 走不同语义:
   * - "context":链式 messages 转换
   * - "tool_call":遇 block=true 提前退出
   * - "tool_result":累积字段补丁
   * - "session_before_*":遇 cancel=true 提前退出
   * - 其他:fire-and-forget
   *
   * @param type    事件 type
   * @param handler handler 函数
   * @returns 取消订阅函数
   */
  on<TType extends AgentHarnessHookName>(
    type: TType,
    handler: HookHandler<any, AgentHarnessHookContext>,
  ): () => void {
    return this.#state.addHandler(type, handler);
  }

  // ── Emit 派发 ──

  /**
   * 派发一个事件给所有 observer + handler。
   *
   * 派发顺序(per spec):
   * 1. observers 并行派发(单个 observer 抛错被吞,不影响其他)
   * 2. handlers 按 event.type 路由到对应 semantics
   *
   * @param event  事件对象
   * @param signal 可选 AbortSignal(传给 observer)
   * @returns ResultOf<typeof event> | undefined
   */
  async emit(
    event: AgentHarnessHookEvent,
    signal?: AbortSignal,
  ): Promise<unknown> {
    // 步骤 1:派发 observers(并行,fire-and-forget,单 observer 抛错被吞)
    await this.#dispatchObservers(event, signal);

    // 步骤 2:派发 handlers(按 event.type 路由)
    return await this.#dispatchHandlers(event, signal);
  }

  /** 派发 observers(私有) */
  async #dispatchObservers(
    event: AgentHarnessHookEvent,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const observers = this.#state.getObservers();
    if (observers.length === 0) return;

    // 并行派发;单 observer 抛错被吞(observer 本质是 fire-and-forget)
    await Promise.all(
      observers.map(async (obs) => {
        try {
          await obs(event, this.#context, signal);
        } catch {
          // 吞掉 observer 抛错,继续派发其他 observer 和 handler
        }
      }),
    );
  }

  /** 派发 handlers(私有,按 event.type 路由) */
  async #dispatchHandlers(
    event: AgentHarnessHookEvent,
    signal: AbortSignal | undefined,
  ): Promise<unknown> {
    const handlers = this.#state.getHandlers(event.type);
    if (handlers.length === 0) return undefined;

    switch (event.type) {
      case "context": {
        // context 事件:ctx 已含 messages 字段(由 setContext / 构造时提供)
        // 直接传 this.#context 给 handler,handler 看到的就是 hooks.context(引用相等)
        return await runContextSemantics(
          event,
          handlers,
          this.#context,
          signal,
        );
      }

      case "tool_call":
        return await runToolCallSemantics(event, handlers, this.#context, signal);

      case "tool_result":
        return await runToolResultSemantics(event, handlers, this.#context, signal);

      case "session_before_compact":
      case "session_before_tree":
        return await runSessionBeforeSemantics(event, handlers, this.#context, signal);

      default:
        return await runFireAndForgetSemantics(event, handlers, this.#context, signal);
    }
  }

  // ── Cleanup 管理 ──

  /**
   * 注册一个 cleanup 函数。
   *
   * cleanup 在 clear() / dispose() 时按注册顺序执行。
   * 单个 cleanup 抛错被吞(不影响其他 cleanup)。
   *
   * @param cleanup 清理函数(可能 async)
   * @returns 取消注册函数
   */
  addCleanup(cleanup: () => void | Promise<void>): () => void {
    return this.#state.addCleanup(cleanup);
  }

  // ── 生命周期:clear / dispose ──

  /**
   * 清空所有 handlers / observers,并执行所有 cleanups。
   *
   * 顺序:
   * 1. 取出 cleanups 快照
   * 2. 清空 state(handlers / observers / cleanups)
   * 3. 执行 cleanups 快照(按注册顺序,单 cleanup 抛错被吞)
   *
   * 注意:执行 cleanup 时,新注册的 handler / cleanup 不会被本轮 clear 处理。
   */
  async clear(): Promise<void> {
    // 1. 取出 cleanups 快照(同时清空 cleanup 列表,避免执行过程中新注册被清)
    const cleanups = this.#state.drainCleanups();

    // 2. 清空 state 的其他部分(handlers / observers)
    // 注意:reset 会同时清空 cleanups,但已经 drain 过了,这里 clear 一下 handlers/observers
    this.#state.reset();

    // 3. 执行 cleanups
    for (const cleanup of cleanups) {
      try {
        await cleanup();
      } catch {
        // 单 cleanup 抛错被吞,继续执行其他
      }
    }
  }

  /**
   * 释放资源(同 clear)。
   *
   * dispose 后:
   * - 所有 handlers / observers 被清空
   * - 所有 cleanups 已执行
   * - 后续可以重新注册(等同新实例)
   */
  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    await this.clear();
  }
}

// ── 重新导出辅助类型(避免外部 import 散落) ──

/** HookContext 重新导出 */
export type { AgentHarnessHookContext } from "./types.js";
