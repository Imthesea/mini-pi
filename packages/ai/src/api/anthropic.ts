/**
 * Anthropic Messages API 实现。
 * 将统一格式转换为 Anthropic SDK 格式，流式事件映射回我们的事件协议。
 *
 * 需要 ANTHROPIC_API_KEY 环境变量。
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageCreateParams,
  MessageParam,
  ContentBlock,
  Tool as AnthropicTool,
} from "@anthropic-ai/sdk/resources/messages.mjs";
import type {
  AssistantMessage,
  Context,
  Model,
  StopReason,
  StreamOptions,
  TextContent,
  ToolCall,
} from "../types.js";
import type { Provider } from "../provider/index.js";
import { defaultComplete } from "../provider/index.js";
import { AssistantMessageEventStream } from "../stream/index.js";
import { envApiKey } from "../auth/index.js";
import { transformMessages } from "../utils/transform-messages.js";
import { normalizeProviderError } from "../utils/error-body.js";
import { createErrorAssistantMessage } from "../utils/assistant-message.js";

// ── 模型列表 ──

const ANTHROPIC_MODELS: Record<string, Model<"anthropic-messages">> = {
  "claude-sonnet-4-20250514": {
    id: "claude-sonnet-4-20250514",
    name: "Claude Sonnet 4",
    api: "anthropic-messages",
    provider: "anthropic",
    baseUrl: "https://api.anthropic.com",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 3.0, output: 15.0 },
    contextWindow: 200000,
    maxTokens: 8192,
  },
};

// ── reasoning 映射 ──

function mapReasoningBudget(level: boolean | "low" | "medium" | "high"): number {
  if (level === true) return 16000;
  switch (level) {
    case "low": return 4000;
    case "medium": return 8000;
    case "high": return 32000;
    default: return 16000;
  }
}

// ── 消息转换 ──

function convertMessages(messages: Context["messages"]): MessageParam[] {
  const result: MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        result.push({ role: "user", content: msg.content });
      } else {
        const blocks: ContentBlock[] = msg.content.map((c) => {
          if (c.type === "text") return { type: "text" as const, text: c.text } as ContentBlock;
          if (c.type === "image") {
            return {
              type: "image" as const,
              source: { type: "base64" as const, media_type: c.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: c.data },
            } as unknown as ContentBlock;
          }
          return { type: "text" as const, text: "" } as ContentBlock;
        });
        result.push({ role: "user", content: blocks });
      }
    } else if (msg.role === "assistant") {
      result.push({
        role: "assistant",
        content: msg.content
          .filter((c) => c.type !== "thinking") // 🔧 跳过 thinking 块——多轮回传不需要
          .map((c) => {
            if (c.type === "text") return { type: "text" as const, text: c.text } as ContentBlock;
            if (c.type === "toolCall") {
              return {
                type: "tool_use" as const,
                id: c.id,
                name: c.name,
                input: c.arguments,
              } as ContentBlock;
            }
            return { type: "text" as const, text: "" } as ContentBlock;
          }),
      });
    } else if (msg.role === "toolResult") {
      result.push({
        role: "user",
        content: [{
          type: "tool_result" as const,
          tool_use_id: msg.toolCallId,
          content: msg.content.filter((c): c is TextContent => c.type === "text").map((c) => c.text).join(""),
          is_error: msg.isError,
        }],
      });
    }
  }

  return result;
}

function convertTools(tools: Context["tools"]): AnthropicTool[] {
  if (!tools) return [];
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    // structuredClone 返回 TSchema；Anthropic 期望 InputSchema（带 type 字段的 JSON Schema）。
    // TypeBox schema 在运行时是 JSON-Schema 兼容对象，这里做一次安全 cast。
    input_schema: structuredClone(t.parameters) as AnthropicTool["input_schema"],
  }));
}

// ── Provider 工厂 ──

export function anthropicProvider(): Provider<"anthropic-messages"> {
  return {
    id: "anthropic",
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com",

    getApiKey: () => envApiKey("ANTHROPIC_API_KEY"),

    getModels: () => Object.values(ANTHROPIC_MODELS) as Model<"anthropic-messages">[],
    getModel: (id: string) => ANTHROPIC_MODELS[id],

    stream(model: Model<"anthropic-messages">, context: Context, options?: StreamOptions) {
      return anthropicStream(model, context, options);
    },

    async complete(model, context, options) {
      return defaultComplete(this, model, context, options);
    },
  };
}

// ── 流式实现 ──

function anthropicStream(
  model: Model<"anthropic-messages">,
  context: Context,
  options?: StreamOptions,
): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();
  const apiKey = options?.apiKey ?? envApiKey("ANTHROPIC_API_KEY");

  if (!apiKey) {
    stream.push({
      type: "error",
      reason: "error",
      error: createErrorAssistantMessage(model, "Provider \"anthropic\" 未配置。请设置 ANTHROPIC_API_KEY 环境变量。"),
    });
    return stream;
  }

  const client = new Anthropic({ apiKey });
  const messages = transformMessages(context.messages, model);

  const params: MessageCreateParams = {
    model: model.id,
    max_tokens: options?.maxTokens ?? model.maxTokens,
    system: context.systemPrompt,
    messages: convertMessages(messages),
    tools: convertTools(context.tools),
  };

  if (options?.reasoning) {
    (params as any).thinking = { type: "enabled", budget_tokens: mapReasoningBudget(options.reasoning) };
  }

  (async () => {
    try {
      if (options?.onPayload) {
        const modified = await options.onPayload(params, model);
        if (modified !== undefined) Object.assign(params, modified);
      }

      // abort signal 透传：用户触发 abort 时真正中断 SDK 请求
      const sdkStream = client.messages.stream(
        params,
        options?.signal ? { signal: options.signal } : undefined,
      );

      let currentPartial = createEmptyPartial(model);
      let contentIndex = 0;
      // 🔧 累积流式内容，不再依赖 currentContent
      let accumulatedText = "";
      let accumulatedThinking = "";
      let accumulatedToolArgs = "";
      let currentToolId = "";
      let currentToolName = "";
      let currentToolIndex = -1;
      const completedToolCalls: ToolCall[] = [];

      stream.push({ type: "start", partial: { ...currentPartial } });

      for await (const event of sdkStream) {
        switch (event.type) {
          case "message_start":
            // 🔧 读取真实 input tokens
            currentPartial.usage.input = event.message.usage.input_tokens;
            break;

          case "content_block_start": {
            const block = event.content_block;
            if (block.type === "text") {
              accumulatedText = "";
              stream.push({ type: "text_start", contentIndex, partial: { ...currentPartial } });
            } else if (block.type === "thinking") {
              accumulatedThinking = "";
              stream.push({ type: "thinking_start", contentIndex, partial: { ...currentPartial } });
            } else if (block.type === "tool_use") {
              accumulatedToolArgs = "";
              currentToolId = block.id;
              currentToolName = block.name;
              currentToolIndex = contentIndex;
              stream.push({ type: "toolcall_start", contentIndex, partial: { ...currentPartial } });
            }
            break;
          }

          case "content_block_delta":
            if (event.delta.type === "text_delta") {
              accumulatedText += event.delta.text;
              stream.push({ type: "text_delta", contentIndex, delta: event.delta.text, partial: { ...currentPartial } });
            } else if (event.delta.type === "thinking_delta") {
              accumulatedThinking += event.delta.thinking;
              stream.push({ type: "thinking_delta", contentIndex, delta: event.delta.thinking, partial: { ...currentPartial } });
            } else if (event.delta.type === "input_json_delta") {
              accumulatedToolArgs += event.delta.partial_json;
              stream.push({ type: "toolcall_delta", contentIndex, delta: event.delta.partial_json, partial: { ...currentPartial } });
            }
            break;

          case "content_block_stop": {
            if (accumulatedText) {
              stream.push({ type: "text_end", contentIndex, content: accumulatedText, partial: { ...currentPartial } });
            }
            if (accumulatedThinking) {
              stream.push({ type: "thinking_end", contentIndex, content: accumulatedThinking, partial: { ...currentPartial } });
            }
            if (currentToolIndex >= 0) {
              let args: Record<string, any> = {};
              let parseError: string | undefined;
              try {
                args = JSON.parse(accumulatedToolArgs);
              } catch (err: unknown) {
                // 解析失败：保留原始内容供调用方诊断，arguments 留空以避免误用
                parseError = err instanceof Error ? err.message : String(err);
              }
              const tc: ToolCall = {
                type: "toolCall",
                id: currentToolId,
                name: currentToolName,
                arguments: args,
                rawArguments: accumulatedToolArgs,
                ...(parseError ? { parseError } : {}),
              };
              completedToolCalls.push(tc);
              stream.push({ type: "toolcall_end", contentIndex: currentToolIndex, toolCall: tc, partial: { ...currentPartial } });
            }
            contentIndex++;
            break;
          }

          case "message_delta":
            currentPartial.usage.output = event.usage.output_tokens;
            // 🔧 映射 stopReason
            currentPartial.stopReason = mapStopReason(event.delta.stop_reason);
            break;

          case "message_stop": {
            // 🔧 收集完整内容（用于 done 事件的 message.content）
            const finalMsg = await sdkStream.finalMessage();
            const content: AssistantMessage["content"] = [];
            for (const block of finalMsg.content ?? []) {
              if (block.type === "text") {
                content.push({ type: "text", text: block.text });
              } else if (block.type === "tool_use") {
                content.push({ type: "toolCall", id: block.id, name: block.name, arguments: block.input ?? {} });
              } else if (block.type === "thinking") {
                content.push({ type: "thinking", thinking: block.thinking });
              }
            }

            const inputCost = (model.cost.input / 1_000_000) * currentPartial.usage.input;
            const outputCost = (model.cost.output / 1_000_000) * currentPartial.usage.output;

            stream.push({
              type: "done",
              reason: currentPartial.stopReason as Exclude<StopReason, "error" | "aborted">,
              message: {
                role: "assistant",
                content,
                api: "anthropic-messages",
                provider: "anthropic",
                model: model.id,
                usage: {
                  input: currentPartial.usage.input,
                  output: currentPartial.usage.output,
                  totalTokens: currentPartial.usage.input + currentPartial.usage.output,
                  cost: { input: inputCost, output: outputCost, total: inputCost + outputCost },
                },
                stopReason: currentPartial.stopReason,
                timestamp: Date.now(),
              },
            });
            break;
          }
        }
      }
    } catch (error) {
      const norm = normalizeProviderError(error);
      const statusPart = norm.status ? ` [HTTP ${norm.status}]` : "";
      stream.push({
        type: "error",
        reason: "error",
        error: createErrorAssistantMessage(model, `Anthropic 请求失败${statusPart}: ${norm.message}`),
      });
    }
  })();

  return stream;
}

function createEmptyPartial(model: Model<"anthropic-messages">): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "anthropic-messages",
    provider: model.provider,
    model: model.id,
    usage: { input: 0, output: 0, totalTokens: 0, cost: { input: 0, output: 0, total: 0 } },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function mapStopReason(raw: string | null | undefined): StopReason {
  switch (raw) {
    case "end_turn": return "stop";
    case "max_tokens": return "length";
    case "tool_use": return "toolUse";
    default: return "stop";
  }
}
