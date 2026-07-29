/**
 * Provider 接口与 Models 集合。
 * 这是 AI 层的核心框架——管理多个 AI 提供商，分发流式请求。
 *
 * 目录结构为可扩展设计：
 * - Provider 接口：后续可增加 refreshModels、filterModels 等方法
 * - Models 集合：后续可增加 checkAuth、getAvailable 等方法
 * - ModelsImpl：私有实现，不暴露到公共 API
 */

import type {
  Api,
  AssistantMessage,
  Context,
  Model,
  StreamOptions,
} from "../types.js";
import type { AssistantMessageEventStream } from "../stream/index.js";

// ── 错误类 ──

/** Models 操作错误 */
export class ModelsError extends Error {
  code: "auth" | "provider" | "stream";

  constructor(code: "auth" | "provider" | "stream", message: string) {
    super(message);
    this.name = "ModelsError";
    this.code = code;
  }
}

// ── Provider 接口 ──

/**
 * Provider 接口：描述一个 AI 提供商的完整能力。
 * 包括模型列表、API Key 获取、流式调用。
 * 每个 API 实现模块（api/anthropic.ts, api/openai.ts）返回符合此接口的对象。
 */
export interface Provider<TApi extends Api = Api> {
  readonly id: string;
  readonly name: string;
  readonly baseUrl?: string;

  /** 从环境变量读取 API Key，未配置时返回 undefined */
  getApiKey(): string | undefined;

  /** 返回该 Provider 的所有模型（静态列表） */
  getModels(): readonly Model<TApi>[];
  /** 按 ID 查找单个模型 */
  getModel(id: string): Model<TApi> | undefined;

  /** 流式调用模型 */
  stream(model: Model<TApi>, context: Context, options?: StreamOptions): AssistantMessageEventStream;
  /** 非流式调用（收集流的结果） */
  complete(model: Model<TApi>, context: Context, options?: StreamOptions): Promise<AssistantMessage>;
}

// ── Models 接口 ──

/**
 * Models 集合：管理多个 Provider，负责分发请求。
 * 上层（agent 层）通过此接口使用 AI 能力，不需要知道具体 Provider 的存在。
 */
export interface Models {
  /** 注册 Provider（有同 ID 的会替换） */
  set(provider: Provider): void;
  /** 移除 Provider */
  remove(id: string): void;

  /** 列出所有已注册的 Provider */
  list(): readonly Provider[];
  /** 按 ID 查找 Provider */
  get(id: string): Provider | undefined;

  /** 获取所有/某个 Provider 的模型列表 */
  getModels(providerId?: string): readonly Model<Api>[];
  /** 精确查找模型 */
  getModel(provider: string, modelId: string): Model<Api> | undefined;

  /** 流式调用：自动根据 model.provider 分发到对应 Provider */
  stream(model: Model<Api>, context: Context, options?: StreamOptions): AssistantMessageEventStream;
  /** 非流式调用 */
  complete(model: Model<Api>, context: Context, options?: StreamOptions): Promise<AssistantMessage>;
}

// ── 实现 ──

/**
 * Models 接口的具体实现。
 * 内部用一个 Map<string, Provider> 管理 Provider 注册表。
 */
class ModelsImpl implements Models {
  private providers = new Map<string, Provider>();

  set(provider: Provider): void {
    this.providers.set(provider.id, provider);
  }

  remove(id: string): void {
    this.providers.delete(id);
  }

  list(): readonly Provider[] {
    return Array.from(this.providers.values());
  }

  get(id: string): Provider | undefined {
    return this.providers.get(id);
  }

  getModels(providerId?: string): readonly Model<Api>[] {
    if (providerId !== undefined) {
      const entry = this.providers.get(providerId);
      if (!entry) return [];
      try {
        return entry.getModels() as Model<Api>[];
      } catch {
        return [];
      }
    }
    const models: Model<Api>[] = [];
    for (const entry of this.providers.values()) {
      try {
        models.push(...(entry.getModels() as Model<Api>[]));
      } catch {
        // 异常 Provider 跳过，不影响其他 Provider
      }
    }
    return models;
  }

  getModel(provider: string, modelId: string): Model<Api> | undefined {
    return (this.getModels(provider) as Model<Api>[]).find((m) => m.id === modelId);
  }

  stream(model: Model<Api>, context: Context, options?: StreamOptions): AssistantMessageEventStream {
    const provider = this.providers.get(model.provider);
    if (!provider) {
      throw new ModelsError("provider", `未知的 Provider: ${model.provider}。请先调用 models.set() 注册。`);
    }

    const apiKey = options?.apiKey ?? provider.getApiKey();
    if (!apiKey) {
      throw new ModelsError(
        "auth",
        `Provider "${model.provider}" 未配置。请在 packages/ai/.env 文件中设置对应的 API Key，或通过 StreamOptions.apiKey 手动传入。`,
      );
    }

    return provider.stream(model, context, { ...options, apiKey });
  }

  async complete(model: Model<Api>, context: Context, options?: StreamOptions): Promise<AssistantMessage> {
    return this.stream(model, context, options).result();
  }
}

/**
 * 创建 Models 集合实例。
 * 这是 AI 层的主入口——上层代码通过此函数获取 Models，
 * 然后注册 Provider、发起调用。
 */
export function createModels(): Models {
  return new ModelsImpl();
}
