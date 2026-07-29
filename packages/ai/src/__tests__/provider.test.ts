/**
 * Provider 与 Models 的单元测试（使用 mock Provider，无需 API Key）。
 */
import { describe, it, expect } from "vitest";
import { createModels } from "../provider/index.js";
import type { Provider, Models } from "../provider/index.js";
import { AssistantMessageEventStream } from "../stream/index.js";
import type { Api, Model, Context } from "../types.js";

/** 创建一个 mock Provider 用于测试 */
function mockProvider(): Provider<Api> {
  const models: Model<Api>[] = [{
    id: "mock-model",
    name: "Mock Model",
    api: "anthropic-messages" as const,
    provider: "mock",
    baseUrl: "https://mock.example.com",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0 },
    contextWindow: 1000,
    maxTokens: 100,
  }];

  const provider: Provider<Api> = {
    id: "mock",
    name: "Mock Provider",
    baseUrl: "https://mock.example.com",
    getApiKey: () => "mock-key-123",
    getModels: () => models,
    getModel: (id) => models.find((m) => m.id === id),
    stream: (model, context, _options) => {
      const stream = new AssistantMessageEventStream();
      setTimeout(() => {
        stream.push({
          type: "done",
          reason: "stop",
          message: {
            role: "assistant",
            content: [{ type: "text", text: `mock 响应，收到 ${context.messages.length} 条消息` }],
            api: "anthropic-messages",
            provider: "mock",
            model: model.id,
            usage: { input: 10, output: 5, totalTokens: 15, cost: { input: 0, output: 0, total: 0 } },
            stopReason: "stop",
            timestamp: Date.now(),
          },
        });
      }, 0);
      return stream;
    },
    complete: async (model, context, options) => {
      return provider.stream(model, context, options).result();
    },
  };

  return provider;
}

describe("Models", () => {
  it("可以注册和查找 Provider", () => {
    const models = createModels();
    const provider = mockProvider();

    models.set(provider);
    expect(models.list()).toHaveLength(1);
    expect(models.get("mock")).toBe(provider);
  });

  it("set() 相同 ID 会替换旧 Provider", () => {
    const models = createModels();
    const p1 = mockProvider();
    const p2 = mockProvider(); // 同 ID

    models.set(p1);
    models.set(p2);
    expect(models.list()).toHaveLength(1);
  });

  it("remove() 可以删除 Provider", () => {
    const models = createModels();
    models.set(mockProvider());
    models.remove("mock");
    expect(models.list()).toHaveLength(0);
  });

  it("getModels() 返回所有模型", () => {
    const models = createModels();
    models.set(mockProvider());

    const allModels = models.getModels();
    expect(allModels).toHaveLength(1);
    expect(allModels[0].id).toBe("mock-model");
  });

  it("getModel() 精确查找模型", () => {
    const models = createModels();
    models.set(mockProvider());

    const found = models.getModel("mock", "mock-model");
    expect(found?.id).toBe("mock-model");

    const notFound = models.getModel("mock", "nonexistent");
    expect(notFound).toBeUndefined();
  });

  it("通过 mock Provider 完成流式调用", async () => {
    const models = createModels();
    models.set(mockProvider());

    const model = models.getModel("mock", "mock-model")!;
    const result = await models.complete(model, {
      messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
    });

    expect(result.stopReason).toBe("stop");
    expect(result.content[0]).toHaveProperty("type", "text");
    expect((result.content[0] as any).text).toContain("mock 响应");
  });

  it("Provider 未注册时 stream 在流中推送 error 事件（B2 修复：不再同步抛错）", async () => {
    const models = createModels();
    const badModel: Model<Api> = {
      id: "nonexistent",
      name: "Bad",
      api: "anthropic-messages" as const,
      provider: "nonexistent",
      baseUrl: "",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0 },
      contextWindow: 0,
      maxTokens: 0,
    };

    // B2 修复：Models.stream 不再抛同步异常，而是返回带有 error 事件的流
    const stream = models.stream(badModel, {
      messages: [{ role: "user", content: "hi", timestamp: Date.now() }],
    });
    const result = await stream.result();
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toContain("nonexistent");
  });

  it("Provider 未注册时 complete 立即返回 error 结果", async () => {
    const models = createModels();
    const badModel: Model<Api> = {
      id: "nonexistent",
      name: "Bad",
      api: "anthropic-messages" as const,
      provider: "nonexistent",
      baseUrl: "",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0 },
      contextWindow: 0,
      maxTokens: 0,
    };

    const result = await models.complete(badModel, {
      messages: [{ role: "user", content: "hi", timestamp: Date.now() }],
    });
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toContain("nonexistent");
  });

  describe("重试逻辑", () => {
    /** 创建一个可控的 Provider——前 N 次返回 error（可重试），第 N+1 次成功 */
    function flakyProvider(failuresBeforeSuccess: number, errorMessage: string): { provider: Provider<Api>; callCount: () => number } {
      let calls = 0;
      const flakyModel: Model<Api> = {
        id: "flaky-model",
        name: "Flaky",
        api: "anthropic-messages" as const,
        provider: "flaky",
        baseUrl: "",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0 },
        contextWindow: 1000,
        maxTokens: 100,
      };
      const provider: Provider<Api> = {
        id: "flaky",
        name: "Flaky",
        getApiKey: () => "key",
        getModels: () => [flakyModel],
        getModel: (id) => id === "flaky-model" ? flakyModel : undefined,
        stream: (model, context) => {
          const stream = new AssistantMessageEventStream();
          setTimeout(() => {
            calls++;
            if (calls <= failuresBeforeSuccess) {
              stream.push({
                type: "error",
                reason: "error",
                error: {
                  role: "assistant",
                  content: [],
                  api: "anthropic-messages",
                  provider: "flaky",
                  model: model.id,
                  usage: { input: 0, output: 0, totalTokens: 0, cost: { input: 0, output: 0, total: 0 } },
                  stopReason: "error",
                  errorMessage,
                  timestamp: Date.now(),
                },
              });
            } else {
              stream.push({
                type: "done",
                reason: "stop",
                message: {
                  role: "assistant",
                  content: [{ type: "text", text: "ok" }],
                  api: "anthropic-messages",
                  provider: "flaky",
                  model: model.id,
                  usage: { input: 1, output: 1, totalTokens: 2, cost: { input: 0, output: 0, total: 0 } },
                  stopReason: "stop",
                  timestamp: Date.now(),
                },
              });
            }
          }, 0);
          return stream;
        },
        complete: async (model, context, options) => {
          return provider.stream(model, context, options).result();
        },
      };
      return { provider, callCount: () => calls };
    }

    it("可重试错误 + 重试次数足够 → 最终成功", async () => {
      const { provider, callCount } = flakyProvider(2, "HTTP 503 service unavailable");
      const models = createModels();
      models.set(provider);

      const result = await models.complete(
        { id: "flaky-model", name: "Flaky", api: "anthropic-messages", provider: "flaky", baseUrl: "", reasoning: false, input: ["text"], cost: { input: 0, output: 0 }, contextWindow: 1000, maxTokens: 100 },
        { messages: [{ role: "user", content: "hi", timestamp: Date.now() }] },
        { maxRetries: 3 },
      );

      expect(callCount()).toBe(3); // 2 次失败 + 1 次成功
      expect(result.stopReason).toBe("stop");
    });

    it("不可重试错误（如 invalid_api_key）→ 不重试，立即返回 error", async () => {
      const { provider, callCount } = flakyProvider(99, "invalid_api_key");
      const models = createModels();
      models.set(provider);

      const result = await models.complete(
        { id: "flaky-model", name: "Flaky", api: "anthropic-messages", provider: "flaky", baseUrl: "", reasoning: false, input: ["text"], cost: { input: 0, output: 0 }, contextWindow: 1000, maxTokens: 100 },
        { messages: [{ role: "user", content: "hi", timestamp: Date.now() }] },
        { maxRetries: 5 },
      );

      expect(callCount()).toBe(1); // 不重试
      expect(result.stopReason).toBe("error");
      expect(result.errorMessage).toContain("invalid_api_key");
    });

    it("可重试错误但超过 maxRetries → 返回最后一次错误", async () => {
      const { provider, callCount } = flakyProvider(10, "HTTP 500 internal error");
      const models = createModels();
      models.set(provider);

      const result = await models.complete(
        { id: "flaky-model", name: "Flaky", api: "anthropic-messages", provider: "flaky", baseUrl: "", reasoning: false, input: ["text"], cost: { input: 0, output: 0 }, contextWindow: 1000, maxTokens: 100 },
        { messages: [{ role: "user", content: "hi", timestamp: Date.now() }] },
        { maxRetries: 2 },
      );

      expect(callCount()).toBe(3); // 1 + 2 retries
      expect(result.stopReason).toBe("error");
    });

    it("maxRetries=0 → 禁用重试", async () => {
      const { provider, callCount } = flakyProvider(99, "HTTP 500");
      const models = createModels();
      models.set(provider);

      await models.complete(
        { id: "flaky-model", name: "Flaky", api: "anthropic-messages", provider: "flaky", baseUrl: "", reasoning: false, input: ["text"], cost: { input: 0, output: 0 }, contextWindow: 1000, maxTokens: 100 },
        { messages: [{ role: "user", content: "hi", timestamp: Date.now() }] },
        { maxRetries: 0 },
      );

      expect(callCount()).toBe(1);
    });
  });
});
