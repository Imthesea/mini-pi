/**
 * 单元测试专用 mock provider。
 *
 * 设计目的：让 agent-loop 的状态机测试不依赖真实 LLM。
 *
 * 用法：
 * 1. 准备一个 "剧本" `responses: ScriptedResponse[]`
 * 2. 调用 `createMockStreamFn(responses)` 拿到 streamFn
 * 3. 把它作为 `config.streamFn` 传给 `runAgentLoop`
 * 4. 每次 agent-loop 调 LLM 时，streamFn 弹出一个剧本，转化为 `AssistantMessageEventStream`
 *
 * 剧本（ScriptedResponse）支持三种形态：
 * - `{ kind: "text", text }` —— 模型只输出文本
 * - `{ kind: "toolCalls", toolCalls }` —— 模型输出工具调用
 * - `{ kind: "error", errorMessage, stopReason? }` —— 模型错误（用于测试重试）
 *
 * 设计原则：
 * - **不**模拟流式事件细节，只把 AssistantMessage 推到流中（start → ... → done）
 * - 让测试聚焦于 agent-loop 的状态机，而非 LLM 流协议
 * - 可重入：同一剧本可被多个测试共享（不改写原始数组）
 */

import {
  AssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Context,
  type Model,
  type StreamFn,
  type ToolCall,
} from "@mimi/ai";

// ── 剧本类型 ──

/** 单次 LLM 调用的"模型行为" */
export type ScriptedResponse =
  | { kind: "text"; text: string }
  | { kind: "toolCalls"; toolCalls: ToolCall[]; text?: string }
  | { kind: "error"; errorMessage: string; stopReason?: "error" | "aborted" };

/** 剧本式 stream 工厂 */
export interface MockStreamHandle {
  /** 当前已消耗的剧本数量 */
  consumed: number;
  /** 实际调用的次数（含重试） */
  callCount: number;
  /** 剩余剧本（只读快照） */
  remaining: () => readonly ScriptedResponse[];
}

/**
 * 创建一个 streamFn，按剧本依次返回。
 *
 * 行为：
 * - 每次调用，弹出第一个剧本
 * - `text` 剧本：推到 start + text_start + text_delta + text_end + done
 * - `toolCalls` 剧本：推到 start + toolcall_start（每个）+ toolcall_end（每个）+ done
 * - `error` 剧本：推到 start + error（带 stopReason="error"/"aborted"）
 * - 剧本耗尽时：返回带 "no more responses" 错误的流（fail fast）
 *
 * @param responses 剧本数组（**不**被改写，副本用于消费）
 */
export function createMockStreamFn(
  responses: readonly ScriptedResponse[],
): { streamFn: StreamFn; handle: MockStreamHandle } {
  // 用索引消费，避免改写原数组
  let cursor = 0;
  const handle: MockStreamHandle = {
    consumed: 0,
    callCount: 0,
    remaining: () => responses.slice(cursor),
  };

  const streamFn: StreamFn = (
    _model: Model<any>,
    _context: Context,
    _options?: { signal?: AbortSignal; apiKey?: string },
  ) => {
    handle.callCount += 1;

    const stream = new AssistantMessageEventStream();

    // 异步推，避免同步递归
    queueMicrotask(() => {
      const response = responses[cursor++];
      handle.consumed = cursor;

      if (!response) {
        const errMsg = makeErrorMessage(
          _model,
          `Mock stream 剧本耗尽（已调用 ${handle.callCount} 次，需要至少 ${handle.callCount} 个剧本）`,
        );
        stream.push({ type: "start", partial: errMsg });
        stream.push({ type: "error", reason: "error", error: errMsg });
        return;
      }

      pushResponse(stream, _model, response);
    });

    return stream;
  };

  return { streamFn, handle };
}

/** 把单个剧本推入流中 */
function pushResponse(
  stream: AssistantMessageEventStream,
  model: Model<any>,
  response: ScriptedResponse,
): void {
  if (response.kind === "error") {
    const errMsg = makeErrorMessage(model, response.errorMessage);
    errMsg.stopReason = response.stopReason ?? "error";
    stream.push({ type: "start", partial: errMsg });
    stream.push({ type: "error", reason: errMsg.stopReason, error: errMsg });
    return;
  }

  // text / toolCalls 都构造一个正常的 AssistantMessage
  const content: AssistantMessage["content"] = [];

  if (response.kind === "toolCalls") {
    // text 可选（在 toolUse 之前或之后）
    if (response.text) {
      content.push({ type: "text", text: response.text });
    }
    for (const tc of response.toolCalls) {
      content.push(tc);
    }
  } else {
    // text 剧本
    content.push({ type: "text", text: response.text });
  }

  // 构造 partial
  const partial: AssistantMessage = {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: { input: 0, output: 0, totalTokens: 0, cost: { input: 0, output: 0, total: 0 } },
    stopReason: response.kind === "toolCalls" ? "toolUse" : "stop",
    timestamp: Date.now(),
  };

  // 推 start
  stream.push({ type: "start", partial: { ...partial, content: [] } });

  // 推 content blocks
  for (let i = 0; i < content.length; i++) {
    const block = content[i];
    if (block.type === "text") {
      stream.push({
        type: "text_start",
        contentIndex: i,
        partial: { ...partial, content: content.slice(0, i) },
      });
      stream.push({
        type: "text_delta",
        contentIndex: i,
        delta: block.text,
        partial: { ...partial, content: content.slice(0, i + 1) },
      });
      stream.push({
        type: "text_end",
        contentIndex: i,
        content: block.text,
        partial: { ...partial, content: content.slice(0, i + 1) },
      });
    } else if (block.type === "toolCall") {
      stream.push({
        type: "toolcall_start",
        contentIndex: i,
        partial: { ...partial, content: content.slice(0, i) },
      });
      stream.push({
        type: "toolcall_end",
        contentIndex: i,
        toolCall: block,
        partial: { ...partial, content: content.slice(0, i + 1) },
      });
    }
    // thinking 类型不展开（测试不需要）
  }

  // 推 done
  const finalMessage: AssistantMessage = {
    ...partial,
    content,
    stopReason: response.kind === "toolCalls" ? "toolUse" : "stop",
  };
  stream.push({ type: "done", reason: finalMessage.stopReason as "stop", message: finalMessage });
}

/** 一个固定 model，单元测试不需要真模型 */
export const mockModel: Model<any> = {
  id: "mock-model",
  name: "Mock Model",
  api: "anthropic-messages",
  provider: "mock",
  baseUrl: "https://mock.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0 },
  contextWindow: 200000,
  maxTokens: 8192,
};

/** 构造一个简单工具（echo） */
export function makeEchoTool() {
  return {
    name: "echo",
    label: "Echo",
    description: "回显输入",
    parameters: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    } as any,
    execute: async (_id: string, params: { text: string }) => {
      return {
        content: [{ type: "text" as const, text: `echo: ${params.text}` }],
        details: { ok: true },
      };
    },
  };
}

/** 构造一个抛错的工具 */
export function makeFailTool() {
  return {
    name: "fail",
    label: "Fail",
    description: "总是抛错",
    parameters: {
      type: "object",
      properties: { reason: { type: "string" } },
      required: ["reason"],
    } as any,
    execute: async () => {
      throw new Error("intentional failure");
    },
  };
}

/** 构造一个 error 状态的 AssistantMessage(本地副本,因为 @mimi/ai 不导出 createErrorAssistantMessage) */
function makeErrorMessage(model: Model<any>, errorMessage: string): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: { input: 0, output: 0, totalTokens: 0, cost: { input: 0, output: 0, total: 0 } },
    stopReason: "error",
    errorMessage,
    timestamp: Date.now(),
  };
}
