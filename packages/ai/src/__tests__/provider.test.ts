/**
 * Provider 与 Models 的单元测试（使用 mock Provider，无需 API Key）。
 */
import { describe, it, expect } from "vitest";
import { createModels, ModelsError } from "../provider/index.js";
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
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
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
            usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
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

  it("Provider 未注册时 stream 抛 ModelsError", () => {
    const models = createModels();
    const badModel: Model<Api> = {
      id: "nonexistent",
      name: "Bad",
      api: "anthropic-messages" as const,
      provider: "nonexistent",
      baseUrl: "",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 0,
      maxTokens: 0,
    };

    expect(() =>
      models.stream(badModel, {
        messages: [{ role: "user", content: "hi", timestamp: Date.now() }],
      })
    ).toThrow(ModelsError);
  });
});
