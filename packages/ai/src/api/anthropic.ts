/**
 * Anthropic Messages API 实现（Mock）。
 *
 * 当前为 mock 实现，用于在没有 API Key 时验证框架流程。
 * 后续拿到 ANTHROPIC_API_KEY 后替换为真实实现。
 */

import type {
  AssistantMessage,
  Context,
  Model,
  StreamOptions,
} from "../types.js";
import type { Provider } from "../provider/index.js";
import { AssistantMessageEventStream } from "../stream/index.js";
import { envApiKey } from "../auth/index.js";

// ── 模型列表 ──

/** Anthropic 模型列表 */
const ANTHROPIC_MODELS: Record<string, Model<"anthropic-messages">> = {
  "claude-sonnet-4-20250514": {
    id: "claude-sonnet-4-20250514",
    name: "Claude Sonnet 4",
    api: "anthropic-messages",
    provider: "anthropic",
    baseUrl: "https://api.anthropic.com",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 3.0, output: 15.0, cacheRead: 0.30, cacheWrite: 3.75 },
    contextWindow: 200000,
    maxTokens: 8192,
  },
};

/**
 * 创建 Anthropic Provider 实例（当前为 mock 实现）。
 * 后续替换为真实的 Anthropic Messages API 流式调用。
 */
export function anthropicProvider(): Provider<"anthropic-messages"> {
  return {
    id: "anthropic",
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com",

    getApiKey: () => envApiKey("ANTHROPIC_API_KEY"),

    getModels: () => Object.values(ANTHROPIC_MODELS) as Model<"anthropic-messages">[],
    getModel: (id: string) => ANTHROPIC_MODELS[id],

    stream(model: Model<"anthropic-messages">, context: Context, options?: StreamOptions): AssistantMessageEventStream {
      const stream = new AssistantMessageEventStream();
      const apiKey = options?.apiKey ?? envApiKey("ANTHROPIC_API_KEY");

      if (!apiKey) {
        stream.push({
          type: "error",
          reason: "error",
          error: createErrorAssistantMessage(model, 'Provider "anthropic" 未配置。请设置 ANTHROPIC_API_KEY 环境变量。'),
        });
        return stream;
      }

      // mock: 模拟流式返回
      const mockText = `[Anthropic Mock] 你好！这是 mock 响应。模型: ${model.name}，消息数: ${context.messages.length}。`;

      stream.push({
        type: "start",
        partial: createEmptyPartial(model),
      });

      // 模拟流式输出
      let index = 0;
      const interval = setInterval(() => {
        if (index < mockText.length) {
          const chunk = mockText.slice(index, index + 3);
          index += 3;
          stream.push({
            type: "text_delta",
            contentIndex: 0,
            delta: chunk,
            partial: createEmptyPartial(model),
          });
        } else {
          clearInterval(interval);
          stream.push({
            type: "done",
            reason: "stop",
            message: {
              role: "assistant",
              content: [{ type: "text", text: mockText }],
              api: "anthropic-messages",
              provider: "anthropic",
              model: model.id,
              usage: { input: 10, output: mockText.length, cacheRead: 0, cacheWrite: 0, totalTokens: 10 + mockText.length, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
              stopReason: "stop",
              timestamp: Date.now(),
            },
          });
        }
      }, 50);

      return stream;
    },

    async complete(model: Model<"anthropic-messages">, context: Context, options?: StreamOptions) {
      return this.stream(model, context, options).result();
    },
  };
}

function createEmptyPartial(model: Model<"anthropic-messages">): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "anthropic-messages",
    provider: "anthropic",
    model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function createErrorAssistantMessage(model: Model<any>, errorMessage: string): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "error",
    errorMessage,
    timestamp: Date.now(),
  };
}
