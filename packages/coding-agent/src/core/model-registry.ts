/**
 * ModelRegistry —— 模型注册表。同步兼容 facade，供扩展使用。
 * coding-agent 内部使用 ModelRuntime。
 *
 * 从 pi 项目 core/model-registry.ts 抄来（V1 最小化）。
 * Pi 的 Registry 是 ModelRuntime 的 facade——所有方法委托给 this.runtime。
 * V1 简化：直接存储 Provider map，不依赖 Auth/Config/OAuth 子系统。
 */

import type { Model, Provider } from "@mimi/ai";

// ═══════════════════════════════════════════
// 类型
// ═══════════════════════════════════════════

/** 🔴 Pi: ResolvedRequestAuth / clearApiKeyCache —— V1 不做（无 OAuth） */

// ═══════════════════════════════════════════
// ModelRegistry 类
// ═══════════════════════════════════════════

/**
 * 同步兼容 facade，供扩展使用。
 * coding-agent 内部使用 ModelRuntime 直接操作。
 */
export class ModelRegistry {
  /** 已注册的 provider map */
  private providers = new Map<string, Provider>();

  // 🔴 Pi: constructor(runtime: ModelRuntime) —— V1 不依赖 ModelRuntime，独立管理
  // constructor(private readonly runtime: ModelRuntime) { }

  // 🔴 Pi: refresh() —— reload models.json。V1 不做（无 models.json）
  // 🔴 Pi: getError() —— V1 不做（无 config 错误）
  // 🔴 Pi: getAll() / getAvailable() —— V1 不做（无 availability 概念）

  /** 注册一个 Provider */
  register(provider: Provider): void {
    this.providers.set(provider.id, provider);
  }

  /** 按 provider + modelId 精确查找模型 */
  getModel(providerId: string, modelId: string): Model<any> | undefined {
    return this.providers.get(providerId)?.getModel(modelId);
  }

  /** 列出指定 provider 的所有模型 */
  findByProvider(providerId: string): Model<any>[] {
    const p = this.providers.get(providerId);
    return p ? [...p.getModels()] : [];
  }

  /** 列出所有已注册模型 */
  list(): Model<any>[] {
    const all: Model<any>[] = [];
    for (const p of this.providers.values()) {
      all.push(...p.getModels());
    }
    return all;
  }

  // 🔴 Pi: find() —— 委托 runtime.getModel()。V1 用 getModel()
  // 🔴 Pi: hasConfiguredAuth() —— V1 不做（无 auth 存储）
  // 🔴 Pi: getApiKeyAndHeaders() —— V1 不做（无 auth 存储）
  // 🔴 Pi: getProviderAuthStatus() / getProvider() / getProviderDisplayName() —— V1 不做
  // 🔴 Pi: getProviderAuth() / getApiKeyForProvider() —— V1 不做（无 auth 存储）
  // 🔴 Pi: isUsingOAuth() —— V1 不做（无 OAuth）
  // 🔴 Pi: registerProvider() / unregisterProvider() —— 复杂的 provider 注册/注销。V1 用简单的 register()
  // 🔴 Pi: getRegisteredProviderConfig() / getRegisteredNativeProvider() / getRegisteredProviderIds() —— V1 不做
}
