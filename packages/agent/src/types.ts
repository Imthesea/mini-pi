/**
 * Agent 层共用类型。
 *
 * 从 pi 项目的 `packages/agent/src/types.ts` 翻译而来，遵循 2026-07-30-phase02-agent-design.md
 * 的契约：
 * - 不引入轻量 `Agent` 类（pi 的 agent.ts 被完全跳过）
 * - 复用 `@mimi/ai` 的核心类型（Model / AssistantMessage / Message / Tool / StreamOptions）
 * - 完整保留 `CustomAgentMessages` 声明合并接口
 * - 中文优先：所有注释中文
 */

import type {
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  ImageContent,
  Message,
  Model,
  TextContent,
  Tool,
  ToolResultMessage,
} from "@mimi/ai";
import type { AssistantMessageEventStream } from "@mimi/ai";
import type { Static, TSchema } from "typebox";

// ── 思考等级 ──

/**
 * 思考/推理等级。
 * 与 pi 保持一致。`xhigh` 与 `max` 仅部分模型族支持。
 */
export type ThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

// ── 工具执行模式 ──

/**
 * 控制一个 assistant 消息触发的多个 toolCall 如何执行。
 *
 * - "sequential": 顺序执行,前一个完成后再执行下一个
 * - "parallel": 准备阶段顺序,执行阶段并发;`tool_execution_end` 按完成顺序派发
 */
export type ToolExecutionMode = "sequential" | "parallel";

// ── 队列模式 ──

/**
 * 控制队列（steer / follow-up / nextTurn）排空时的行为。
 *
 * - "all": 把队列里所有消息一次性注入
 * - "one-at-a-time": 每次排空点只注入最早的一条,其余保留
 */
export type QueueMode = "all" | "one-at-a-time";

// ── 工具调用内容块 ──

/** 从 AssistantMessage 中提取的 ToolCall 内容块 */
export type AgentToolCall = Extract<
  AssistantMessage["content"][number],
  { type: "toolCall" }
>;

// ── 工具结果类型 ──

/** 工具执行的最终或部分结果 */
export interface AgentToolResult<T> {
  /** 返回给模型的文本或图片内容 */
  content: (TextContent | ImageContent)[];
  /** 用于日志或 UI 渲染的任意结构化详情 */
  details: T;
  /** 该结果引入的、可在此后转录点使用的工具名集合 */
  addedToolNames?: string[];
  /**
   * 提示 agent 在当前工具批次后停止。
   * 仅当批次中所有 finalize 后的工具结果都设 `terminate: true` 时才生效。
   */
  terminate?: boolean;
}

/**
 * 工具用来推送部分执行更新的回调。
 * 回调作用域限于当前 `execute()` 调用,工具 promise 结束后调用被忽略。
 */
export type AgentToolUpdateCallback<T = any> = (
  partialResult: AgentToolResult<T>,
) => void;

// ── 工具定义 ──

/**
 * Agent 运行时使用的工具定义。
 * 继承 AI 层的 `Tool<T>`（仅 schema）,
 * 补充 `label` / `execute` / `executionMode` 等 agent 专用字段。
 */
export interface AgentTool<
  TParameters extends TSchema = TSchema,
  TDetails = any,
> extends Tool<TParameters> {
  /** UI 显示用的人类可读标签 */
  label: string;
  /** 执行工具调用。失败请 throw,不要把错误编码到 `content` 中 */
  execute: (
    toolCallId: string,
    params: Static<TParameters>,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<TDetails>,
  ) => Promise<AgentToolResult<TDetails>>;
  /**
   * 该工具的执行模式覆盖。
   * - "sequential": 必须与其它工具顺序执行
   * - "parallel": 可与其它工具并发执行
   *
   * 不设置时使用 `AgentLoopConfig.toolExecution` 默认值。
   */
  executionMode?: ToolExecutionMode;
}

// ── Agent 上下文（LLM 调用前的快照） ──

/**
 * 提供给 agent-loop 的完整调用上下文。
 * 每次 LLM 调用都基于此构造 `Context`（AI 层）。
 */
export interface AgentContext {
  /** 包含在请求里的 system prompt */
  systemPrompt: string;
  /** 模型可见的转录 */
  messages: AgentMessage[];
  /** 本次运行可用的工具 */
  tools?: AgentTool<any>[];
}

// ── 自定义消息 + AgentMessage 联合 ──

/**
 * 扩展点：通过 TypeScript 声明合并加入自定义消息类型。
 *
 * @example
 * ```ts
 * declare module "@mimi/agent" {
 *   interface CustomAgentMessages {
 *     notification: NotificationMessage;
 *   }
 * }
 * ```
 */
export interface CustomAgentMessages {
  // 默认空接口，外部模块通过声明合并扩展
}

/**
 * Agent 消息联合：LLM 标准消息 + 声明合并进来的自定义消息。
 */
export type AgentMessage = Message | CustomAgentMessages[keyof CustomAgentMessages];

// ── Tool Call Hooks 结果与上下文 ──

/** `beforeToolCall` 钩子可返回的结果 */
export interface BeforeToolCallResult {
  /** 为 true 时阻止工具执行,改成派发错误 tool result */
  block?: boolean;
  /** 阻止时该 reason 作为错误 tool result 的文本 */
  reason?: string;
}

/** `afterToolCall` 钩子可返回的部分覆盖 */
export interface AfterToolCallResult {
  /** 若提供,完整替换 tool result 的 content 数组 */
  content?: (TextContent | ImageContent)[];
  /** 若提供,完整替换 tool result 的 details */
  details?: unknown;
  /** 若提供,替换 error 标记 */
  isError?: boolean;
  /** 若提供,替换 early-termination 提示 */
  terminate?: boolean;
}

/** `beforeToolCall` 钩子拿到的上下文 */
export interface BeforeToolCallContext {
  /** 触发工具调用的 assistant 消息 */
  assistantMessage: AssistantMessage;
  /** assistant 消息中的 tool call 块 */
  toolCall: AgentToolCall;
  /** 经过 schema 校验后的参数 */
  args: unknown;
  /** 调用准备时的 agent context */
  context: AgentContext;
}

/** `afterToolCall` 钩子拿到的上下文 */
export interface AfterToolCallContext {
  assistantMessage: AssistantMessage;
  toolCall: AgentToolCall;
  args: unknown;
  /** hook 应用前的执行结果 */
  result: AgentToolResult<any>;
  /** 当前是否被当作 error */
  isError: boolean;
  /** finalize 时的 agent context */
  context: AgentContext;
}

/** `shouldStopAfterTurn` 钩子拿到的上下文 */
export interface ShouldStopAfterTurnContext {
  /** 当前 turn 完成后的 assistant 消息 */
  message: AssistantMessage;
  /** 跟随 turn_end 派发的 tool result 列表 */
  toolResults: ToolResultMessage[];
  /** assistant 消息 + tool results 已追加后的 context */
  context: AgentContext;
  /** 若此刻退出,本次 run 将返回的消息集合;prompt 模式包含 prompt 消息,continuation 模式不含 */
  newMessages: AgentMessage[];
}

/** 下一 turn 前的运行时状态覆盖（由 `prepareNextTurn` 返回） */
export interface AgentLoopTurnUpdate {
  /** 下一轮 provider 请求用的 context */
  context?: AgentContext;
  /** 下一轮用的 model */
  model?: Model<any>;
  /** 下一轮用的 thinking level */
  thinkingLevel?: ThinkingLevel;
}

/** `prepareNextTurn` 钩子的上下文,与 `shouldStopAfterTurn` 一致 */
export interface PrepareNextTurnContext extends ShouldStopAfterTurnContext {}

// ── 事件类型 ──

/**
 * agent-loop 派发的事件,用于订阅者接收实时更新。
 *
 * 事件序列（一个完整 run）：
 * ```
 * agent_start
 *   turn_start
 *     message_start (user)
 *     message_start (assistant)  ← 多次循环
 *       message_update (text/thinking/toolcall 增量)
 *     message_end (assistant)
 *     tool_execution_start / _update / _end  ← 0..N 个
 *     message_start (toolResult)  ← 0..N 个
 *     message_end (toolResult)
 *   turn_end
 *   [turn_start ...  若有 follow-up / steering / 工具结果,继续]
 * agent_end
 * ```
 */
export type AgentEvent =
  // Agent 生命周期
  | { type: "agent_start" }
  | { type: "agent_end"; messages: AgentMessage[] }
  // Turn 生命周期 — 一次 assistant 响应 + 0..N 个工具结果为一个 turn
  | { type: "turn_start" }
  | {
      type: "turn_end";
      message: AgentMessage;
      toolResults: ToolResultMessage[];
    }
  // Message 生命周期 — user / assistant / toolResult 消息都派发
  | { type: "message_start"; message: AgentMessage }
  | {
      type: "message_update";
      message: AgentMessage;
      assistantMessageEvent: AssistantMessageEvent;
    }
  | { type: "message_end"; message: AgentMessage }
  // 工具执行生命周期
  | {
      type: "tool_execution_start";
      toolCallId: string;
      toolName: string;
      args: any;
    }
  | {
      type: "tool_execution_update";
      toolCallId: string;
      toolName: string;
      args: any;
      partialResult: any;
    }
  | {
      type: "tool_execution_end";
      toolCallId: string;
      toolName: string;
      result: any;
      isError: boolean;
    };

// ── StreamFn（agent-loop 调用的 LLM 函数形状） ──

/**
 * agent-loop 使用的流函数。`Models.stream` 满足此形状。
 *
 * 契约：
 * - 不要 throw 或返回 rejected promise（请求/模型/运行时失败都应编码到流中）
 * - 必须返回 `AssistantMessageEventStream`
 * - 失败时通过协议事件 + 终态 `AssistantMessage` (stopReason="error" | "aborted", errorMessage=...) 表达
 */
export type StreamFn = (
  model: Model<any>,
  context: Context,
  options?: { signal?: AbortSignal; apiKey?: string },
) =>
  | AssistantMessageEventStream
  | Promise<AssistantMessageEventStream>;

// ── AgentLoopConfig（核心循环配置） ──

/**
 * agent-loop 的完整配置。
 *
 * 必填: model, convertToLlm
 * 可选: transformContext, getApiKey, shouldStopAfterTurn, prepareNextTurn,
 *       getSteeringMessages, getFollowUpMessages, toolExecution,
 *       beforeToolCall, afterToolCall, signal
 */
export interface AgentLoopConfig {
  /** 当前 LLM model */
  model: Model<any>;

  /**
   * 在每次 LLM 调用前把 AgentMessage[] 投影为 Message[]。
   *
   * 契约: 不要 throw/reject,失败的 fallback 由该函数自己负责。
   * throw 会中断底层 agent loop,无法产生正常事件序列。
   *
   * @example
   * ```ts
   * convertToLlm: (messages) => messages.flatMap(m => {
   *   if (m.role === "custom") return [];
   *   return [m];
   * })
   * ```
   */
  convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;

  /**
   * 可选: 在 convertToLlm 之前对 AgentMessage 列表做转换。
   * 用途: 上下文窗口管理、外部上下文注入。
   */
  transformContext?: (
    messages: AgentMessage[],
    signal?: AbortSignal,
  ) => Promise<AgentMessage[]>;

  /**
   * 可选: 每次 LLM 调用前动态解析 API key。
   * 用于短生命周期的 OAuth token。
   * 契约: 不要 throw,无 key 时返回 undefined。
   */
  getApiKey?: (
    provider: string,
  ) => Promise<string | undefined> | string | undefined;

  /**
   * 可选: 每个 turn 完全结束、`turn_end` 派发后调用。
   * 返回 true 时,loop 派发 `agent_end` 并在排空 steer/follow-up 队列前退出。
   * 用途: 在上下文过满前请求优雅停止。
   */
  shouldStopAfterTurn?: (
    context: ShouldStopAfterTurnContext,
  ) => boolean | Promise<boolean>;

  /**
   * 可选: `turn_end` 后、loop 决定是否开启下一轮 LLM 调用前调用。
   * 返回 state 覆盖影响下一 turn;返回 undefined 保持当前。
   */
  prepareNextTurn?: (
    context: PrepareNextTurnContext,
  ) => AgentLoopTurnUpdate | undefined | Promise<AgentLoopTurnUpdate | undefined>;

  /**
   * 可选: 返回 steering 消息,在当前 assistant turn 完成工具调用后注入。
   * 用途: 工作中途改变 agent 方向。
   * 契约: 不要 throw,无消息时返回 []。
   */
  getSteeringMessages?: () => Promise<AgentMessage[]>;

  /**
   * 可选: 返回 follow-up 消息,agent 原本要停时注入并继续。
   * 契约: 不要 throw,无消息时返回 []。
   */
  getFollowUpMessages?: () => Promise<AgentMessage[]>;

  /**
   * 工具执行模式,默认 "parallel"。
   */
  toolExecution?: ToolExecutionMode;

  /**
   * 可选: 工具执行前调用（参数已校验）。
   * 返回 { block: true } 阻止执行,改为派发错误 tool result。
   * 钩子自己负责 honor agent abort signal。
   */
  beforeToolCall?: (
    context: BeforeToolCallContext,
    signal?: AbortSignal,
  ) => Promise<BeforeToolCallResult | undefined>;

  /**
   * 可选: 工具完成后、`tool_execution_end` 派发前调用。
   * 返回 `AfterToolCallResult` 增量覆盖执行结果（content/details/isError/terminate 各自独立）。
   * 钩子自己负责 honor agent abort signal。
   */
  afterToolCall?: (
    context: AfterToolCallContext,
    signal?: AbortSignal,
  ) => Promise<AfterToolCallResult | undefined>;

  /** 可选: 全局 abort signal */
  signal?: AbortSignal;
}
