/**
 * ModelRuntime / ModelRegistry / ModelResolver 单元测试。
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { Provider, Model } from "@mimi/ai";
import { ModelRegistry } from "../core/model-registry.js";
import { ModelRuntime } from "../core/model-runtime.js";
import { resolveModel, findExactModelReferenceMatch } from "../core/model-resolver.js";

function makeProvider(id: string, models: Model<any>[]): Provider {
  return {
    id, name: id,
    getModels: () => models,
    getModel: (mid: string) => models.find((m) => m.id === mid),
    getApiKey: () => undefined,
    stream: () => { throw new Error("not used"); },
    complete: () => { throw new Error("not used"); },
  };
}

const TEST_MODEL_DS: Model<any> = {
  id: "deepseek-chat", name: "DeepSeek Chat",
  api: "openai-completions", provider: "deepseek",
  baseUrl: "https://api.deepseek.com", reasoning: false,
  input: ["text"], cost: { input: 0, output: 0 },
  contextWindow: 128000, maxTokens: 8192,
};

const TEST_MODEL_GPT: Model<any> = {
  id: "gpt-5.5", name: "GPT-5.5",
  api: "openai-completions", provider: "openai",
  baseUrl: "https://api.openai.com", reasoning: false,
  input: ["text"], cost: { input: 0, output: 0 },
  contextWindow: 128000, maxTokens: 16384,
};

describe("ModelRegistry", () => {
  let registry: ModelRegistry;

  beforeEach(() => { registry = new ModelRegistry(); });

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
  let runtime: ModelRuntime;

  beforeEach(() => {
    const registry = new ModelRegistry();
    runtime = new ModelRuntime(registry);
    runtime.set(makeProvider("deepseek", [TEST_MODEL_DS]));
    runtime.set(makeProvider("openai", [TEST_MODEL_GPT]));
  });

  it("getModel 按 provider + modelId 查找", () => {
    const m = runtime.getModel("deepseek", "deepseek-chat");
    expect(m).toBeDefined();
    expect(m!.id).toBe("deepseek-chat");
  });

  it("getModel 找不到返回 undefined", () => {
    expect(runtime.getModel("deepseek", "nonexistent")).toBeUndefined();
  });

  it("getAuth 从环境变量读 key", async () => {
    process.env.MIMI_API_KEY_DEEPSEEK = "sk-test-123";
    const auth = await runtime.getAuth(TEST_MODEL_DS);
    expect(auth?.auth.apiKey).toBe("sk-test-123");
    delete process.env.MIMI_API_KEY_DEEPSEEK;
  });

  it("getAuth 无环境变量时返回 undefined", async () => {
    const auth = await runtime.getAuth(TEST_MODEL_DS);
    expect(auth).toBeUndefined();
  });

  it("isUsingOAuth V1 永远返回 false", () => {
    expect(runtime.isUsingOAuth("anthropic")).toBe(false);
    expect(runtime.isUsingOAuth("openai")).toBe(false);
  });

  it("getModels 返回已注册模型", () => {
    const models = runtime.getModels();
    expect(models.length).toBeGreaterThanOrEqual(2);
  });

  it("hasConfiguredAuth 检测认证状态", () => {
    process.env.MIMI_API_KEY_DEEPSEEK = "sk-test";
    runtime.refresh(); // rebuild snapshot
    expect(runtime.hasConfiguredAuth("deepseek")).toBe(true);
    delete process.env.MIMI_API_KEY_DEEPSEEK;
  });
});

describe("resolveModel", () => {
  it("按 input 优先解析", () => {
    const rt = new ModelRuntime(new ModelRegistry());
    rt.set(makeProvider("deepseek", [TEST_MODEL_DS]));
    rt.set(makeProvider("openai", [TEST_MODEL_GPT]));
    const model = resolveModel("deepseek-chat", rt, "gpt-5.5");
    expect(model.id).toBe("deepseek-chat");
  });

  it("input 为空时回退到 MIMI_MODEL 环境变量", () => {
    const rt = new ModelRuntime(new ModelRegistry());
    rt.set(makeProvider("openai", [TEST_MODEL_GPT]));
    process.env.MIMI_MODEL = "gpt-5.5";
    const model = resolveModel(undefined, rt, "deepseek-chat");
    expect(model.id).toBe("gpt-5.5");
    delete process.env.MIMI_MODEL;
  });

  it("都不存在时回退到 defaultModel", () => {
    const rt = new ModelRuntime(new ModelRegistry());
    rt.set(makeProvider("deepseek", [TEST_MODEL_DS]));
    const model = resolveModel(undefined, rt, "deepseek-chat");
    expect(model.id).toBe("deepseek-chat");
  });

  it("找不到模型时抛错", () => {
    const rt = new ModelRuntime(new ModelRegistry());
    expect(() => resolveModel("nonexistent", rt, "default")).toThrow(/Unknown model/);
  });
});

describe("findExactModelReferenceMatch", () => {
  it("精确匹配裸 model id", () => {
    const match = findExactModelReferenceMatch("deepseek-chat", [TEST_MODEL_DS]);
    expect(match).toBeDefined();
    expect(match!.id).toBe("deepseek-chat");
  });
});
