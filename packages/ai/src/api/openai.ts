/**
 * OpenAI Chat Completions API 实现。
 * 将统一格式转换为 OpenAI SDK 格式，流式事件映射回我们的事件协议。
 *
 * 后续扩展：DeepSeek Provider 也在这个文件中（共用 OpenAI 兼容实现）。
 */

import OpenAI from "openai";
import type {
  ChatCompletionFunctionTool,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions/completions.js";
import type {
  AssistantMessage,
  Context,
  Model,
  StopReason,
  StreamOptions,
  TextContent,
  ThinkingContent,
  ToolCall,
} from "../types.js";
import type { Provider } from "../provider/index.js";
import { defaultComplete } from "../provider/index.js";
import { AssistantMessageEventStream } from "../stream/index.js";
import { envApiKey } from "../auth/index.js";
import { transformMessages } from "../utils/transform-messages.js";
import { normalizeProviderError } from "../utils/error-body.js";
import { createErrorAssistantMessage } from "../utils/assistant-message.js";

// ── 类型扩展 ──

/** OpenAI SDK 的 ChatCompletionCreateParams 不包含 OpenAI/DeepSeek 扩展字段，
 *  这里扩展为允许 reasoning_effort / thinking 等。 */
type ExtendedChatParams = OpenAI.Chat.Completions.ChatCompletionCreateParams & {
  reasoning_effort?: "low" | "medium" | "high";
  thinking?: { type: "enabled" };
};

/** 流式 chunk 的 delta 扩展：DeepSeek 的 reasoning_content 字段。 */
type StreamDelta = NonNullable<OpenAI.Chat.Completions.ChatCompletionChunk.Choice["delta"]> & {
  reasoning_content?: string;
};

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
    cost: { input: 2.5, output: 10.0 },
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
    cost: { input: 0.14, output: 0.28 },
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

/** OpenAI/DeepSeek 的 finish_reason 映射到统一的 StopReason。
 *  用于 done.reason 和 message.stopReason，保证两者一致。
 *  返回类型精确为 done 事件 reason 允许的子集（不含 error/aborted）。
 */
export function mapOpenAIFinishReason(
  raw: string | null | undefined,
): Exclude<StopReason, "error" | "aborted"> {
  if (raw === "tool_calls") return "toolUse";
  if (raw === "length") return "length";
  return "stop";
}

/** 将统一格式的消息转换为 OpenAI Chat Completions 格式 */
export function _convertMessages(messages: Context["messages"]): ChatCompletionMessageParam[] {
  const result: ChatCompletionMessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        result.push({ role: "user", content: msg.content });
      } else {
        // 多模态内容（文本 + 图片）
        const parts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = msg.content.map((c) => {
          if (c.type === "text") return { type: "text", text: c.text };
          if (c.type === "image") {
            return {
              type: "image_url",
              image_url: { url: `data:${c.mimeType};base64,${c.data}` },
            };
          }
          return { type: "text", text: "" };
        });
        result.push({ role: "user", content: parts });
      }
    } else if (msg.role === "assistant") {
      const textParts = msg.content.filter((c): c is TextContent => c.type === "text");
      const thinkingParts = msg.content.filter((c): c is ThinkingContent => c.type === "thinking");
      const toolCalls = msg.content.filter((c): c is ToolCall => c.type === "toolCall");

      const text = textParts.map((t) => t.text).join("");
      // DeepSeek 要求：有 thinking 内容时必须传回 reasoning_content
      const reasoningContent = thinkingParts.map((t) => t.thinking).join("");

      const messageObj: ChatCompletionMessageParam & { reasoning_content?: string } = {
        role: "assistant",
        content: text || null,
        ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
        ...(toolCalls.length > 0
          ? {
              tool_calls: toolCalls.map((tc) => ({
                id: tc.id,
                type: "function" as const,
                function: {
                  name: tc.name,
                  arguments: JSON.stringify(tc.arguments),
                },
              })),
            }
          : {}),
      };

      result.push(messageObj);
    } else if (msg.role === "toolResult") {
      // OpenAI: tool_result 使用独立的 role: "tool"
      const text = msg.content
        .filter((c): c is TextContent => c.type === "text")
        .map((c) => c.text)
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
      // structuredClone 返回 TSchema；OpenAI 期望 FunctionParameters（带索引签名的 record）。
      // TypeBox schema 在运行时是 JSON-Schema 兼容对象，这里做一次安全 cast。
      parameters: structuredClone(t.parameters) as ChatCompletionFunctionTool["function"]["parameters"],
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

    async complete(model, context, options) {
      return defaultComplete(this, model, context, options);
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
  const params: ExtendedChatParams = {
    model: model.id,
    max_tokens: options?.maxTokens ?? model.maxTokens,
    messages: _convertMessages(messages) as ChatCompletionMessageParam[],
    tools: convertTools(context.tools),
    stream: true,
    stream_options: { include_usage: true },
  };

  if (context.systemPrompt) {
    params.messages = [
      { role: "system", content: context.systemPrompt },
      ...params.messages,
    ];
  }

  if (options?.temperature !== undefined) {
    params.temperature = options.temperature;
  }

  // reasoning（思考）参数——根据 Provider 使用不同格式
  if (options?.reasoning) {
    if (config.reasoningFormat === "openai") {
      // OpenAI: reasoning_effort 参数
      params.reasoning_effort = typeof options.reasoning === "string" ? options.reasoning : "medium";
    } else if (config.reasoningFormat === "deepseek") {
      // DeepSeek: thinking: { type: "enabled" }
      params.thinking = { type: "enabled" };
    }
  }
  // 异步执行流式请求
  (async () => {
    try {
      // debug: 让上层检查/替换请求体
      if (options?.onPayload) {
        const modified = await options.onPayload(params, model);
        if (modified !== undefined) Object.assign(params, modified);
      }

      // abort signal 透传：用户触发 abort 时真正中断 SDK 请求
      const sdkOptions: { signal?: AbortSignal } = options?.signal ? { signal: options.signal } : {};
      const sdkStream = await client.chat.completions.create(params, sdkOptions);

      // TODO: onResponse 暂不实现 — OpenAI SDK 流不暴露原始 HTTP response

      // 初始 partial 消息（provider 用 model.provider，B1 修复：之前硬编码 "openai" 会让 DeepSeek 流的 partial 与 message 不一致）
      const initialPartial: AssistantMessage = {
        role: "assistant",
        content: [],
        api: "openai-completions",
        provider: model.provider,
        model: model.id,
        usage: { input: 0, output: 0, totalTokens: 0, cost: { input: 0, output: 0, total: 0 } },
        stopReason: "stop",
        timestamp: Date.now(),
      };

      stream.push({ type: "start", partial: { ...initialPartial } });

      // 跟踪当前正在构建的 content
      let textContent = "";
      let thinkingContent = "";
      // 动态分配 contentIndex：按出现顺序（text → thinking → tool call 0 → tool call 1 → ...）
      // 之前硬编码 `index + 2` 会导致无 text/think 时偏移错误。
      let nextBlockIndex = 0;
      let textBlockIndex = -1;
      let thinkingBlockIndex = -1;
      const toolBlockIndex: Map<number, number> = new Map();
      let currentToolCalls: Map<number, { id: string; name: string; arguments: string; contentIndex: number }> = new Map();
      let finishReason: string | null = null;
      let usageData: { input: number; output: number } = { input: 0, output: 0 };

      for await (const chunk of sdkStream) {
        // 处理 usage（OpenAI 在流末尾通过 stream_options.include_usage 返回）
        if (chunk.usage) {
          usageData.input = chunk.usage.prompt_tokens ?? 0;
          usageData.output = chunk.usage.completion_tokens ?? 0;
        }

        const delta = chunk.choices?.[0]?.delta as StreamDelta | undefined;
        if (!delta) continue;

        // 文本内容
        if (delta.content) {
          if (textBlockIndex === -1) {
            textBlockIndex = nextBlockIndex++;
          }
          textContent += delta.content;
          stream.push({ type: "text_delta", contentIndex: textBlockIndex, delta: delta.content, partial: { ...initialPartial } });
        }

        // 思考内容（OpenAI 的 reasoning_content / DeepSeek 的 thinking）
        if (delta.reasoning_content) {
          if (thinkingBlockIndex === -1) {
            thinkingBlockIndex = nextBlockIndex++;
          }
          thinkingContent += delta.reasoning_content;
          stream.push({ type: "thinking_delta", contentIndex: thinkingBlockIndex, delta: delta.reasoning_content, partial: { ...initialPartial } });
        }

        // 工具调用
        if (delta.tool_calls) {
          for (const tcDelta of delta.tool_calls) {
            const index = tcDelta.index;
            let contentIndex = toolBlockIndex.get(index);
            if (contentIndex === undefined) {
              contentIndex = nextBlockIndex++;
              toolBlockIndex.set(index, contentIndex);
              currentToolCalls.set(index, { id: tcDelta.id ?? "", name: "", arguments: "", contentIndex });
              stream.push({ type: "toolcall_start", contentIndex, partial: { ...initialPartial } });
            }

            const current = currentToolCalls.get(index)!;
            if (tcDelta.id) current.id = tcDelta.id;
            if (tcDelta.function?.name) {
              current.name += tcDelta.function.name;
            }
            if (tcDelta.function?.arguments) {
              current.arguments += tcDelta.function.arguments;
              stream.push({ type: "toolcall_delta", contentIndex, delta: tcDelta.function.arguments, partial: { ...initialPartial } });
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
        stream.push({ type: "text_end", contentIndex: textBlockIndex, content: textContent, partial: { ...initialPartial } });
      }

      // 结束思考块
      if (thinkingContent) {
        stream.push({ type: "thinking_end", contentIndex: thinkingBlockIndex, content: thinkingContent, partial: { ...initialPartial } });
      }

      // 收集完成的工具调用
      const completedToolCalls: ToolCall[] = [];
      for (const [, tc] of currentToolCalls) {
        let args: Record<string, any> = {};
        let parseError: string | undefined;
        try {
          args = JSON.parse(tc.arguments);
        } catch (err: unknown) {
          // 解析失败：保留原始内容供调用方诊断，arguments 留空以避免误用
          parseError = err instanceof Error ? err.message : String(err);
        }
        const toolCall: ToolCall = {
          type: "toolCall",
          id: tc.id,
          name: tc.name,
          arguments: args,
          rawArguments: tc.arguments,
          ...(parseError ? { parseError } : {}),
        };
        completedToolCalls.push(toolCall);
        stream.push({
          type: "toolcall_end",
          contentIndex: tc.contentIndex,
          toolCall,
          partial: { ...initialPartial },
        });
      }

      // 构建最终消息（保留完整 content）
      const finalMsg = buildAssistantMessage(model, finishReason, usageData, textContent, thinkingContent, completedToolCalls);
      const reason = mapOpenAIFinishReason(finishReason);
      stream.push({ type: "done", reason, message: finalMsg });
    } catch (error) {
      const norm = normalizeProviderError(error);
      const statusPart = norm.status ? ` [HTTP ${norm.status}]` : "";
      stream.push({
        type: "error",
        reason: "error",
        error: createErrorAssistantMessage(model, `OpenAI 请求失败${statusPart}: ${norm.message}`),
      });
    }
  })();

  return stream;
}

/** 构建最终的 AssistantMessage（包含流式过程中收集的完整内容） */
function buildAssistantMessage(
  model: Model<"openai-completions">,
  finishReason: string | null,
  usageData: { input: number; output: number },
  textContent: string,
  thinkingContent: string,
  toolCalls: ToolCall[],
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
    provider: model.provider,
    model: model.id,
    usage: {
      input: usageData.input,
      output: usageData.output,
      totalTokens: usageData.input + usageData.output,
      cost: {
        input: inputCost,
        output: outputCost,
        total: inputCost + outputCost,
      },
    },
    stopReason: mapOpenAIFinishReason(finishReason),
    timestamp: Date.now(),
  };
}
