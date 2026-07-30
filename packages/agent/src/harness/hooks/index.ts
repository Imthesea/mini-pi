/**
 * harness/hooks 模块公共 API 入口。
 *
 * 本模块是 harness 的"扩展对接层",提供 17 个事件(8 核心 + 9 预声明)
 * + 5 种变更语义的钩子系统。
 *
 * 主要导出:
 * - DefaultAgentHarnessHooks: 默认实现类
 * - 8 个核心事件类型(ContextHookEvent / BeforeAgentStartHookEvent 等)
 * - 9 个预声明事件类型
 * - AgentHarnessHookContext / AgentHarnessHookEvent / ResultOf 等公共类型
 * - SessionFacade / ModelFacade / AgentHarnessHookContextFacade 门面接口
 *
 * 使用示例:
 * ```ts
 * const hooks = new DefaultAgentHarnessHooks({
 *   context: { harness, session, models, messages: [] }
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

// ── 事件类型(8 核心) ──

export type {
  ContextHookEvent,
  BeforeAgentStartHookEvent,
  ToolCallHookEvent,
  ToolResultHookEvent,
  MessageEndHookEvent,
  SessionBeforeCompactHookEvent,
  ModelUpdateHookEvent,
  AbortHookEvent,
} from "./types.js";

// ── 事件类型(9 预声明,Task 4 阶段不 emit) ──

export type {
  BeforeProviderRequestHookEvent,
  BeforeProviderPayloadHookEvent,
  AfterProviderResponseHookEvent,
  SessionCompactHookEvent,
  SessionBeforeTreeHookEvent,
  SessionTreeHookEvent,
  ThinkingLevelUpdateHookEvent,
  ResourcesUpdateHookEvent,
  ToolsUpdateHookEvent,
  QueueUpdateHookEvent,
  SavePointHookEvent,
  SettledHookEvent,
} from "./types.js";

// ── 公共联合类型 ──

export type {
  AgentHarnessHookEvent,
  AgentHarnessHookName,
  AgentHarnessHookContext,
  AgentHarnessHookContextFacade,
  ResultOf,
  SessionFacade,
  ModelFacade,
  HookContextProvider,
  HookSubscription,
} from "./types.js";

// ── 重新导出(避免外部 import 散落) ──

export type { HookHandler, HookObserver } from "../types/harness.js";
