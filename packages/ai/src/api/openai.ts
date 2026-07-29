/**
 * OpenAI Provider 实现。
 * 共用代码见 `./openai-compat-base.js`,本文件仅承载 OpenAI 特有配置。
 *
 * 任何新增 OpenAI 兼容 Provider(如 moonshot / qwen)请放在独立文件中继承
 * `BaseOpenAICompatProvider`,不要把代码塞回本文件。
 */

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
