/**
 * ModelRuntime —— 配置后的 pi-ai Models 集合，供 coding-agent 和 SDK 使用。
 *
 * 从 pi 项目 core/model-runtime.ts 抄来（V1 最小化）。
 * Pi 的 ModelRuntime 实现了 Models 接口，内部依赖：
 *   Credentials / ModelConfig / ModelsStore / ProviderComposer / AuthStorage
 * V1 简化：直接用 ModelRegistry 存 Provider，从环境变量读 API Key。
 */

import type {
  Api,
  AssistantMessage,
  AssistantMessageEventStream,
  Context,
  Model,
  Models,
  Provider,
  StreamOptions,
} from "@mimi/ai";
import { createModels } from "@mimi/ai";
import type { ModelRegistry } from "./model-registry.js";

/** 认证结果——Pi 从 @earendil-works/pi-ai 导入。V1 本地定义 */
interface AuthResult {
  auth: {
    /** API key */
    apiKey?: string;
    /** 请求头覆盖 */
    headers?: Record<string, string>;
    /** 可选的 base URL 覆盖 */
    baseUrl?: string;
  };
  /** 环境变量覆盖 */
  env?: Record<string, string>;
}

// ═══════════════════════════════════════════
// V1 简化类型（Pi 依赖子系统的类型在此简化为 V1 版本）
// ═══════════════════════════════════════════

/** Provider → API Key 映射 */
type AuthCheck = { type: "api_key" | "oauth"; source: string };

/** 运行时快照 */
interface ModelRuntimeSnapshot {
  /** 所有已注册模型 */
  all: readonly Model<Api>[];
  /** 可用模型（已配置认证的 provider 的模型） */
  available: readonly Model<Api>[];
  /** 已配置认证的 provider */
  configuredProviders: ReadonlySet<string>;
  /** 认证检查结果 */
  auth: ReadonlyMap<string, AuthCheck | undefined>;
}

/** getAuth 的重载参数 */
export interface ModelRuntimeAuthOverrides {
  /** 覆盖 API key */
  apiKey?: string;
  /** 覆盖环境变量 */
  env?: Record<string, string>;
}

/** Provider → 环境变量名 */
const PROVIDER_ENV_MAP: Record<string, string> = {
  anthropic: "MIMI_API_KEY_ANTHROPIC",
  openai: "MIMI_API_KEY_OPENAI",
  deepseek: "MIMI_API_KEY_DEEPSEEK",
};

// ═══════════════════════════════════════════
// ModelRuntime 类
// ═══════════════════════════════════════════

/**
 * 配置后的 pi-ai Models 集合，供 coding-agent 和 SDK 使用。
 * V1 实现 Models 接口，内部使用简单的 Provider map + 环境变量认证。
 */
export class ModelRuntime {
  /** 内部的 Models 集合——存储 provider 并做 stream/complete 调度 */
  private readonly models: Models;
  /** 模型注册表——补充 getModel/getModels 查找 */
  private readonly registry: ModelRegistry;
  /** 运行时快照 */
  private snapshot: ModelRuntimeSnapshot = {
    all: [],
    available: [],
    configuredProviders: new Set(),
    auth: new Map(),
  };

  /** 运行时 API key 覆盖 */
  private runtimeApiKeys = new Map<string, string>();

  constructor(registry: ModelRegistry) {
    this.registry = registry;
    this.models = createModels();
    this._rebuildSnapshot();
  }

  // 🔴 Pi: static create(options) —— 异步工厂。V1 用简单的 constructor + register
  // 🔴 Pi: configureRadiusProviders / providerIds / recomposeProvider / rebuildProviders —— 依赖 config/composer。V1 简化
  // 🔴 Pi: updateModelSnapshot —— V1 用 _rebuildSnapshot

  /** 从 registry 重建运行时快照 */
  private _rebuildSnapshot(): void {
    const all = this.registry.list();
    const configuredProviders = new Set<string>();
    const auth = new Map<string, AuthCheck | undefined>();

    for (const model of all) {
      const envVar = PROVIDER_ENV_MAP[model.provider];
      if (envVar && process.env[envVar]) {
        configuredProviders.add(model.provider);
        auth.set(model.provider, { type: "api_key", source: "environment" });
      }
      if (this.runtimeApiKeys.has(model.provider)) {
        configuredProviders.add(model.provider);
        auth.set(model.provider, { type: "api_key", source: "runtime" });
      }
    }

    this.snapshot = {
      all,
      available: all.filter((model) => configuredProviders.has(model.provider)),
      configuredProviders,
      auth,
    };
  }

  /** 注册 Provider——同时注册到内部 models 和 registry */
  set(provider: Provider): void {
    this.models.set(provider);
    this.registry.register(provider);
    this._rebuildSnapshot();
  }

  /** 移除 Provider */
  remove(id: string): void {
    this.models.remove(id);
    this._rebuildSnapshot();
  }

  // ═══════════════════════════════════════════
  // Provider 查询
  // ═══════════════════════════════════════════

  /** 获取所有已注册的 provider */
  getProviders(): readonly Provider[] {
    return (this.models as any).getProviders() ?? [];
  }

  /** 按 ID 获取单个 provider */
  getProvider(providerId: string): Provider | undefined {
    return (this.models as any).getProvider(providerId);
  }

  /** 获取模型列表，可按 provider 筛选——V1 从 registry 获取 */
  getModels(providerId?: string): readonly Model<Api>[] {
    if (providerId) return this.registry.findByProvider(providerId);
    return this.registry.list();
  }

  /** 按 provider + modelId 精确查找模型——V1 从 registry 获取 */
  getModel(providerId: string, modelId: string): Model<Api> | undefined {
    return this.registry.getModel(providerId, modelId);
  }

  // ═══════════════════════════════════════════
  // 认证
  // ═══════════════════════════════════════════

  /** 检查 provider 是否已配置认证 */
  async checkAuth(providerId: string): Promise<AuthCheck | undefined> {
    return this.snapshot.auth.get(providerId);
  }

  /** 获取可用模型列表，可按 provider 筛选 */
  async getAvailable(providerId?: string): Promise<readonly Model<Api>[]> {
    if (providerId) {
      return this.snapshot.available.filter((model) => model.provider === providerId);
    }
    return this.snapshot.available;
  }

  /** 同步获取当前可用模型快照 */
  getAvailableSnapshot(): readonly Model<Api>[] {
    return this.snapshot.available;
  }

  /** 获取错误信息——V1 始终返回 undefined（无 config 错误） */
  getError(): string | undefined {
    return undefined;
  }

  // 🔴 Pi: getCompatibilityRequestConfig —— V1 不做（无 provider composer）

  /** 是否使用 OAuth——V1 永远返回 false */
  isUsingOAuth(providerId: string): boolean {
    return this.snapshot.auth.get(providerId)?.type === "oauth";
  }

  /** provider 是否已配置认证 */
  hasConfiguredAuth(providerId: string): boolean {
    return this.snapshot.configuredProviders.has(providerId);
  }

  /** 获取认证信息 */
  async getAuth(providerId: string, overrides?: ModelRuntimeAuthOverrides): Promise<AuthResult | undefined>;
  async getAuth(model: Model<Api>, overrides?: ModelRuntimeAuthOverrides): Promise<AuthResult | undefined>;
  async getAuth(
    providerOrModel: string | Model<Api>,
    overrides: ModelRuntimeAuthOverrides = {},
  ): Promise<AuthResult | undefined> {
    if (typeof providerOrModel === "string") {
      // 按 provider ID 查询
      const envVar = PROVIDER_ENV_MAP[providerOrModel];
      const apiKey = overrides.apiKey ?? (envVar ? process.env[envVar] : undefined) ?? this.runtimeApiKeys.get(providerOrModel);
      if (!apiKey) return undefined;
      return { auth: { apiKey, headers: overrides.env ? { "x-custom-env": "1" } : undefined }, env: overrides.env };
    }

    // 按 model 查询
    const model = providerOrModel;
    const envVar = PROVIDER_ENV_MAP[model.provider];
    const apiKey = overrides.apiKey ?? (envVar ? process.env[envVar] : undefined) ?? this.runtimeApiKeys.get(model.provider);
    if (!apiKey) return undefined;
    return {
      auth: { apiKey, headers: undefined },
      env: overrides.env,
    };
  }

  /** 设置运行时 API key（覆盖环境变量） */
  async setRuntimeApiKey(providerId: string, apiKey: string): Promise<void> {
    this.runtimeApiKeys.set(providerId, apiKey);
    this._rebuildSnapshot();
  }

  /** 移除运行时 API key */
  async removeRuntimeApiKey(providerId: string): Promise<void> {
    this.runtimeApiKeys.delete(providerId);
    this._rebuildSnapshot();
  }

  // 🔴 Pi: listCredentials —— V1 不做（无 credential 存储）

  /** 获取 provider 的认证状态 */
  getProviderAuthStatus(providerId: string): { configured: boolean; source?: string } {
    if (this.runtimeApiKeys.has(providerId)) return { configured: true, source: "runtime" };
    const envVar = PROVIDER_ENV_MAP[providerId];
    if (envVar && process.env[envVar]) return { configured: true, source: "environment" };
    return { configured: false };
  }

  // ═══════════════════════════════════════════
  // 流式/非流式调用
  // ═══════════════════════════════════════════

  /** 解析请求：获取认证信息（V1 简化——不查 provider，直接走 models.stream） */
  private async _prepareRequest(
    model: Model<Api>,
    options: StreamOptions | undefined,
  ): Promise<{ model: Model<Api>; options: StreamOptions }> {
    const envVar = PROVIDER_ENV_MAP[model.provider];
    const apiKey = options?.apiKey ?? (envVar ? process.env[envVar] : undefined) ?? this.runtimeApiKeys.get(model.provider);
    return {
      model,
      options: { ...options, apiKey },
    };
  }

  /** 流式调用：自动根据 model.provider 分发到对应 Provider */
  stream(
    model: Model<Api>,
    context: Context,
    options?: StreamOptions,
  ): AssistantMessageEventStream {
    return this.models.stream(model, context, options);
  }

  /** 非流式调用：内部走 stream().result() */
  async complete(
    model: Model<Api>,
    context: Context,
    options?: StreamOptions,
  ): Promise<AssistantMessage> {
    return this.stream(model, context, options).result();
  }

  // 🔴 Pi: streamSimple / completeSimple —— 额外的辅助方法。V1 不需要

  // ═══════════════════════════════════════════
  // 配置刷新
  // ═══════════════════════════════════════════

  /** 刷新模型可用性——V1 为 no-op（静态注册） */
  async refresh(_options?: any): Promise<any> {
    this._rebuildSnapshot();
    return { aborted: false, errors: new Map() };
  }

  // 🔴 Pi: reloadConfig —— V1 不做（无 models.json）

  // ═══════════════════════════════════════════
  // 登录/登出 —— V1 桩
  // ═══════════════════════════════════════════

  // 🔴 Pi: login(providerId, type, interaction) —— V1 不做（无 OAuth）
  // 🔴 Pi: logout(providerId) —— V1 不做（无 credential 存储）

  // ═══════════════════════════════════════════
  // Provider 注册/注销 —— V1 桩
  // ═══════════════════════════════════════════

  // 🔴 Pi: registerProvider / registerNativeProvider / unregisterProvider —— V1 不做（无 extension + composer）
  // 🔴 Pi: getRegisteredProviderConfig / getRegisteredProviderIds / getRegisteredNativeProvider —— V1 不做
}
