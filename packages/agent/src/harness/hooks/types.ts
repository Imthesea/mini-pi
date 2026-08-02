/**
 * 钩子系统公共类型。
 *
 * 文件定位:
 * - 8 个核心事件类型集中声明
 * - AgentHarnessHookEvent 是它们的联合
 * - 公共类型:AgentHarnessHookContext / ResultOf / AgentHarnessHookName
 * - SessionFacade:handler 通过 ctx.session 访问 session 的只读视图
 *
 * 设计原则:
 * - 事件类型基于 harness/types/harness.ts 的 HookEvent 泛型,带幻影结果
 * - 只声明实际 emit 的事件;未来新增事件时按需补充
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
import type { AgentHarnessResources } from "../types/options.js";

// ── 8 个核心事件 ──

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
 * 语义:收集 handler 返回的 { messages?, systemPrompt? }(字段级累积,后者胜)。
 * harness.prompt() 会把返回的 messages 追加到用户消息之后、systemPrompt 作为基础 system prompt。
 * 触发时机:harness.prompt() 启动时(进入 LLM 调用前)。
 *
 * 事件携带当前轮入参(与 pi 1:1 对齐,handler 可读到再决定是否覆盖):
 * - `prompt`:本轮用户输入文本
 * - `images`:本轮用户输入图片(可选)
 * - `systemPrompt`:当前已拼好的 system prompt(含 skills 块);返回 systemPrompt 会整体覆盖它
 * - `resources`:当前扩展资源(如 skills)
 */
export type BeforeAgentStartHookEvent = HookEvent<
  "before_agent_start",
  { messages?: AgentMessage[]; systemPrompt?: string }
> & {
  /** 本轮用户输入文本 */
  prompt: string;
  /** 本轮用户输入图片(可选) */
  images?: Array<{ data: string; mimeType: string }>;
  /** 当前已拼好的 system prompt(含 skills 块);返回 systemPrompt 可整体覆盖 */
  systemPrompt: string;
  /** 当前扩展资源(供 handler 参考,如 skills) */
  resources: AgentHarnessResources;
};

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

/** message_end 事件:消息结束时通知(语义:fire-and-forget,只观察)。 */
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

/** model_update 事件:模型变更通知(语义:fire-and-forget,只观察)。 */
export type ModelUpdateHookEvent = HookEvent<"model_update", void>;

/** abort 事件:终止通知(语义:fire-and-forget,只观察)。 */
export type AbortHookEvent = HookEvent<"abort", void>;

// ── 其余实际 emit 的事件 ──

/**
 * session_before_tree 事件:树形跳转前可拦截。
 *
 * 语义:遇 cancel=true 取消跳转;可返回 summary 注入已有结果。
 * 触发时机:harness.navigateTree() 启动时。
 */
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

/** session_compact 事件:压缩完成后通知(语义:fire-and-forget,只观察)。 */
export type SessionCompactHookEvent = HookEvent<"session_compact", void>;

/** session_tree 事件:树形跳转完成后通知(语义:fire-and-forget,只观察)。 */
export type SessionTreeHookEvent = HookEvent<"session_tree", void>;

/** queue_update 事件:队列变化通知(语义:fire-and-forget,只观察)。 */
export type QueueUpdateHookEvent = HookEvent<"queue_update", void>;

// ── 公共联合类型 ──

/**
 * 12 个实际 emit 事件的联合。
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
  | SessionBeforeTreeHookEvent
  | SessionCompactHookEvent
  | SessionTreeHookEvent
  | QueueUpdateHookEvent;

/** 12 个事件名的字面量联合(用途:限制 type 参数,避免拼写错误)。 */
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
 * 重要:handlers 拿到的是 facade 而非原始 session,避免 handler 误改内部状态。
 */
export interface SessionFacade {
  /** 获取 session id(可能为 Promise,因为 Session.getMetadata() 是 async)。 */
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
 * 钩子 context:emit 时传入 handler 的"环境信息"。
 *
 * 包含:
 * - harness:AgentHarness 实例(handler 拿到的是原始引用,需自行保证只读)
 * - session:Session 只读 facade
 * - messages:当前会话的 messages 列表(context 事件 handler 用它做链式转换)
 *
 * messages 字段必填(可空数组 []):这样 context 事件的 handler
 * 可以直接从 ctx.messages 读,emit 路由时不用构造临时 ctx。
 */
export interface AgentHarnessHookContext {
  /** Harness 实例(handler 收到原始引用) */
  harness: any;
  /** Session 只读门面 */
  session: SessionFacade;
  /**
   * 当前会话的 messages 列表。
   *
   * - context 事件的 handler 从这里读 messages 做链式转换
   * - 其他事件的 handler 可以忽略此字段
   */
  messages: AgentMessage[];
}

export type { HookHandler, HookObserver };
export type { ThinkingLevel };
