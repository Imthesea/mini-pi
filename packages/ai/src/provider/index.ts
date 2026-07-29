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
import { AssistantMessageEventStream as EventStreamClass } from "../stream/index.js";
import { isRetryableAssistantError } from "../utils/retry.js";
import { createErrorAssistantMessage } from "../utils/assistant-message.js";

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
  /** 非流式调用：默认实现 = stream().result()，实现方可覆盖为非流式端点 */
  complete(model: Model<TApi>, context: Context, options?: StreamOptions): Promise<AssistantMessage>;
}

/**
 * 默认的 complete() 实现：收集流式结果。
 * Provider 实现方可以复用此函数，避免重复编写相同的 stream().result()。
 */
export function defaultComplete(
  provider: Provider<Api>,
  model: Model<Api>,
  context: Context,
  options?: StreamOptions,
): Promise<AssistantMessage> {
  return provider.stream(model, context, options).result();
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

  /** 流式调用：自动根据 model.provider 分发到对应 Provider
   *  Provider 缺失 / API Key 缺失时，会返回带有 error 事件的流（不会同步抛错） */
  stream(model: Model<Api>, context: Context, options?: StreamOptions): AssistantMessageEventStream;
  /** 非流式调用：内部走 provider.complete()，并对可重试错误做指数退避 */
  complete(model: Model<Api>, context: Context, options?: StreamOptions): Promise<AssistantMessage>;
}

// ── 解析结果类型 ──

/** Models 内部用于统一 auth/provider 校验的结果。 */
type ResolvedAuth =
  | { ok: true; provider: Provider; resolvedOptions: StreamOptions }
  | { ok: false; error: AssistantMessage };

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
      return entry.getModels() as Model<Api>[];
    }
    const models: Model<Api>[] = [];
    for (const entry of this.providers.values()) {
      models.push(...(entry.getModels() as Model<Api>[]));
    }
    return models;
  }

  getModel(provider: string, modelId: string): Model<Api> | undefined {
    // O(1) 路径：直接走 provider 自己的 getModel
    return this.providers.get(provider)?.getModel(modelId) as Model<Api> | undefined;
  }

  stream(model: Model<Api>, context: Context, options?: StreamOptions): AssistantMessageEventStream {
    // B2 修复：无论 auth/provider 校验是否通过，都返回一个流（不再同步抛错）。
    // 调用方只用 for-await 消费即可，错误从 error 事件里取。
    const stream = new EventStreamClass();
    const auth = this.resolveAuth(model, options);
    if (auth.ok === false) {
      stream.push({ type: "error", reason: "error", error: auth.error });
      return stream;
    }
    return auth.provider.stream(model, context, auth.resolvedOptions);
  }

  async complete(model: Model<Api>, context: Context, options?: StreamOptions): Promise<AssistantMessage> {
    // D1-b：先做 auth/provider 校验；通过后对 provider.complete 做重试循环。
    const auth = this.resolveAuth(model, options);
    if (auth.ok === false) return auth.error;

    const maxRetries = options?.maxRetries ?? 3;
    let attempt = 0;

    while (true) {
      let result: AssistantMessage;
      try {
        result = await auth.provider.complete(model, context, auth.resolvedOptions);
      } catch (err) {
        // Provider.complete 同步抛错（少见，理想情况应自己捕获推到流）→ 包装为 error 结果
        return createErrorAssistantMessage(
          model,
          err instanceof Error ? err.message : String(err),
        );
      }

      // 成功 / 业务错误（非网络/服务端）→ 直接返回
      if (result.stopReason !== "error") return result;

      // 不可重试的错误 → 直接返回
      const errorMsg = result.errorMessage ?? "";
      if (!isRetryableAssistantError(errorMsg)) return result;

      // 已达最大重试次数 → 返回最后一次的错误
      if (attempt >= maxRetries) return result;

      // 用户已 abort → 不再重试
      if (options?.signal?.aborted) return result;

      // 指数退避：1s, 2s, 4s, 8s（封顶 10s）
      const delay = Math.min(1000 * 2 ** attempt, 10000);
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
      attempt++;
    }
  }

  /** 解析 Provider 与 API Key，结果分 ok/失败两类。
   *  失败时携带一个 stopReason="error" 的 AssistantMessage，调用方可直接返回或推到流。 */
  private resolveAuth(model: Model<Api>, options?: StreamOptions): ResolvedAuth {
    const provider = this.providers.get(model.provider);
    if (!provider) {
      return {
        ok: false,
        error: createErrorAssistantMessage(
          model,
          `未知的 Provider: ${model.provider}。请先调用 models.set() 注册。`,
        ),
      };
    }

    const apiKey = options?.apiKey ?? provider.getApiKey();
    if (!apiKey) {
      return {
        ok: false,
        error: createErrorAssistantMessage(
          model,
          `Provider "${model.provider}" 未配置。请在 packages/ai/.env 文件中设置对应的 API Key，或通过 StreamOptions.apiKey 手动传入。`,
        ),
      };
    }

    return { ok: true, provider, resolvedOptions: { ...options, apiKey } };
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
