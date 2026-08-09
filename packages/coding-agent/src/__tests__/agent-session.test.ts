/**
 * AgentSession 单元测试。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Agent } from "@mimi/agent";
import { SessionManager } from "../core/session-manager.js";
import { ModelRegistry } from "../core/model-registry.js";
import { ModelRuntime } from "../core/model-runtime.js";
import { AgentSession } from "../core/agent-session.js";
import { AgentSessionRuntime } from "../core/agent-session-runtime.js";
import { createAgentSession } from "../core/sdk.js";
import type { Model, Provider } from "@mimi/ai";

function makeMockStream(text = "ok") {
  const message = {
    role: "assistant" as const,
    content: [{ type: "text" as const, text }],
    api: "openai-completions" as const,
    provider: "deepseek" as const,
    model: "deepseek-chat",
    usage: { input: 1, output: 1, totalTokens: 2, cost: { input: 0, output: 0, total: 0 } },
    stopReason: "stop" as const,
    timestamp: Date.now(),
  };
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "start" as const, partial: { ...message, content: [] } };
      yield { type: "text_delta" as const, contentIndex: 0, delta: text, partial: message };
      yield { type: "done" as const, reason: "stop" as const, message };
    },
    result: async () => [],
  };
}

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

const TEST_MODEL: Model<any> = {
  id: "deepseek-chat", name: "DeepSeek Chat",
  api: "openai-completions", provider: "deepseek",
  baseUrl: "https://api.deepseek.com", reasoning: false,
  input: ["text"], cost: { input: 0, output: 0 },
  contextWindow: 128000, maxTokens: 8192,
};

describe("AgentSession", () => {
  let registry: ModelRegistry;
  let runtime: ModelRuntime;
  let sm: SessionManager;

  beforeEach(() => {
    registry = new ModelRegistry();
    registry.register(makeProvider("deepseek", [TEST_MODEL]));
    runtime = new ModelRuntime(registry);
    sm = SessionManager.inMemory("/tmp");
  });

  it("构造 + prompt 后 messages 包含回复", async () => {
    const agent = new Agent({
      streamFn: vi.fn().mockReturnValue(makeMockStream("hi")),
      initialState: { model: TEST_MODEL },
    });
    const session = new AgentSession({ agent, sessionManager: sm, modelRuntime: runtime, cwd: "/tmp" });

    process.env.MIMI_API_KEY_DEEPSEEK = "sk-test";
    await session.prompt("hello");
    delete process.env.MIMI_API_KEY_DEEPSEEK;

    const msgs = agent.state.messages;
    expect(msgs.some((m) => m.role === "assistant")).toBe(true);
  });

  it("abort 调 agent.abort", () => {
    const agent = new Agent();
    const session = new AgentSession({ agent, sessionManager: sm, modelRuntime: runtime, cwd: "/tmp" });
    session.abort(); // 不抛错
  });

  it("subscribe 收到事件", async () => {
    const agent = new Agent({
      streamFn: vi.fn().mockReturnValue(makeMockStream("x")),
      initialState: { model: TEST_MODEL },
    });
    const session = new AgentSession({ agent, sessionManager: sm, modelRuntime: runtime, cwd: "/tmp" });
    const events: any[] = [];
    session.subscribe((e) => events.push(e));

    process.env.MIMI_API_KEY_DEEPSEEK = "sk-test";
    await session.prompt("x");
    delete process.env.MIMI_API_KEY_DEEPSEEK;

    expect(events.length).toBeGreaterThan(0);
  });
});

describe("AgentSessionRuntime", () => {
  it("newSession 创建新 session", async () => {
    const reg = new ModelRegistry();
    reg.register(makeProvider("deepseek", [TEST_MODEL]));
    const rt2 = new ModelRuntime(reg);
    const sm = SessionManager.inMemory("/tmp");
    const agent = new Agent({ initialState: { model: TEST_MODEL } });
    const session = new AgentSession({ agent, sessionManager: sm, modelRuntime: rt2, cwd: "/tmp" });
    const services = { cwd: "/tmp", agentDir: "/tmp", modelRuntime: rt2, sessionManager: sm, diagnostics: [] };
    const createRuntime = async () => ({ session, services, diagnostics: [] });
    const rt = new AgentSessionRuntime(session, services, createRuntime);

    const oldId = rt.session.sessionManager.getSessionId();
    await rt.newSession();
    // newSession 创建新 session，ID 应该不同于旧 session
    expect(rt.session.sessionManager.getSessionId()).not.toBe(oldId);
  });

  it("dispose 关闭 session", async () => {
    const reg = new ModelRegistry();
    reg.register(makeProvider("deepseek", [TEST_MODEL]));
    const rt2 = new ModelRuntime(reg);
    const sm2 = SessionManager.inMemory("/tmp");
    const agent = new Agent({ initialState: { model: TEST_MODEL } });
    const session = new AgentSession({ agent, sessionManager: sm2, modelRuntime: rt2, cwd: "/tmp" });
    const services = { cwd: "/tmp", agentDir: "/tmp", modelRuntime: rt2, sessionManager: sm2, diagnostics: [] };
    const createRuntime = async () => ({ session, services, diagnostics: [] });
    const rt = new AgentSessionRuntime(session, services, createRuntime);
    await rt.dispose();
  });
});

describe("createAgentSession (SDK)", () => {
  it("创建完整运行时", async () => {
    process.env.MIMI_API_KEY_DEEPSEEK = "sk-test";
    const result = await createAgentSession({
      cwd: "/tmp",
      model: "deepseek-v4-flash",
      noSession: true,
    });
    delete process.env.MIMI_API_KEY_DEEPSEEK;

    expect(result.session).toBeDefined();
  });
});
