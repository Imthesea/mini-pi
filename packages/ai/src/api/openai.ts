/**
 * OpenAI Chat Completions API 实现。
 * 将统一格式转换为 OpenAI SDK 格式，流式事件映射回我们的事件协议。
 *
 * 后续扩展：DeepSeek Provider 也在这个文件中（共用 OpenAI 兼容实现）。
 */

import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions/completions.js";
import type {
  AssistantMessage,
  Context,
  Model,
  StreamOptions,
} from "../types.js";
import type { Provider } from "../provider/index.js";
import { AssistantMessageEventStream } from "../stream/index.js";
import { envApiKey } from "../auth/index.js";
import { contentText } from "../utils/text.js";
import { transformMessages } from "./transform-messages.js";

// ── 模型列表 ──

/** OpenAI 模型列表 */
const OPENAI_MODELS: Record<string, Model<"openai-completions">> = {
  "gpt-5.5": {
    id: "gpt-5.5",
    name: "GPT-5.5",
    api: "openai-completions",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 2.5, output: 10.0, cacheRead: 1.25, cacheWrite: 2.5 },
    contextWindow: 128000,
    maxTokens: 16384,
  },
};

/** DeepSeek 模型列表 */
const DEEPSEEK_MODELS: Record<string, Model<"openai-completions">> = {
  "deepseek-v4-flash": {
    id: "deepseek-v4-flash",
    name: "DeepSeek-V4-Flash",
    api: "openai-completions",
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com",
    reasoning: false,
    input: ["text"],
    cost: { input: 0.14, output: 0.28, cacheRead: 0.014, cacheWrite: 0.14 },
    contextWindow: 128000,
    maxTokens: 8192,
  },
};

/** OpenAI 兼容 Provider 的配置 */
interface OpenAICompatibleConfig {
  id: string;
  name: string;
  baseUrl: string;
  envVar: string;
  /** reasoning 参数格式："openai" 用 reasoning_effort，"deepseek" 用 thinking.type */
  reasoningFormat: "openai" | "deepseek";
  models: Record<string, Model<"openai-completions">>;
}

// ── 消息转换 ──

/** 将统一格式的消息转换为 OpenAI Chat Completions 格式 */
function convertMessages(messages: Context["messages"]): ChatCompletionMessageParam[] {
  const result: ChatCompletionMessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        result.push({ role: "user", content: msg.content });
      } else {
        // 多模态内容（文本 + 图片）
        const parts = msg.content.map((c) => {
          if (c.type === "text") return { type: "text" as const, text: c.text };
          if (c.type === "image") {
            return {
              type: "image_url" as const,
              image_url: { url: `data:${c.mimeType};base64,${c.data}` },
            };
          }
          return { type: "text" as const, text: "" };
        });
        result.push({ role: "user", content: parts as any });
      }
    } else if (msg.role === "assistant") {
      const textParts = msg.content.filter((c) => c.type === "text");
      const thinkingParts = msg.content.filter((c) => c.type === "thinking");
      const toolCalls = msg.content.filter((c) => c.type === "toolCall");

      const text = textParts.map((t) => (t as any).text).join("");
      // DeepSeek 要求：有 thinking 内容时必须传回 reasoning_content
      const reasoningContent = thinkingParts.map((t) => (t as any).thinking).join("");

      const messageObj: any = {
        role: "assistant",
        content: text || null,
        ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
        ...(toolCalls.length > 0
          ? {
              tool_calls: toolCalls.map((tc) => {
                const t = tc as any;
                return {
                  id: t.id,
                  type: "function" as const,
                  function: {
                    name: t.name,
                    arguments: JSON.stringify(t.arguments),
                  },
                };
              }),
            }
          : {}),
      };

      result.push(messageObj);
    } else if (msg.role === "toolResult") {
      // OpenAI: tool_result 使用独立的 role: "tool"
      const text = msg.content
        .filter((c) => c.type === "text")
        .map((c) => (c as any).text)
        .join("");
      result.push({
        role: "tool",
        tool_call_id: msg.toolCallId,
        content: text,
      });
    }
  }

  return result;
}

/** 将 TypeBox Tool 转换为 OpenAI 格式 */
function convertTools(tools: Context["tools"]): ChatCompletionTool[] {
  if (!tools) return [];
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: JSON.parse(JSON.stringify(t.parameters)),
    },
  }));
}

// ── Provider 工厂 ──

/**
 * 创建 OpenAI Provider 实例。
 */
export function openaiProvider(): Provider<"openai-completions"> {
  return createOpenAICompatibleProvider({
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    envVar: "OPENAI_API_KEY",
    reasoningFormat: "openai",
    models: OPENAI_MODELS,
  });
}

/**
 * 创建 DeepSeek Provider 实例（OpenAI 兼容接口）。
 */
export function deepseekProvider(): Provider<"openai-completions"> {
  return createOpenAICompatibleProvider({
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    envVar: "DEEPSEEK_API_KEY",
    reasoningFormat: "deepseek",
    models: DEEPSEEK_MODELS,
  });
}

/**
 * 创建 OpenAI 兼容的 Provider。
 * 所有 OpenAI Chat Completions 兼容接口的 Provider 都可以复用此工厂。
 */
function createOpenAICompatibleProvider(config: OpenAICompatibleConfig): Provider<"openai-completions"> {
  return {
    id: config.id,
    name: config.name,
    baseUrl: config.baseUrl,

    getApiKey: () => envApiKey(config.envVar),

    getModels: () => Object.values(config.models) as Model<"openai-completions">[],
    getModel: (id: string) => config.models[id],

    stream(model: Model<"openai-completions">, context: Context, options?: StreamOptions) {
      return openAICompatibleStream(config, model, context, options);
    },

    async complete(model: Model<"openai-completions">, context: Context, options?: StreamOptions) {
      return this.stream(model, context, options).result();
    },
  };
}

// ── 流式实现 ──

/** OpenAI 兼容 Provider 流式调用的核心实现 */
function openAICompatibleStream(
  config: OpenAICompatibleConfig,
  model: Model<"openai-completions">,
  context: Context,
  options?: StreamOptions,
): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();
  const apiKey = options?.apiKey ?? envApiKey(config.envVar);

  if (!apiKey) {
    stream.push({
      type: "error",
      reason: "error",
      error: createErrorAssistantMessage(model, `Provider "${config.name}" 未配置。请设置 ${config.envVar} 环境变量。`),
    });
    return stream;
  }

  const client = new OpenAI({ apiKey, baseURL: config.baseUrl });

  // 规范化消息
  const messages = transformMessages(context.messages, model);

  // 构建请求参数
  const params: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
    model: model.id,
    max_tokens: options?.maxTokens ?? model.maxTokens,
    messages: convertMessages(messages) as any,
    tools: convertTools(context.tools),
    stream: true,
    stream_options: { include_usage: true },
  };

  if (context.systemPrompt) {
    (params as any).messages = [
      { role: "system", content: context.systemPrompt },
      ...(params.messages as any),
    ];
  }

  if (options?.temperature !== undefined) {
    params.temperature = options.temperature;
  }

  // reasoning（思考）参数——根据 Provider 使用不同格式
  if (options?.reasoning) {
    if (config.reasoningFormat === "openai") {
      // OpenAI: reasoning_effort 参数
      (params as any).reasoning_effort = typeof options.reasoning === "string" ? options.reasoning : "medium";
    } else if (config.reasoningFormat === "deepseek") {
      // DeepSeek: thinking: { type: "enabled" }
      (params as any).thinking = { type: "enabled" };
    }
  }

  // 异步执行流式请求
  (async () => {
    try {
      // debug: 让上层检查请求体
      if (options?.onPayload) {
        await options.onPayload(params, model);
      }

      const sdkStream = await client.chat.completions.create(params);

      // debug: 响应信息（OpenAI SDK 的流不直接暴露 HTTP response，这里给基本信息）
      if (options?.onResponse) {
        await options.onResponse({ status: 200, headers: {} }, model);
      }

      // 初始 partial 消息
      const initialPartial: AssistantMessage = {
        role: "assistant",
        content: [],
        api: "openai-completions",
        provider: "openai",
        model: model.id,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "stop",
        timestamp: Date.now(),
      };

      stream.push({ type: "start", partial: { ...initialPartial } });

      // 跟踪当前正在构建的 content
      let textContent = "";
      let thinkingContent = "";
      let currentToolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();
      let finishReason: string | null = null;
      let usageData: { input: number; output: number } = { input: 0, output: 0 };

      for await (const chunk of sdkStream) {
        // 处理 usage（OpenAI 在流末尾通过 stream_options.include_usage 返回）
        if (chunk.usage) {
          usageData.input = chunk.usage.prompt_tokens ?? 0;
          usageData.output = chunk.usage.completion_tokens ?? 0;
        }

        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        // 文本内容
        if (delta.content) {
          textContent += delta.content;
          stream.push({ type: "text_delta", contentIndex: 0, delta: delta.content, partial: { ...initialPartial } });
        }

        // 思考内容（OpenAI 的 reasoning_content / DeepSeek 的 thinking）
        if ((delta as any).reasoning_content) {
          thinkingContent += (delta as any).reasoning_content;
          stream.push({ type: "thinking_delta", contentIndex: 0, delta: (delta as any).reasoning_content, partial: { ...initialPartial } });
        }

        // 工具调用
        if (delta.tool_calls) {
          for (const tcDelta of delta.tool_calls) {
            const index = tcDelta.index;
            if (!currentToolCalls.has(index)) {
              currentToolCalls.set(index, { id: tcDelta.id ?? "", name: "", arguments: "" });
              stream.push({ type: "toolcall_start", contentIndex: index + 2, partial: { ...initialPartial } });
            }

            const current = currentToolCalls.get(index)!;
            if (tcDelta.id) current.id = tcDelta.id;
            if (tcDelta.function?.name) {
              current.name += tcDelta.function.name;
            }
            if (tcDelta.function?.arguments) {
              current.arguments += tcDelta.function.arguments;
              stream.push({ type: "toolcall_delta", contentIndex: index + 2, delta: tcDelta.function.arguments, partial: { ...initialPartial } });
            }
          }
        }

        // 完成原因
        if (chunk.choices?.[0]?.finish_reason) {
          finishReason = chunk.choices[0].finish_reason;
        }
      }

      // 结束文本块
      if (textContent) {
        stream.push({ type: "text_end", contentIndex: 0, content: textContent, partial: { ...initialPartial } });
      }

      // 结束思考块
      if (thinkingContent) {
        stream.push({ type: "thinking_end", contentIndex: 0, content: thinkingContent, partial: { ...initialPartial } });
      }

      // 收集完成的工具调用
      const completedToolCalls: Array<{ type: "toolCall"; id: string; name: string; arguments: Record<string, any> }> = [];
      for (const [index, tc] of currentToolCalls) {
        let args = {};
        try {
          args = JSON.parse(tc.arguments);
        } catch {
          args = {};
        }
        completedToolCalls.push({ type: "toolCall", id: tc.id, name: tc.name, arguments: args });
        stream.push({
          type: "toolcall_end",
          contentIndex: index,
          toolCall: { type: "toolCall", id: tc.id, name: tc.name, arguments: args },
          partial: { ...initialPartial },
        });
      }

      // 构建最终消息（保留完整 content）
      const finalMsg = buildAssistantMessage(model, config.id, finishReason, usageData, textContent, thinkingContent, completedToolCalls);
      stream.push({ type: "done", reason: finishReason === "tool_calls" ? "toolUse" : "stop", message: finalMsg });
    } catch (error: any) {
      stream.push({
        type: "error",
        reason: "error",
        error: createErrorAssistantMessage(model, `OpenAI 请求失败: ${error.message ?? error}`),
      });
    }
  })();

  return stream;
}

/** 构建最终的 AssistantMessage（包含流式过程中收集的完整内容） */
function buildAssistantMessage(
  model: Model<"openai-completions">,
  providerId: string,
  finishReason: string | null,
  usageData: { input: number; output: number },
  textContent: string,
  thinkingContent: string,
  toolCalls: Array<{ type: "toolCall"; id: string; name: string; arguments: Record<string, any> }>,
): AssistantMessage {
  const inputCost = (model.cost.input / 1_000_000) * usageData.input;
  const outputCost = (model.cost.output / 1_000_000) * usageData.output;

  const content: AssistantMessage["content"] = [];
  if (thinkingContent) {
    content.push({ type: "thinking", thinking: thinkingContent });
  }
  if (textContent) {
    content.push({ type: "text", text: textContent });
  }
  content.push(...toolCalls);

  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: providerId,
    model: model.id,
    usage: {
      input: usageData.input,
      output: usageData.output,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: usageData.input + usageData.output,
      cost: {
        input: inputCost,
        output: outputCost,
        cacheRead: 0,
        cacheWrite: 0,
        total: inputCost + outputCost,
      },
    },
    stopReason: finishReason === "tool_calls" ? "toolUse" : "stop",
    timestamp: Date.now(),
  };
}

/** 创建错误 AssistantMessage */
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
