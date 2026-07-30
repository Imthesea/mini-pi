/**
 * 流式 assistant 响应 + 重试。
 *
 * 职责:
 * 1. 把 AgentMessage[] → Message[] 转换后,调 streamFn 拿到 AssistantMessageEventStream
 * 2. 转发事件为 AgentEvent(message_start / message_update / message_end)
 * 3. 遇到 stopReason="error" 且 isRetryableAssistantError 时,按指数退避重试
 * 4. 不可重试错误或重试耗尽 → 把最终 AssistantMessage 返回给 runLoop
 *
 * 契约:
 * - **不** throw 或 reject(失败编码到流中,runLoop 看到 stopReason="error" 自行处理)
 * - **不**重复 emit 同一个事件(message_start 只发一次,message_end 必发)
 * - 重试期间,AssistantMessage 推入 context.messages 一次,message_start 在第一帧派发
 */

import {
  isRetryableAssistantError,
  type AssistantMessage,
  type Context,
} from "@mimi/ai";
import type {
  AgentContext,
  AgentLoopConfig,
  AgentMessage,
  StreamFn,
} from "../types.js";
import type { AgentEventSink } from "./helpers.js";

/** 默认最大重试次数(从 pi 沿用) */
const DEFAULT_MAX_RETRIES = 2;
/** 默认单次最大退避毫秒(从 pi 沿用) */
const DEFAULT_MAX_RETRY_DELAY_MS = 60000;

/** streamSimple 的占位 —— 由调用方 streamFn 提供,agent-loop 不内置 */
const FALLBACK_STREAM_FN_ERROR =
  "agent-loop 需 config.streamFn 或参数 streamFn,两者都未提供";

/**
 * 阻塞地拿到一个 assistant response。
 *
 * - context 会被 mutate(partial assistant message 推入 messages)
 * - emit 会被调用若干次(message_start / message_update / message_end)
 * - 返回 final AssistantMessage(stopReason 可能是 "stop" / "toolUse" / "length" / "error" / "aborted")
 */
export async function streamAssistantResponse(args: {
  context: AgentContext;
  config: AgentLoopConfig;
  signal: AbortSignal | undefined;
  emit: AgentEventSink;
  streamFn: StreamFn | undefined;
}): Promise<AssistantMessage> {
  const { context, config, signal, emit, streamFn } = args;
  const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  const maxRetryDelay = config.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;

  // 重试循环：可重试错误 → 退避 → 重新发起 LLM 请求
  for (let attempt = 0; ; attempt++) {
    const result = await attemptStreamAssistant({
      context,
      config,
      signal,
      emit,
      streamFn: streamFn ?? config.streamFn,
    });

    // 非错误：直接返回
    if (result.stopReason !== "error") return result;

    // 不可重试 或 重试耗尽：返回错误结果
    const errorMsg = result.errorMessage ?? "Unknown error";
    if (attempt >= maxRetries || !isRetryableAssistantError(errorMsg)) {
      return result;
    }

    // 退避
    if (signal?.aborted) return result;
    const delay = Math.min(maxRetryDelay, computeBackoffMs(attempt));
    await sleep(delay, signal);

    // 重试：移除上一次推入 context 的 partial message,避免重复
    if (context.messages.length > 0) {
      const last = context.messages[context.messages.length - 1];
      if (last.role === "assistant") {
        context.messages.pop();
      }
    }
  }
}

/** 单次尝试：转换 context → 调 streamFn → 转发事件 → 返回 final message */
async function attemptStreamAssistant(args: {
  context: AgentContext;
  config: AgentLoopConfig;
  signal: AbortSignal | undefined;
  emit: AgentEventSink;
  streamFn: StreamFn | undefined;
}): Promise<AssistantMessage> {
  const { context, config, signal, emit, streamFn } = args;

  // 1. transformContext(可选):AgentMessage[] → AgentMessage[]
  let messages: AgentMessage[] = context.messages;
  if (config.transformContext) {
    messages = await config.transformContext(messages, signal);
  }

  // 2. convertToLlm:AgentMessage[] → Message[]
  const llmMessages = await config.convertToLlm(messages);

  // 3. 构造 LLM context
  const llmContext: Context = {
    systemPrompt: context.systemPrompt,
    messages: llmMessages,
    tools: context.tools,
  };

  if (!streamFn) {
    // 没有 streamFn：构造错误消息并 emit
    const errorMessage: AssistantMessage = {
      role: "assistant",
      content: [],
      api: config.model.api,
      provider: config.model.provider,
      model: config.model.id,
      usage: { input: 0, output: 0, totalTokens: 0, cost: { input: 0, output: 0, total: 0 } },
      stopReason: "error",
      errorMessage: FALLBACK_STREAM_FN_ERROR,
      timestamp: Date.now(),
    };
    await emit({ type: "message_start", message: errorMessage });
    await emit({ type: "message_end", message: errorMessage });
    return errorMessage;
  }

  // 4. 解析 apiKey(短生命周期 OAuth token 友好)
  const resolvedApiKey =
    (config.getApiKey ? await config.getApiKey(config.model.provider) : undefined) ||
    config.apiKey;

  // 5. 发起 stream
  const response = await streamFn(config.model, llmContext, {
    ...config,
    apiKey: resolvedApiKey,
    signal,
  });

  // 6. 转发事件为 AgentEvent
  let partialMessage: AssistantMessage | null = null;
  let addedPartial = false;

  for await (const event of response) {
    switch (event.type) {
      case "start":
        partialMessage = event.partial;
        context.messages.push(partialMessage);
        addedPartial = true;
        await emit({ type: "message_start", message: { ...partialMessage } });
        break;

      case "text_start":
      case "text_delta":
      case "text_end":
      case "thinking_start":
      case "thinking_delta":
      case "thinking_end":
      case "toolcall_start":
      case "toolcall_delta":
      case "toolcall_end":
        if (partialMessage) {
          partialMessage = event.partial;
          context.messages[context.messages.length - 1] = partialMessage;
          await emit({
            type: "message_update",
            assistantMessageEvent: event,
            message: { ...partialMessage },
          });
        }
        break;

      case "done":
      case "error": {
        const finalMessage = await response.result();
        if (addedPartial) {
          context.messages[context.messages.length - 1] = finalMessage;
        } else {
          context.messages.push(finalMessage);
        }
        if (!addedPartial) {
          await emit({ type: "message_start", message: { ...finalMessage } });
        }
        await emit({ type: "message_end", message: finalMessage });
        return finalMessage;
      }
    }
  }

  // 7. 流意外结束(没收到 done/error)
  const finalMessage = await response.result();
  if (addedPartial) {
    context.messages[context.messages.length - 1] = finalMessage;
  } else {
    context.messages.push(finalMessage);
    await emit({ type: "message_start", message: { ...finalMessage } });
  }
  await emit({ type: "message_end", message: finalMessage });
  return finalMessage;
}

/** 退避策略:100ms, 200ms, 400ms, ... cap 在 maxRetryDelay */
function computeBackoffMs(attempt: number): number {
  return 100 * Math.pow(2, attempt);
}

/** sleep,可被 signal 中断 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
