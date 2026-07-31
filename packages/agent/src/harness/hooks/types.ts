/**
 * 钩子系统公共类型。
 *
 * 文件定位:
 * - 17 个事件类型(8 核心 + 9 预声明)集中声明
 * - AgentHarnessHookEvent 是它们的联合
 * - 公共类型:AgentHarnessHookContext / ResultOf / AgentHarnessHookName
 * - 门面接口:AgentHarnessHookContextFacade / SessionFacade / ModelFacade
 *
 * 设计原则:
 * - 事件类型基于 harness/types/harness.ts 的 HookEvent 泛型,带幻影结果
 * - 9 个预声明事件类型已定义但未在 agent-harness 中 emit(等后续 Task 启用)
 * - AgentHarnessHookEvent 是 DefaultAgentHarnessHooks<E, Ctx> 的 E 参数
 */

import type {
  HookEvent,
  HookHandler,
  HookObserver,
} from "../types/harness.js";
import type {
  AgentContext,
  AgentMessage,
  AgentToolCall,
  ThinkingLevel,
} from "../../types.js";
import type { AgentHarnessPhase } from "../phase.js";

// ── 8 个核心事件(本 Task 启用) ──

/**
 * context 事件:转换发送给 LLM 的消息链。
 *
 * 语义:链式转换(每个 handler 看到上一个的 messages,返回新的)。
 * 触发时机:每次 LLM 调用前。
 */
export type ContextHookEvent = HookEvent<
  "context",
  { messages?: AgentMessage[] }
>;

/**
 * before_agent_start 事件:agent 启动前。
 *
 * 语义:fire-and-forget,但可返回 messages / systemPrompt 修改。
 * 触发时机:harness.prompt() 启动时(进入 LLM 调用前)。
 */
export type BeforeAgentStartHookEvent = HookEvent<
  "before_agent_start",
  { messages?: AgentMessage[]; systemPrompt?: string }
>;

/**
 * tool_call 事件:工具调用前拦截。
 *
 * 语义:遇 block=true 提前退出(阻止工具执行)。
 * 触发时机:每个 toolCall 执行前(参数已校验)。
 *
 * event 携带上下文(handler 用来判断是否阻止):
 * - `toolCall`:工具调用的具体内容(name + arguments)
 * - `args`:经过 schema 校验后的参数
 * - `context`:当前 agent 上下文
 * - `assistantMessage`:触发本 toolCall 的 assistant 消息
 */
export type ToolCallHookEvent = HookEvent<
  "tool_call",
  { block?: boolean; reason?: string }
> & {
  toolCall: AgentToolCall;
  args: unknown;
  context: AgentContext;
  assistantMessage: import("@mimi/ai").AssistantMessage;
};

/**
 * tool_result 事件:工具结果后处理。
 *
 * 语义:累积补丁(每个 handler 可独立覆盖 content / details / isError / terminate)。
 * 触发时机:每个 toolCall 执行后(但 tool_execution_end 派发前)。
 */
export type ToolResultHookEvent = HookEvent<
  "tool_result",
  {
    content?: unknown;
    details?: unknown;
    isError?: boolean;
    terminate?: boolean;
  }
>;

/**
 * message_end 事件:消息结束时通知。
 *
 * 语义:fire-and-forget(只观察)。
 * 触发时机:每条 message 派发 message_end 时。
 */
export type MessageEndHookEvent = HookEvent<"message_end", void>;

/**
 * session_before_compact 事件:压缩前拦截。
 *
 * 语义:遇 cancel=true 取消压缩;返回 compaction 注入已有结果。
 * 触发时机:harness.compact() 启动时。
 */
export type SessionBeforeCompactHookEvent = HookEvent<
  "session_before_compact",
  { cancel?: boolean; compaction?: unknown }
>;

/**
 * model_update 事件:模型变更通知。
 *
 * 语义:fire-and-forget(只观察)。
 * 触发时机:调用 harness.setModel() 时。
 */
export type ModelUpdateHookEvent = HookEvent<"model_update", void>;

/**
 * abort 事件:终止通知。
 *
 * 语义:fire-and-forget(只观察)。
 * 触发时机:harness.abort() 被调用时。
 */
export type AbortHookEvent = HookEvent<"abort", void>;

// ── 9 个预声明事件(Task 4 阶段不 emit,只占位) ──

/** before_provider_request 事件:provider 请求前可改 streamOptions(预声明) */
export type BeforeProviderRequestHookEvent = HookEvent<
  "before_provider_request",
  { streamOptions?: unknown }
>;

/** before_provider_payload 事件:provider 请求体可改(预声明) */
export type BeforeProviderPayloadHookEvent = HookEvent<
  "before_provider_payload",
  { payload: unknown }
>;

/** after_provider_response 事件:provider 返回后只读观察(预声明) */
export type AfterProviderResponseHookEvent = HookEvent<
  "after_provider_response",
  void
>;

/** session_compact 事件:压缩完成后通知(预声明) */
export type SessionCompactHookEvent = HookEvent<"session_compact", void>;

/** session_before_tree 事件:树形跳转前可拦截(预声明) */
export type SessionBeforeTreeHookEvent = HookEvent<
  "session_before_tree",
  {
    cancel?: boolean;
    summary?: unknown;
    customInstructions?: string;
    replaceInstructions?: string;
    label?: string;
  }
>;

/** session_tree 事件:树形跳转完成后通知(预声明) */
export type SessionTreeHookEvent = HookEvent<"session_tree", void>;

/** thinking_level_update 事件:thinking level 变更(预声明) */
export type ThinkingLevelUpdateHookEvent = HookEvent<
  "thinking_level_update",
  void
>;

/** resources_update 事件:resources 变更(预声明) */
export type ResourcesUpdateHookEvent = HookEvent<"resources_update", void>;

/** tools_update 事件:tools 变更(预声明) */
export type ToolsUpdateHookEvent = HookEvent<"tools_update", void>;

/** queue_update 事件:队列变化(预声明) */
export type QueueUpdateHookEvent = HookEvent<"queue_update", void>;

/** save_point 事件:保存点通知(预声明) */
export type SavePointHookEvent = HookEvent<"save_point", void>;

/** settled 事件:操作结算通知(预声明) */
export type SettledHookEvent = HookEvent<"settled", void>;

// ── 公共联合类型 ──

/**
 * 17 个事件的联合(8 核心 + 9 预声明)。
 *
 * 作为 DefaultAgentHarnessHooks 的 E 参数。
 * 配合 ResultOf<TEvent> 可以在 emit 时推导返回类型。
 */
export type AgentHarnessHookEvent =
  | ContextHookEvent
  | BeforeAgentStartHookEvent
  | ToolCallHookEvent
  | ToolResultHookEvent
  | MessageEndHookEvent
  | SessionBeforeCompactHookEvent
  | ModelUpdateHookEvent
  | AbortHookEvent
  | BeforeProviderRequestHookEvent
  | BeforeProviderPayloadHookEvent
  | AfterProviderResponseHookEvent
  | SessionCompactHookEvent
  | SessionBeforeTreeHookEvent
  | SessionTreeHookEvent
  | ThinkingLevelUpdateHookEvent
  | ResourcesUpdateHookEvent
  | ToolsUpdateHookEvent
  | QueueUpdateHookEvent
  | SavePointHookEvent
  | SettledHookEvent;

/**
 * 17 个事件名的字面量联合。
 *
 * 用途:限制 type 参数,避免拼写错误。
 */
export type AgentHarnessHookName = AgentHarnessHookEvent["type"];

/**
 * 从事件类型中提取"handler 可能的返回结果"。
 *
 * 处理:
 * - 事件 TEvent 的 __result 是 void 时 → 返回 undefined(因为 void 不会实际返回)
 * - 事件 TEvent 的 __result 是对象类型时 → 返回该对象(handler 可能返回 undefined)
 *
 * 用法:
 * ```ts
 * const r: ResultOf<ContextHookEvent> = await hooks.emit({ type: "context" });
 * //   ^? { messages?: AgentMessage[] } | undefined
 * ```
 */
export type ResultOf<E> = E extends HookEvent<string, infer R>
  ? [R] extends [void]
    ? undefined
    : R | undefined
  : never;

// ── 钩子 Context 类型 ──

/**
 * Session 门面:handlers 通过 ctx.session 访问 session 的只读视图。
 *
 * 当前 Task 阶段为占位,后续 Task 5 接入 Session 后充实。
 * 重要:handlers 拿到的是 facade 而非原始 session,避免 handler 误改内部状态。
 */
export interface SessionFacade {
  /**
   * 获取 session id(可能为 Promise,因为 Session.getMetadata() 是 async)。
   */
  getId?(): string | Promise<string>;
  /**
   * 获取 session 当前 messages 列表(只读,可能为 Promise)。
   *
   * 用于 runContextSemantics 初始 messages 的来源。
   * Session.buildContext() 是 async,返回 Promise<AgentMessage[]>。
   */
  getMessages?(): readonly unknown[] | Promise<readonly unknown[]>;
}

/**
 * Model 门面:handlers 通过 ctx.models 访问 model 集合的只读视图。
 *
 * 当前 Task 阶段为占位,后续 Task 充实(可能是 @mimi/ai 的 models 集合)。
 */
export interface ModelFacade {
  /** 获取当前 model(只读) */
  getCurrent?(): unknown;
}

/**
 * Harness 门面:handlers 通过 ctx.harness 访问 harness 的只读视图。
 *
 * 重要:**不**暴露 setter,handler 只能读取状态、不能修改。
 * 这避免 handler 误改 harness 配置引发竞态。
 *
 * 本 Task 阶段只暴露最常用 getter,后续 Task 按需扩展。
 */
export interface AgentHarnessHookContextFacade {
  /** 获取当前 model */
  getModel(): unknown;
  /** 获取当前工具集合 */
  getTools(): readonly unknown[];
  /** 获取当前 phase */
  getPhase(): AgentHarnessPhase;
}

/**
 * 钩子 context:emit 时传入 handler 的"环境信息"。
 *
 * 包含:
 * - harness:AgentHarness 实例(handler 拿到的是原始引用,需自行保证只读)
 * - session:Session 只读 facade
 * - models:Model 集合只读 facade
 * - messages:当前会话的 messages 列表(context 事件 handler 用它做链式转换)
 *
 * messages 字段必填(可空数组 []):这样 context 事件的 handler
 * 可以直接从 ctx.messages 读,emit 路由时不用构造临时 ctx。
 *
 * 当前 Task 阶段:agent-harness 尚未接入 session,默认 []。
 * 后续 Task 5 接入 session 后,emit context 前会用 session.getMessages() 填充。
 */
export interface AgentHarnessHookContext {
  /** Harness 实例(handler 收到原始引用,本 Task 阶段不强制只读) */
  harness: any;
  /** Session facade(占位) */
  session: SessionFacade;
  /** Model facade(占位) */
  models: ModelFacade;
  /**
   * 当前会话的 messages 列表。
   *
   * - context 事件的 handler 从这里读 messages 做链式转换
   * - 其他事件的 handler 可以忽略此字段
   * - 必填:AgentHarnessHookContext 构造时必须提供(可空数组 [])
   */
  messages: AgentMessage[];
}

/**
 * 钩子 context provider 的形状:emit 时如何给 handler 注入 context。
 *
 * 语义上是一个 AsyncIterable,允许在多个 emit 之间流式提供 ctx。
 * 当前 Task 阶段:DefaultAgentHarnessHooks 内部直接持有 context 引用,
 * 这个类型主要为未来扩展(动态 context)留接口。
 */
export interface HookContextProvider {
  [Symbol.asyncIterator](): AsyncIterator<AgentHarnessHookContext>;
}

// ── 公共类型重导出 ──
//
// 把 hook 相关的类型在 harness 层重新聚合,避免外部 import 散落各处。
// 这些类型在 DefaultAgentHarnessHooks<E, Ctx> 签名中使用。

/** HookHandler 重新导出(避免外部 import 散落) */
export type { HookHandler, HookObserver };

/** 钩子订阅句柄:可 for await 迭代事件 */
export interface HookSubscription {
  /** 异步迭代器(预留,本 Task 阶段未启用) */
  [Symbol.asyncIterator](): AsyncIterator<AgentHarnessHookEvent>;
  /** 取消订阅 */
  cancel(): void;
}

/** Thinking level 重新导出,方便 handler 类型推导 */
export type { ThinkingLevel };
