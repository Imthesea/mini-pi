/**
 * DeepSeek Provider 实现(OpenAI 兼容接口)。
 * 共用代码见 `./openai-compat-base.js`,本文件仅承载 DeepSeek 特有配置。
 *
 * 与 OpenAI 的差异:
 * - baseUrl: https://api.deepseek.com
 * - envVar: DEEPSEEK_API_KEY
 * - reasoning 格式: thinking.type = "enabled" (非 reasoning_effort)
 */

import type { Provider } from "../provider/index.js";
import type { Model } from "../types.js";
import { BaseOpenAICompatProvider, type OpenAICompatConfig } from "./openai-compat-base.js";

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
