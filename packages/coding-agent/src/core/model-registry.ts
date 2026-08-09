/**
 * ModelRegistry —— 模型注册表。
 *
 * 对齐 pi 项目。管理所有 Provider，提供模型查询。
 */

import type { Model, Provider } from "@mimi/ai";

export class ModelRegistry {
  private providers = new Map<string, Provider>();

  register(provider: Provider): void {
    this.providers.set(provider.id, provider);
  }

  getModel(providerId: string, modelId: string): Model<any> | undefined {
    return this.providers.get(providerId)?.getModel(modelId);
  }

  findByProvider(providerId: string): Model<any>[] {
    const p = this.providers.get(providerId);
    return p ? [...p.getModels()] : [];
  }

  list(): Model<any>[] {
    const all: Model<any>[] = [];
    for (const p of this.providers.values()) {
      all.push(...p.getModels());
    }
    return all;
  }
}
