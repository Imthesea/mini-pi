/**
 * OpenAI Provider 实现。
 * 共用代码见 `./openai-compat-base.js`,本文件承载 OpenAI 特有配置。
 *
 * 过渡状态:本文件还包含 DeepSeek 相关代码(`DEEPSEEK_MODELS` / `DeepSeekProvider` / `deepseekProvider()`),
 * Task 2 会把它们拆到独立 `./deepseek.js`。本文件最终会精简到只剩 OpenAI 部分(~30 行)。
 */

export {
  mapOpenAIFinishReason,
  _convertMessages,
  openAICompatibleStream,
  BaseOpenAICompatProvider,
  type OpenAICompatConfig,
} from "./openai-compat-base.js";

import type { Provider } from "../provider/index.js";
import type { Model } from "../types.js";
import { BaseOpenAICompatProvider, type OpenAICompatConfig } from "./openai-compat-base.js";

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

class OpenAIProvider extends BaseOpenAICompatProvider {
  constructor() {
    const config: OpenAICompatConfig = {
      id: "openai",
      name: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      envVar: "OPENAI_API_KEY",
      reasoningFormat: "openai",
      models: OPENAI_MODELS,
    };
    super(config);
  }
}

/**
 * 创建 OpenAI Provider 实例。
 */
export function openaiProvider(): Provider<"openai-completions"> {
  return new OpenAIProvider();
}

// ── DeepSeek 过渡代码 (Task 2 拆走) ──

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

class DeepSeekProvider extends BaseOpenAICompatProvider {
  constructor() {
    const config: OpenAICompatConfig = {
      id: "deepseek",
      name: "DeepSeek",
      baseUrl: "https://api.deepseek.com",
      envVar: "DEEPSEEK_API_KEY",
      reasoningFormat: "deepseek",
      models: DEEPSEEK_MODELS,
    };
    super(config);
  }
}

/**
 * 创建 DeepSeek Provider 实例(OpenAI 兼容接口)。
 */
export function deepseekProvider(): Provider<"openai-completions"> {
  return new DeepSeekProvider();
}
