/**
 * AI 层核心类型定义。
 * 从 pi 项目的 types.ts 精简而来，只保留必需的字段和类型。
 */

import type { TSchema } from "typebox";

// ── API / Provider 标识 ──

/** 支持的 API 类型 */
export type KnownApi = "anthropic-messages" | "openai-completions";
export type Api = KnownApi | (string & {});

/** 支持的 Provider */
export type KnownProvider = "anthropic" | "openai" | "deepseek";
export type ProviderId = KnownProvider | string;

// ── 内容块 ──

/** 文本内容块 */
export interface TextContent {
  type: "text";
  text: string;
}

/** 思考内容块（模型的内部推理过程） */
export interface ThinkingContent {
  type: "thinking";
  thinking: string;
}

/** 图片内容块 */
export interface ImageContent {
  type: "image";
  data: string;   // base64 编码
  mimeType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
}

/** 工具调用块 */
export interface ToolCall {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, any>;
}

// ── 消息 ──

/** 用户消息 */
export interface UserMessage {
  role: "user";
  content: string | (TextContent | ImageContent)[];
  timestamp: number;
}

/** 助手消息 */
export interface AssistantMessage {
  role: "assistant";
  content: (TextContent | ThinkingContent | ToolCall)[];
  api: Api;
  provider: ProviderId;
  model: string;
  usage: Usage;
  stopReason: StopReason;
  errorMessage?: string;
  timestamp: number;
}

/** 工具结果消息 */
export interface ToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: (TextContent | ImageContent)[];
  isError: boolean;
  timestamp: number;
}

/** 统一消息类型 */
export type Message = UserMessage | AssistantMessage | ToolResultMessage;

/** 停止原因 */
export type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";

// ── 用量 ──

/** 用量统计 */
export interface Usage {
  input: number;
  output: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    total: number;
  };
}

/** 模型价格（$/百万 token） */
export interface ModelCost {
  input: number;
  output: number;
}

// ── 模型 ──

/** 统一的模型描述 */
export interface Model<TApi extends Api = Api> {
  id: string;              // 模型 ID
  name: string;            // 显示名称
  api: TApi;               // 所属 API 类型
  provider: ProviderId;    // 所属 Provider
  baseUrl: string;         // API 地址
  reasoning: boolean;      // 是否支持深度思考
  input: ("text" | "image")[];   // 支持的输入类型
  cost: ModelCost;         // 价格
  contextWindow: number;   // 上下文窗口大小
  maxTokens: number;       // 最大输出 token
}

// ── 工具 ──

/** 工具定义（使用 TypeBox Schema） */
export interface Tool<TParameters extends TSchema = TSchema> {
  name: string;
  description: string;
  parameters: TParameters;
}

// ── 上下文 ──

/** 调用上下文 */
export interface Context {
  systemPrompt?: string;
  messages: Message[];
  tools?: Tool[];
}

// ── 流式选项 ──

/** HTTP 响应信息（用于 debug 回调） */
export interface ProviderResponse {
  status: number;
  headers: Record<string, string>;
}

/** 流式调用选项 */
export interface StreamOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  apiKey?: string;
  reasoning?: boolean | "low" | "medium" | "high";
  /** 请求发出前的回调：可检查或替换原始请求体，用于 debug */
  onPayload?: (payload: unknown, model: Model<Api>) => unknown | undefined | Promise<unknown | undefined>;
  /** 收到 HTTP 响应后的回调：可检查响应头、状态码等元信息 */
  onResponse?: (response: ProviderResponse, model: Model<Api>) => void | Promise<void>;
}

// ── 事件流协议 ──

/** 流式事件类型 */
export type AssistantMessageEvent =
  | { type: "start"; partial: AssistantMessage }
  | { type: "text_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "text_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "text_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "thinking_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "thinking_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "toolcall_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
  | { type: "done"; reason: Exclude<StopReason, "error" | "aborted">; message: AssistantMessage }
  | { type: "error"; reason: "aborted" | "error"; error: AssistantMessage };

// ── 类型守卫 ──

/**
 * 运行时检查一个 Model 是否属于指定的 API 类型。
 * 用于动态查找模型的类型窄化。
 *
 * @example
 * const model = models.getModel("anthropic", "claude-sonnet");
 * if (model && hasApi(model, "anthropic-messages")) {
 *   // model 的类型在这里窄化为 Model<"anthropic-messages">
 * }
 */
export function hasApi<TApi extends Api>(model: Model<Api>, api: TApi): model is Model<TApi> {
  return model.api === api;
}
