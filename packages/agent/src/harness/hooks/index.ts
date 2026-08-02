/**
 * harness/hooks 模块公共 API 入口。
 *
 * 本模块是 harness 的"扩展对接层",提供 12 个实际 emit 的事件
 * + 5 种变更语义的钩子系统。
 *
 * 主要导出:
 * - DefaultAgentHarnessHooks: 默认实现类
 * - 12 个事件类型(ContextHookEvent / ToolCallHookEvent 等)
 * - AgentHarnessHookContext / AgentHarnessHookEvent / ResultOf 等公共类型
 * - SessionFacade 门面接口
 *
 * 使用示例:
 * ```ts
 * const hooks = new DefaultAgentHarnessHooks({
 *   context: { harness, session, messages: [] }
 * });
 *
 * // 1. observer: 监听所有事件
 * hooks.observe((event, ctx) => console.log(event.type));
 *
 * // 2. handler: 参与特定事件的语义
 * hooks.on("tool_call", (event) => ({ block: true, reason: "禁止" }));
 * hooks.on("context", (event, ctx) => ({ messages: [...ctx.messages, ...] }));
 * ```
 */

// ── 主类 ──

export {
  DefaultAgentHarnessHooks,
  type DefaultAgentHarnessHooksOptions,
} from "./default-hooks.js";

// ── 事件类型 ──

export type {
  ContextHookEvent,
  BeforeAgentStartHookEvent,
  ToolCallHookEvent,
  ToolResultHookEvent,
  MessageEndHookEvent,
  SessionBeforeCompactHookEvent,
  ModelUpdateHookEvent,
  AbortHookEvent,
  SessionBeforeTreeHookEvent,
  SessionCompactHookEvent,
  SessionTreeHookEvent,
  QueueUpdateHookEvent,
} from "./types.js";

// ── 公共联合类型 ──

export type {
  AgentHarnessHookEvent,
  AgentHarnessHookName,
  AgentHarnessHookContext,
  ResultOf,
  SessionFacade,
} from "./types.js";

// ── 重新导出(避免外部 import 散落) ──

export type { HookHandler, HookObserver } from "../types/harness.js";
