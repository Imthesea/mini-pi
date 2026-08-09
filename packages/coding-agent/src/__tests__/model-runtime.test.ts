/**
 * ModelRuntime / ModelRegistry / ModelResolver 单元测试。
 *
 * 覆盖：
 * - register 后 getModel 查找
 * - list 返回所有模型
 * - findByProvider 筛选
 * - getAuth 从环境变量读 key
 * - resolveModel 按名称解析
 * - isUsingOAuth V1 永远 false
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { Provider, Model } from "@mimi/ai";
import { ModelRegistry } from "../core/model-registry.js";
import { ModelRuntime } from "../core/model-runtime.js";
import { resolveModel } from "../core/model-resolver.js";

// ── Mock Provider ──

function makeProvider(id: string, models: Model<any>[]): Provider {
  return {
    id,
    name: id,
    getModels: () => models,
    getModel: (modelId: string) => models.find((m) => m.id === modelId),
    getApiKey: () => undefined,
    stream: () => {
      throw new Error("not used");
    },
    complete: () => {
      throw new Error("not used");
    },
  };
}

const TEST_MODEL_DS: Model<any> = {
  id: "deepseek-chat",
  name: "DeepSeek Chat",
  api: "openai-completions",
  provider: "deepseek",
  baseUrl: "https://api.deepseek.com",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0 },
  contextWindow: 128000,
  maxTokens: 8192,
};

const TEST_MODEL_GPT: Model<any> = {
  id: "gpt-5.5",
  name: "GPT-5.5",
  api: "openai-completions",
  provider: "openai",
  baseUrl: "https://api.openai.com",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0 },
  contextWindow: 128000,
  maxTokens: 16384,
};

describe("ModelRegistry", () => {
  let registry: ModelRegistry;

  beforeEach(() => {
    registry = new ModelRegistry();
  });

  it("注册 provider 后可查找模型", () => {
    registry.register(makeProvider("deepseek", [TEST_MODEL_DS]));
    const model = registry.getModel("deepseek", "deepseek-chat");
    expect(model).toBeDefined();
    expect(model!.provider).toBe("deepseek");
  });

  it("list 返回所有模型", () => {
    registry.register(makeProvider("deepseek", [TEST_MODEL_DS]));
    registry.register(makeProvider("openai", [TEST_MODEL_GPT]));
    expect(registry.list().length).toBeGreaterThanOrEqual(2);
  });

  it("findByProvider 筛选", () => {
    registry.register(makeProvider("deepseek", [TEST_MODEL_DS]));
    registry.register(makeProvider("openai", [TEST_MODEL_GPT]));
    const ds = registry.findByProvider("deepseek");
    expect(ds.every((m) => m.provider === "deepseek")).toBe(true);
  });
});

describe("ModelRuntime", () => {
  let registry: ModelRegistry;
  let runtime: ModelRuntime;

  beforeEach(() => {
    registry = new ModelRegistry();
    registry.register(makeProvider("deepseek", [TEST_MODEL_DS]));
    registry.register(makeProvider("openai", [TEST_MODEL_GPT]));
    runtime = new ModelRuntime(registry);
  });

  it("getModel 遍历所有 provider 查找", () => {
    const m = runtime.getModel("deepseek-chat");
    expect(m).toBeDefined();
    expect(m!.id).toBe("deepseek-chat");
  });

  it("getModel 找不到返回 undefined", () => {
    expect(runtime.getModel("nonexistent")).toBeUndefined();
  });

  it("getAuth 从环境变量读 key", async () => {
    process.env.MIMI_API_KEY_DEEPSEEK = "sk-test-123";
    const auth = await runtime.getAuth(TEST_MODEL_DS);
    expect(auth.apiKey).toBe("sk-test-123");
    delete process.env.MIMI_API_KEY_DEEPSEEK;
  });

  it("getAuth 无环境变量时抛错", async () => {
    await expect(runtime.getAuth(TEST_MODEL_DS)).rejects.toThrow(
      /No API key found/,
    );
  });

  it("isUsingOAuth V1 永远返回 false", () => {
    expect(runtime.isUsingOAuth("anthropic")).toBe(false);
    expect(runtime.isUsingOAuth("openai")).toBe(false);
  });

  it("resolveModel 按 ID 解析模型", () => {
    const model = runtime.resolveModel("deepseek-chat");
    expect(model).toBeDefined();
    expect(model!.provider).toBe("deepseek");
  });
});

describe("resolveModel (独立函数)", () => {
  it("指定 input 时按 input 优先", () => {
    const registry = new ModelRegistry();
    registry.register(makeProvider("deepseek", [TEST_MODEL_DS]));
    const runtime = new ModelRuntime(registry);

    const model = resolveModel("deepseek-chat", runtime, "gpt-5.5");
    expect(model.id).toBe("deepseek-chat");
  });

  it("input 为空时回退到 MIMI_MODEL 环境变量", () => {
    const registry = new ModelRegistry();
    registry.register(makeProvider("openai", [TEST_MODEL_GPT]));
    const runtime = new ModelRuntime(registry);

    process.env.MIMI_MODEL = "gpt-5.5";
    const model = resolveModel(undefined, runtime, "deepseek-chat");
    expect(model.id).toBe("gpt-5.5");
    delete process.env.MIMI_MODEL;
  });

  it("都不存在时回退到 defaultModel", () => {
    const registry = new ModelRegistry();
    registry.register(makeProvider("deepseek", [TEST_MODEL_DS]));
    const runtime = new ModelRuntime(registry);

    const model = resolveModel(undefined, runtime, "deepseek-chat");
    expect(model.id).toBe("deepseek-chat");
  });

  it("找不到模型时抛错", () => {
    const registry = new ModelRegistry();
    const runtime = new ModelRuntime(registry);

    expect(() => resolveModel("nonexistent", runtime, "default")).toThrow(
      /Unknown model/,
    );
  });
});
