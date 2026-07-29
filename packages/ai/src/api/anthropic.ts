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
  Tool,
} from "@anthropic-ai/sdk/resources/messages.mjs";
import type {
  AssistantMessage,
  Context,
  Model,
  StreamOptions,
} from "../types.js";
import type { Provider } from "../provider/index.js";
import { defaultComplete } from "../provider/index.js";
import { AssistantMessageEventStream } from "../stream/index.js";
import { envApiKey } from "../auth/index.js";
import { transformMessages } from "../utils/transform-messages.js";

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
              source: { type: "base64" as const, media_type: c.mimeType as any, data: c.data },
            } as unknown as ContentBlock;
          }
          return { type: "text" as const, text: "" } as ContentBlock;
        });
        result.push({ role: "user", content: blocks });
      }
    } else if (msg.role === "assistant") {
      result.push({
        role: "assistant",
        content: msg.content.map((c) => {
          if (c.type === "text") return { type: "text" as const, text: c.text };
          if (c.type === "thinking") return { type: "text" as const, text: c.thinking };
          if (c.type === "toolCall") {
            return {
              type: "tool_use" as const,
              id: c.id,
              name: c.name,
              input: c.arguments,
            };
          }
          return { type: "text" as const, text: "" };
        }),
      });
    } else if (msg.role === "toolResult") {
      result.push({
        role: "user",
        content: [{
          type: "tool_result" as const,
          tool_use_id: msg.toolCallId,
          content: msg.content.filter((c) => c.type === "text").map((c) => (c as any).text).join(""),
          is_error: msg.isError,
        }],
      });
    }
  }

  return result;
}

function convertTools(tools: Context["tools"]): Tool[] {
  if (!tools) return [];
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: JSON.parse(JSON.stringify(t.parameters)),
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
    (params as any).thinking = { type: "enabled", budget_tokens: 16000 };
  }

  (async () => {
    try {
      if (options?.onPayload) {
        const modified = await options.onPayload(params, model);
        if (modified !== undefined) Object.assign(params, modified);
      }

      const sdkStream = client.messages.stream(params);

      // TODO: onResponse 暂不实现 — Anthropic SDK 流不直接暴露原始 HTTP response

      const initialPartial: AssistantMessage = {
        role: "assistant",
        content: [],
        api: "anthropic-messages",
        provider: "anthropic",
        model: model.id,
        usage: { input: 0, output: 0, totalTokens: 0, cost: { input: 0, output: 0, total: 0 } },
        stopReason: "stop",
        timestamp: Date.now(),
      };

      stream.push({ type: "start", partial: { ...initialPartial } });

      let contentIndex = 0;
      let currentContent: any = null;

      for await (const event of sdkStream) {
        switch (event.type) {
          case "message_start":
            break;

          case "content_block_start":
            currentContent = event.content_block;
            if (event.content_block.type === "text") {
              stream.push({ type: "text_start", contentIndex, partial: { ...initialPartial } });
            } else if (event.content_block.type === "thinking") {
              stream.push({ type: "thinking_start", contentIndex, partial: { ...initialPartial } });
            } else if (event.content_block.type === "tool_use") {
              stream.push({ type: "toolcall_start", contentIndex, partial: { ...initialPartial } });
            }
            break;

          case "content_block_delta":
            if (event.delta.type === "text_delta") {
              stream.push({ type: "text_delta", contentIndex, delta: event.delta.text, partial: { ...initialPartial } });
            } else if (event.delta.type === "thinking_delta") {
              stream.push({ type: "thinking_delta", contentIndex, delta: event.delta.thinking, partial: { ...initialPartial } });
            } else if (event.delta.type === "input_json_delta") {
              stream.push({ type: "toolcall_delta", contentIndex, delta: event.delta.partial_json, partial: { ...initialPartial } });
            }
            break;

          case "content_block_stop":
            if (currentContent?.type === "text") {
              stream.push({ type: "text_end", contentIndex, content: currentContent.text ?? "", partial: { ...initialPartial } });
            } else if (currentContent?.type === "thinking") {
              stream.push({ type: "thinking_end", contentIndex, content: currentContent.thinking ?? "", partial: { ...initialPartial } });
            } else if (currentContent?.type === "tool_use") {
              stream.push({
                type: "toolcall_end",
                contentIndex,
                toolCall: { type: "toolCall", id: currentContent.id, name: currentContent.name, arguments: currentContent.input ?? {} },
                partial: { ...initialPartial },
              });
            }
            contentIndex++;
            currentContent = null;
            break;

          case "message_delta":
            initialPartial.usage.output = event.usage.output_tokens;
            break;

          case "message_stop": {
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

            const inputCost = (model.cost.input / 1_000_000) * initialPartial.usage.input;
            const outputCost = (model.cost.output / 1_000_000) * initialPartial.usage.output;

            stream.push({
              type: "done",
              reason: "stop",
              message: {
                role: "assistant",
                content,
                api: "anthropic-messages",
                provider: "anthropic",
                model: model.id,
                usage: {
                  input: initialPartial.usage.input,
                  output: initialPartial.usage.output,
                  totalTokens: initialPartial.usage.input + initialPartial.usage.output,
                  cost: { input: inputCost, output: outputCost, total: inputCost + outputCost },
                },
                stopReason: "stop",
                timestamp: Date.now(),
              },
            });
            break;
          }

          // Anthropic SDK 将错误作为异常抛出，不走这里
        }
      }
    } catch (error: any) {
      stream.push({
        type: "error",
        reason: "error",
        error: createErrorAssistantMessage(model, `Anthropic 请求失败: ${error.message ?? error}`),
      });
    }
  })();

  return stream;
}

function createErrorAssistantMessage(model: Model<any>, errorMessage: string): AssistantMessage {
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
