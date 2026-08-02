/**
 * DefaultAgentHarnessHooks —— 钩子系统的默认实现。
 *
 * 文件定位:
 * - 钩子系统核心类:observe / on / emit / clear / dispose API
 * - 内部状态(handlers / observers)+ context 直接内联,不再拆 state 类
 * - emit 时按事件 type 路由到 6 种语义(私有方法,同文件内联)
 *
 * 设计原则:
 * - observer(只读)与 handler(参与语义)分离:observer 抛错被吞,不阻断
 * - 6 种语义:context 链式 / before_agent_start 收集结果 /
 *   tool_call block / tool_result 累积补丁 /
 *   session_before 遇 cancel 退出 / 其他 fire-and-forget
 *
 * 派发顺序:
 * 1. observers 先派发(并行,fire-and-forget,单 observer 抛错不影响其他)
 * 2. handlers 再派发(走对应语义,见 emit 路由表)
 */

import type { AgentMessage } from "../../types.js";
import type { HookHandler, HookObserver } from "../types/harness.js";
import type {
  AgentHarnessHookContext,
  AgentHarnessHookEvent,
  AgentHarnessHookName,
  BeforeAgentStartHookEvent,
} from "./types.js";

// ── 构造选项 ──

/**
 * DefaultAgentHarnessHooks 构造选项。
 */
export interface DefaultAgentHarnessHooksOptions {
  /**
   * 初始 context。包含 harness / session facade / messages。
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
 * - `clear()`:清空 handlers + observers
 * - `dispose()`:同 clear(幂等)
 *
 * emit 路由:
 * | event.type                | 语义                          |
 * |---------------------------|-------------------------------|
 * | "context"                 | 链式 messages 转换            |
 * | "before_agent_start"      | 收集 { messages?, systemPrompt? } |
 * | "tool_call"               | 遇 block=true 提前退出        |
 * | "tool_result"             | 累积字段补丁                  |
 * | "session_before_compact"  | 遇 cancel=true 提前退出       |
 * | 其他                      | 并行调用,fire-and-forget     |
 */
export class DefaultAgentHarnessHooks {
  private currentContext: AgentHarnessHookContext;
  private handlers = new Map<AgentHarnessHookName, HookHandler<any, any>[]>();
  private observers = new Set<HookObserver<AgentHarnessHookEvent, any>>();
  private disposed = false;

  constructor(options: DefaultAgentHarnessHooksOptions) {
    this.currentContext = options.context;
  }

  /** 当前 context(handler / observer 收到的 ctx 引用)。 */
  get context(): AgentHarnessHookContext {
    return this.currentContext;
  }

  /**
   * 设置 context(立即生效)。
   *
   * 下一次 emit 派发时,所有 handler / observer 收到的 ctx 就是新值。
   * 当前正在执行的 emit 不受影响(它持有的是旧 ctx 引用)。
   */
  setContext(ctx: AgentHarnessHookContext): void {
    this.currentContext = ctx;
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
    this.observers.add(observer);
    return () => {
      this.observers.delete(observer);
    };
  }

  // ── Handler 注册 ──

  /**
   * 注册一个 handler(参与对应 type 的语义)。
   *
   * @param type    事件 type
   * @param handler handler 函数
   * @returns 取消订阅函数
   */
  on<TType extends AgentHarnessHookName>(
    type: TType,
    handler: HookHandler<any, AgentHarnessHookContext>,
  ): () => void {
    const list = this.handlers.get(type);
    if (list) {
      list.push(handler);
    } else {
      this.handlers.set(type, [handler]);
    }
    return () => {
      this.removeHandler(type, handler);
    };
  }

  // ── emit ──

  async emit(
    event: AgentHarnessHookEvent,
    signal?: AbortSignal,
  ): Promise<unknown> {
    await this.dispatchObservers(event, signal);
    return await this.dispatchHandlers(event, signal);
  }

  // ── 生命周期 ──

  /** 清空所有 handlers + observers(幂等,可随时再注册)。 */
  async clear(): Promise<void> {
    this.handlers.clear();
    this.observers.clear();
  }

  /** dispose:同 clear,幂等。 */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.clear();
  }

  // ── 私有:状态操作 ──

  private removeHandler(
    type: AgentHarnessHookName,
    handler: HookHandler<any, any>,
  ): void {
    const list = this.handlers.get(type);
    if (!list) return;
    const index = list.indexOf(handler);
    if (index === -1) return;
    list.splice(index, 1);
    if (list.length === 0) this.handlers.delete(type);
  }

  // ── 私有:派发 ──

  /** 派发 observers(并行,fire-and-forget,单 observer 抛错不影响其他)。 */
  private async dispatchObservers(
    event: AgentHarnessHookEvent,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    if (this.observers.size === 0) return;
    await Promise.all(
      Array.from(this.observers, async (obs) => {
        try {
          await obs(event, this.context, signal);
        } catch {
          // observer 只观察,失败不阻断
        }
      }),
    );
  }

  /** 派发 handlers(按 event.type 路由到对应语义)。 */
  private async dispatchHandlers(
    event: AgentHarnessHookEvent,
    signal: AbortSignal | undefined,
  ): Promise<unknown> {
    const handlers = this.handlers.get(event.type) ?? [];
    if (handlers.length === 0) return undefined;

    switch (event.type) {
      case "context":
        return this.runContextSemantics(event, handlers, signal);
      case "before_agent_start":
        return this.runBeforeAgentStartSemantics(event, handlers, signal);
      case "tool_call":
        return this.runToolCallSemantics(event, handlers, signal);
      case "tool_result":
        return this.runToolResultSemantics(event, handlers, signal);
      case "session_before_compact":
      case "session_before_tree":
        return this.runSessionBeforeSemantics(event, handlers, signal);
      default:
        return this.runFireAndForgetSemantics(event, handlers, signal);
    }
  }

  // ── 私有:6 种语义 ──

  /**
   * before_agent_start 语义:收集 handler 返回的 { messages?, systemPrompt? }。
   *
   * - 顺序执行每个 handler,字段级累积(messages / systemPrompt 独立覆盖,后者胜)
   * - 返回 { messages?, systemPrompt? };任何字段都没被设置时返回 undefined
   */
  private async runBeforeAgentStartSemantics(
    event: BeforeAgentStartHookEvent,
    handlers: ReadonlyArray<HookHandler<any, any>>,
    signal?: AbortSignal,
  ): Promise<{ messages?: AgentMessage[]; systemPrompt?: string } | undefined> {
    const accumulated: { messages?: AgentMessage[]; systemPrompt?: string } = {};
    for (const handler of handlers) {
      const result = await handler(event, this.context, signal);
      if (result !== undefined && result !== null && typeof result === "object") {
        const r = result as { messages?: AgentMessage[]; systemPrompt?: string };
        if (r.messages !== undefined) accumulated.messages = r.messages;
        if (r.systemPrompt !== undefined) accumulated.systemPrompt = r.systemPrompt;
      }
    }
    return Object.keys(accumulated).length === 0 ? undefined : accumulated;
  }

  /**
   * context 语义:链式 messages 转换。
   *
   * - 顺序执行每个 handler,handler 收到 `(event, ctx, signal)`,可读 ctx.messages
   * - handler 返回 `{ messages: [...] }` 时,下一个 handler 看到的就是这个新 messages
   * - handler 返回 undefined 时,链不变
   * - 用内部副本 currentCtx 累积,避免 mutate 用户的 ctx
   */
  private async runContextSemantics(
    event: { type: "context" },
    handlers: ReadonlyArray<HookHandler<any, any>>,
    signal?: AbortSignal,
  ): Promise<{ messages?: AgentMessage[] } | undefined> {
    let currentCtx: { messages: AgentMessage[] } & object = { ...this.context };
    let lastResult: { messages?: AgentMessage[] } | undefined = undefined;

    for (const handler of handlers) {
      const result = await handler(event, currentCtx, signal);
      if (
        result !== undefined &&
        result !== null &&
        typeof result === "object" &&
        "messages" in result
      ) {
        lastResult = result as { messages?: AgentMessage[] };
        if (lastResult.messages !== undefined) {
          currentCtx = { ...currentCtx, messages: lastResult.messages };
        }
      }
    }
    return lastResult;
  }

  /**
   * tool_call 语义:遇 block=true 提前退出。
   *
   * - 顺序执行每个 handler,返回 `{ block?, reason? }`
   * - 一旦某个 handler 返回 block=true,后续 handler 完全跳过
   * - 全部执行完无 block,返回最后一个非 undefined 的结果
   */
  private async runToolCallSemantics(
    event: { type: "tool_call" },
    handlers: ReadonlyArray<HookHandler<any, any>>,
    signal?: AbortSignal,
  ): Promise<{ block?: boolean; reason?: string } | undefined> {
    let lastResult: { block?: boolean; reason?: string } | undefined = undefined;

    for (const handler of handlers) {
      const result = await handler(event, this.context, signal);
      if (result !== undefined && result !== null && typeof result === "object") {
        lastResult = result as { block?: boolean; reason?: string };
      }
      if (lastResult?.block === true) {
        return lastResult;
      }
    }
    return lastResult;
  }

  /**
   * tool_result 语义:累积补丁。
   *
   * - 顺序执行每个 handler,每个 handler 可独立覆盖 content / details / isError / terminate
   * - handler 返回 undefined → 不贡献任何字段
   * - 没有任何字段被设置时返回 undefined
   */
  private async runToolResultSemantics(
    event: { type: "tool_result" },
    handlers: ReadonlyArray<HookHandler<any, any>>,
    signal?: AbortSignal,
  ): Promise<
    | {
        content?: unknown;
        details?: unknown;
        isError?: boolean;
        terminate?: boolean;
      }
    | undefined
  > {
    const accumulated: {
      content?: unknown;
      details?: unknown;
      isError?: boolean;
      terminate?: boolean;
    } = {};

    for (const handler of handlers) {
      const result = await handler(event, this.context, signal);
      if (result !== undefined && result !== null && typeof result === "object") {
        const r = result as {
          content?: unknown;
          details?: unknown;
          isError?: boolean;
          terminate?: boolean;
        };
        // 字段级累积:只覆盖"有定义"的字段
        if (r.content !== undefined) accumulated.content = r.content;
        if (r.details !== undefined) accumulated.details = r.details;
        if (r.isError !== undefined) accumulated.isError = r.isError;
        if (r.terminate !== undefined) accumulated.terminate = r.terminate;
      }
    }

    return Object.keys(accumulated).length === 0 ? undefined : accumulated;
  }

  /**
   * session_before_* 语义:遇 cancel=true 提前退出。
   *
   * 适用于:
   * - session_before_compact(可返回 { cancel, compaction })
   * - session_before_tree(可返回 { cancel, summary, customInstructions, ... })
   *
   * - 顺序执行每个 handler,字段级累积(除 cancel 外,其他字段独立覆盖)
   * - 遇 cancel=true 立即停止,返回累积对象(含 cancel=true)
   */
  private async runSessionBeforeSemantics(
    event: { type: "session_before_compact" | "session_before_tree" },
    handlers: ReadonlyArray<HookHandler<any, any>>,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown> | undefined> {
    const accumulated: Record<string, unknown> = {};

    for (const handler of handlers) {
      const result = await handler(event, this.context, signal);
      if (result !== undefined && result !== null && typeof result === "object") {
        const r = result as Record<string, unknown>;
        for (const [key, value] of Object.entries(r)) {
          accumulated[key] = value;
        }
        if (r.cancel === true) {
          return accumulated;
        }
      }
    }

    return Object.keys(accumulated).length === 0 ? undefined : accumulated;
  }

  /**
   * 其他事件语义:并行调用,fire-and-forget。
   *
   * - Promise.all 并行执行所有 handlers
   * - handler 返回值被忽略;抛错被吞掉(单 handler 失败不影响其他)
   * - 始终返回 undefined
   */
  private async runFireAndForgetSemantics(
    event: { type: string },
    handlers: ReadonlyArray<HookHandler<any, any>>,
    signal?: AbortSignal,
  ): Promise<undefined> {
    await Promise.all(
      handlers.map(async (handler) => {
        try {
          await handler(event, this.context, signal);
        } catch {
          // fire-and-forget 契约:单个 handler 失败不影响其他
        }
      }),
    );
    return undefined;
  }
}
