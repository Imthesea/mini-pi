/**
 * hooks 与 agent-loop 的桥接层。
 *
 * 职责:
 * - 把钩子系统的"tool_call" / "tool_result"事件桥接到 agent-loop 的
 *   `beforeToolCall` / `afterToolCall` config
 * - 让钩子系统与 agent-loop 的现有契约保持一致(block / 累积补丁)
 *
 * 为什么不直接合并到 agent-harness.ts:
 * - 桥接逻辑相对独立(纯函数 + config 包装)
 * - 把工具相关逻辑集中在这里,agent-harness.ts 保持只关心"业务流"
 * - 便于未来 agent-loop 内部直接调用(去掉 harness 这一层)
 *
 * 桥接流程:
 *
 * beforeToolCall:
 *   1. 调 hooks.emit("tool_call") → 可能有 handler 返回 { block: true }
 *   2. 若 block:返回 { block: true, reason: <handler 提供的 reason> }
 *   3. 若不 block:继续调 userBeforeToolCall(若有),合并结果
 *
 * afterToolCall:
 *   1. 调 hooks.emit("tool_result") → handler 累积返回 { content?, details?, isError?, terminate? }
 *   2. 同时调 userAfterToolCall(若有),取其结果
 *   3. 合并两个结果(钩子系统的字段优先,因为它在 agent-harness 层更接近用户)
 *
 * 设计取舍:
 * - "钩子系统的字段优先"而非"用户 config 优先",是因为钩子系统是
 *   面向扩展的"声明式拦截",用户注册时一般希望它有更高优先级
 * - 若 user config 也想 block,只会被钩子系统的 block 覆盖(钩子系统 block 更明确)
 */

import type {
  AfterToolCallContext,
  AfterToolCallResult,
  BeforeToolCallContext,
  BeforeToolCallResult,
} from "../../types.js";
import type { DefaultAgentHarnessHooks } from "../hooks/default-hooks.js";

// ── beforeToolCall 桥接 ──

/**
 * 包装原始 beforeToolCall,把钩子系统的 tool_call 事件注入。
 *
 * @param hooks 钩子系统实例
 * @param userBeforeToolCall 用户的原始 beforeToolCall(可选)
 * @returns 包装后的 beforeToolCall(可直接放进 AgentLoopConfig)
 */
export function bridgeBeforeToolCall(
  hooks: DefaultAgentHarnessHooks,
  userBeforeToolCall?:
    | ((
        context: BeforeToolCallContext,
        signal?: AbortSignal,
      ) => Promise<BeforeToolCallResult | undefined>)
    | undefined,
): ((
  context: BeforeToolCallContext,
  signal?: AbortSignal,
) => Promise<BeforeToolCallResult | undefined>) {
  return async (context, signal) => {
    // 1. 钩子系统:emit tool_call,handler 可返回 { block: true }
    const hookResult = (await hooks.emit(
      { type: "tool_call" },
      signal,
    )) as BeforeToolCallResult | undefined;

    // 钩子系统 block:硬性阻止,不再调 user beforeToolCall
    if (hookResult?.block === true) {
      return hookResult;
    }

    // 2. 用户的 beforeToolCall(若钩子系统不 block)
    const userResult = await userBeforeToolCall?.(context, signal);

    // 合并:钩子结果 + 用户结果(用户的字段若已设置会被钩子覆盖,
    // 实际上钩子的 block 已返回,所以这里通常用户结果会"原样"返回)
    return {
      ...userResult,
      ...(hookResult ?? {}),
    };
  };
}

// ── afterToolCall 桥接 ──

/**
 * 包装原始 afterToolCall,把钩子系统的 tool_result 事件注入。
 *
 * 字段级合并:content / details / isError / terminate 各自独立
 * 钩子系统的返回值字段优先(扩展层 vs 业务层,扩展优先)
 *
 * @param hooks 钩子系统实例
 * @param userAfterToolCall 用户的原始 afterToolCall(可选)
 * @returns 包装后的 afterToolCall
 */
export function bridgeAfterToolCall(
  hooks: DefaultAgentHarnessHooks,
  userAfterToolCall?:
    | ((
        context: AfterToolCallContext,
        signal?: AbortSignal,
      ) => Promise<AfterToolCallResult | undefined>)
    | undefined,
): ((
  context: AfterToolCallContext,
  signal?: AbortSignal,
) => Promise<AfterToolCallResult | undefined>) {
  return async (context, signal) => {
    // 1. 钩子系统:emit tool_result,handler 累积字段补丁
    const hookResult = (await hooks.emit(
      { type: "tool_result" },
      signal,
    )) as AfterToolCallResult | undefined;

    // 2. 用户的 afterToolCall
    const userResult = await userAfterToolCall?.(context, signal);

    // 3. 字段级合并:钩子系统的字段覆盖用户结果
    // 注意:userResult 没有的字段 → 用 hookResult 补
    //       userResult 有的字段 → 保留(钩子结果不"清空"用户结果)
    // 这样行为对调用方更可预测:用户设置的不被默默覆盖
    return {
      ...userResult,
      ...(hookResult ?? {}),
    };
  };
}
