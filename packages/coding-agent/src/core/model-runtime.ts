/**
 * ModelRuntime —— 模型运行时。
 *
 * 对齐 pi 项目。提供模型查找 + API key 解析。
 */

import type { Model } from "@mimi/ai";
import type { ModelRegistry } from "./model-registry.js";

const PROVIDER_ENV_MAP: Record<string, string> = {
  anthropic: "MIMI_API_KEY_ANTHROPIC",
  openai: "MIMI_API_KEY_OPENAI",
  deepseek: "MIMI_API_KEY_DEEPSEEK",
};

export class ModelRuntime {
  private registry: ModelRegistry;

  constructor(registry: ModelRegistry) {
    this.registry = registry;
  }

  /** 遍历所有 provider 按 ID 查找模型 */
  getModel(id: string): Model<any> | undefined {
    for (const model of this.registry.list()) {
      if (model.id === id) return model;
    }
    return undefined;
  }

  /** 按名称/ID 解析模型 */
  resolveModel(input: string): Model<any> | undefined {
    return this.getModel(input);
  }

  /** 从环境变量获取 API key */
  async getAuth(model: Model<any>): Promise<{ apiKey: string }> {
    const envVar = PROVIDER_ENV_MAP[model.provider];
    if (envVar) {
      const key = process.env[envVar];
      if (key) return { apiKey: key };
    }
    throw new Error(
      `No API key found for provider '${model.provider}'. ` +
        `Set ${envVar ?? "appropriate env var"}.`,
    );
  }

  /** V1: OAuth 不支持 */
  isUsingOAuth(_provider: string): boolean {
    return false;
  }
}
