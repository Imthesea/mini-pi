/**
 * 钩子变更语义:5 种语义的纯函数实现。
 *
 * 文件定位:
 * - 每个语义一个纯函数,接收 event + handlers + ctx + signal
 * - 纯函数:无副作用,易测,DefaultAgentHarnessHooks 直接组合它们
 *
 * 5 种语义:
 * 1. runContextSemantics        — context 事件,链式 messages 转换
 * 2. runToolCallSemantics       — tool_call 事件,遇 block 提前退出
 * 3. runToolResultSemantics     — tool_result 事件,累积补丁
 * 4. runSessionBeforeSemantics  — session_before_* 事件,遇 cancel 提前退出
 * 5. runFireAndForgetSemantics  — 其他事件,Promise.all 并行调用
 *
 * 设计动机:
 * - 5 个文件每个 80-100 行本质是同一种"对 handler 列表跑某种语义"模板的 5 个 case
 * - 合并在一个文件,便于读者横向对比共性(每个函数都接收 handlers + ctx,返回结果)
 * - 见工程原则 § 1.3"避免为对称而拆"
 */

import type { AgentMessage } from "../../types.js";
import type { HookHandler } from "../types/harness.js";

// ── 1. Context 语义:链式 messages 转换 ──

/**
 * context 事件的语义处理:链式 messages 转换。
 *
 * 工作原理:
 * - ctx 包含 messages 字段(由 DefaultAgentHarnessHooks 在 setContext / 构造时提供)
 * - 顺序执行每个 handler,每个 handler 收到 `(event, ctx, signal)`,可读 ctx.messages
 * - 如果 handler 返回新的 messages(对象字面量 `{ messages: [...] }`),
 *   下一个 handler 看到的就是这个新 messages
 * - 如果 handler 返回 undefined,链不变(下一个 handler 看到同样的 messages)
 * - 最终返回最后一个"非 undefined 且包含 messages 字段"的结果
 *
 * 设计:ctx 是 `AgentHarnessHookContext`(必含 messages 字段)。
 * 这样 handler 既能从 ctx 读 harness/session/models 状态,
 * 也能从 ctx.messages 读链式 messages(语义最自然)。
 *
 * @param event    事件对象
 * @param handlers 订阅此事件的所有 handlers
 * @param ctx      AgentHarnessHookContext(必含 messages 字段)
 * @param signal   可选 AbortSignal(透传给 handler)
 * @returns 最终累积的结果(可能是 undefined)
 */
export async function runContextSemantics(
  event: { type: "context" },
  handlers: ReadonlyArray<HookHandler<any, any>>,
  ctx: { messages: AgentMessage[] } & object,
  signal?: AbortSignal,
): Promise<{ messages?: AgentMessage[] } | undefined> {
  // currentCtx 是"当前 ctx"的内部副本,messages 字段随 handler 返回而更新
  // 用副本避免 mutate 用户的 ctx
  let currentCtx: { messages: AgentMessage[] } & object = { ...ctx };
  let lastResult: { messages?: AgentMessage[] } | undefined = undefined;

  for (const handler of handlers) {
    // handler 看到当前最新的 ctx(包含最新的 messages)
    const result = await handler(event, currentCtx, signal);

    // 累积:只在返回包含 messages 字段时更新 lastResult
    if (
      result !== undefined &&
      result !== null &&
      typeof result === "object" &&
      "messages" in result
    ) {
      lastResult = result as { messages?: AgentMessage[] };
      if (lastResult.messages !== undefined) {
        // 链式:把新 messages 喂给下一个 handler
        currentCtx = { ...currentCtx, messages: lastResult.messages };
      }
    }
  }

  return lastResult;
}

// ── 2. Tool Call 语义:遇 block 提前退出 ──

/**
 * tool_call 事件的语义处理:遇 block=true 提前退出。
 *
 * 工作原理:
 * - 顺序执行每个 handler
 * - 每个 handler 可返回 `{ block?: boolean, reason?: string }`
 * - 一旦某个 handler 返回 block=true,后续 handler **完全跳过**
 * - 提前退出时,返回该 handler 的 block 结果
 * - 全部执行完无 block,返回最后一个非 undefined 的结果
 *
 * @param event    事件对象
 * @param handlers 订阅此事件的所有 handlers
 * @param ctx      基础 ctx
 * @param signal   可选 AbortSignal
 * @returns block 结果或最后一个非 undefined 结果
 */
export async function runToolCallSemantics(
  event: { type: "tool_call" },
  handlers: ReadonlyArray<HookHandler<any, any>>,
  ctx: object,
  signal?: AbortSignal,
): Promise<{ block?: boolean; reason?: string } | undefined> {
  let lastResult: { block?: boolean; reason?: string } | undefined = undefined;

  for (const handler of handlers) {
    const result = await handler(event, ctx, signal);

    // 累积非 undefined 结果
    if (result !== undefined && result !== null && typeof result === "object") {
      lastResult = result as { block?: boolean; reason?: string };
    }

    // 遇 block=true:硬性停止,后续 handler 完全跳过
    if (lastResult?.block === true) {
      return lastResult;
    }
  }

  return lastResult;
}

// ── 3. Tool Result 语义:累积补丁 ──

/**
 * tool_result 事件的语义处理:累积 4 个独立字段(content / details / isError / terminate)。
 *
 * 工作原理:
 * - 顺序执行每个 handler
 * - 每个 handler 可独立覆盖 4 个字段(任何子集都行)
 * - handler 返回 undefined → 不贡献任何字段
 * - handler 返回 `{ content }` → 只更新 content 字段
 * - handler 返回 `{ content, isError }` → 同时更新两个字段
 * - 最终返回累积后的对象
 *
 * @param event    事件对象
 * @param handlers 订阅此事件的所有 handlers
 * @param ctx      基础 ctx
 * @param signal   可选 AbortSignal
 * @returns 累积后的字段对象(可能只有部分字段)
 */
export async function runToolResultSemantics(
  event: { type: "tool_result" },
  handlers: ReadonlyArray<HookHandler<any, any>>,
  ctx: object,
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
  let accumulated: {
    content?: unknown;
    details?: unknown;
    isError?: boolean;
    terminate?: boolean;
  } = {};

  for (const handler of handlers) {
    const result = await handler(event, ctx, signal);

    if (
      result !== undefined &&
      result !== null &&
      typeof result === "object"
    ) {
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

  // 没有任何字段被设置 → 返回 undefined(避免返回空对象)
  if (Object.keys(accumulated).length === 0) {
    return undefined;
  }

  return accumulated;
}

// ── 4. Session Before 语义:遇 cancel 提前退出 ──

/**
 * session_before_* 事件的语义处理:遇 cancel=true 提前退出。
 *
 * 适用于:
 * - session_before_compact(可返回 { cancel, compaction })
 * - session_before_tree(可返回 { cancel, summary, customInstructions, ... })
 *
 * 工作原理:
 * - 顺序执行每个 handler
 * - 字段级累积(除 cancel 外,其他字段独立覆盖)
 * - 遇 cancel=true 立即停止,返回累积对象(含 cancel=true)
 * - 全部执行完无 cancel,返回累积对象
 *
 * @param event    事件对象(type 是 "session_before_compact" / "session_before_tree" 等)
 * @param handlers 订阅此事件的所有 handlers
 * @param ctx      基础 ctx
 * @param signal   可选 AbortSignal
 * @returns cancel 结果或累积对象
 */
export async function runSessionBeforeSemantics(
  event: { type: string },
  handlers: ReadonlyArray<HookHandler<any, any>>,
  ctx: object,
  signal?: AbortSignal,
): Promise<Record<string, unknown> | undefined> {
  let accumulated: Record<string, unknown> = {};

  for (const handler of handlers) {
    const result = await handler(event, ctx, signal);

    if (
      result !== undefined &&
      result !== null &&
      typeof result === "object"
    ) {
      const r = result as Record<string, unknown>;
      // 字段级累积
      for (const [key, value] of Object.entries(r)) {
        accumulated[key] = value;
      }

      // 遇 cancel=true:硬性停止(返回当前累积对象,含 cancel=true)
      if (r.cancel === true) {
        return accumulated;
      }
    }
  }

  return Object.keys(accumulated).length === 0 ? undefined : accumulated;
}

// ── 5. Fire-and-Forget 语义:并行调用,忽略返回值 ──

/**
 * 其他事件的语义处理:并行调用,fire-and-forget。
 *
 * 适用于:
 * - message_end / model_update / abort(只观察)
 * - 9 个预声明事件(本 Task 不 emit,但语义已就绪)
 *
 * 工作原理:
 * - 用 Promise.all 并行执行所有 handlers(sync handler 也被包成 Promise)
 * - handler 返回值被忽略(不累积)
 * - handler 抛错被吞掉(不冒泡)— 单个 handler 失败不影响其他
 * - 返回 undefined
 *
 * @param event    事件对象
 * @param handlers 订阅此事件的所有 handlers
 * @param ctx      基础 ctx
 * @param signal   可选 AbortSignal
 * @returns 始终 undefined
 */
export async function runFireAndForgetSemantics(
  event: { type: string },
  handlers: ReadonlyArray<HookHandler<any, any>>,
  ctx: object,
  signal?: AbortSignal,
): Promise<undefined> {
  if (handlers.length === 0) {
    return undefined;
  }

  // 并行执行所有 handlers
  // - sync handler:被 Promise.resolve 包装,立即 resolve
  // - async handler:等待其完成
  // - handler 抛错:catch 后吞掉(契约:fire-and-forget 不冒泡)
  await Promise.all(
    handlers.map(async (handler) => {
      try {
        await handler(event, ctx, signal);
      } catch {
        // fire-and-forget 契约:单个 handler 失败不影响其他
        // (observer 的本质是"观察",不阻断流程)
      }
    }),
  );

  return undefined;
}
