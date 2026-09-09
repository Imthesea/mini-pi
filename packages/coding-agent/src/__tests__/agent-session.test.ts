/**
 * AgentSession 单元测试。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Agent } from "@mimi/agent";
import { SessionManager } from "../core/session-manager.js";
import { SettingsManager } from "../core/settings-manager.js";
import { ModelRegistry } from "../core/model-registry.js";
import { ModelRuntime } from "../core/model-runtime.js";
import { AgentSession, selectTools } from "../core/agent-session.js";
import { createBuiltinTools } from "../core/tools/index.js";
import { AgentSessionRuntime } from "../core/agent-session-runtime.js";
import { createAgentSession } from "../core/sdk.js";
import type { AgentTool } from "@mimi/agent";
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
    const session = new AgentSession({ agent, sessionManager: sm, settingsManager: SettingsManager.inMemory(), modelRuntime: runtime, cwd: "/tmp" });

    process.env.MIMI_API_KEY_DEEPSEEK = "sk-test";
    await session.prompt("hello");
    delete process.env.MIMI_API_KEY_DEEPSEEK;

    const msgs = agent.state.messages;
    expect(msgs.some((m) => m.role === "assistant")).toBe(true);
  });

  it("abort 调 agent.abort", () => {
    const agent = new Agent();
    const session = new AgentSession({ agent, sessionManager: sm, settingsManager: SettingsManager.inMemory(), modelRuntime: runtime, cwd: "/tmp" });
    session.abort(); // 不抛错
  });

  it("subscribe 收到事件", async () => {
    const agent = new Agent({
      streamFn: vi.fn().mockReturnValue(makeMockStream("x")),
      initialState: { model: TEST_MODEL },
    });
    const session = new AgentSession({ agent, sessionManager: sm, settingsManager: SettingsManager.inMemory(), modelRuntime: runtime, cwd: "/tmp" });
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
    const session = new AgentSession({ agent, sessionManager: sm, settingsManager: SettingsManager.inMemory(), modelRuntime: rt2, cwd: "/tmp" });
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
    const session = new AgentSession({ agent, sessionManager: sm2, settingsManager: SettingsManager.inMemory(), modelRuntime: rt2, cwd: "/tmp" });
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

describe("selectTools", () => {
  const builtin = createBuiltinTools("/tmp");

  it("空 toolNames 返回全部内置工具", () => {
    expect(selectTools(builtin, [])).toEqual(builtin);
  });

  it("按名字过滤内置工具", () => {
    const selected = selectTools(builtin, ["read_file", "grep"]);
    expect(selected.map((t) => t.name).sort()).toEqual(["grep", "read_file"]);
  });

  it("未匹配到任何工具时返回空数组", () => {
    expect(selectTools(builtin, ["nonexistent"])).toEqual([]);
  });
});

describe("AgentSession 工具/追加 prompt 注入", () => {
  function makeExtraTool(name: string): AgentTool<any> {
    return {
      name,
      label: name,
      description: name,
      parameters: { type: "object", properties: {} },
      execute: async () => ({ content: [], details: {} }),
    };
  }

  it("toolNames 过滤 + extraTools 合并 + appendSystemPrompt 追加", async () => {
    const registry = new ModelRegistry();
    registry.register(makeProvider("deepseek", [TEST_MODEL]));
    const runtime = new ModelRuntime(registry);
    const sm = SessionManager.inMemory("/tmp");
    const agent = new Agent({
      streamFn: vi.fn().mockReturnValue(makeMockStream("ok")),
      initialState: { model: TEST_MODEL },
    });
    const session = new AgentSession({
      agent,
      sessionManager: sm,
      settingsManager: SettingsManager.inMemory(),
      modelRuntime: runtime,
      cwd: "/tmp",
      toolNames: ["read_file"],
      appendSystemPrompt: "EXTRA_APPEND",
      extraTools: [makeExtraTool("custom_tool")],
    });

    process.env.MIMI_API_KEY_DEEPSEEK = "sk-test";
    await session.prompt("hello");
    delete process.env.MIMI_API_KEY_DEEPSEEK;

    const toolNames = agent.state.tools.map((t) => t.name).sort();
    expect(toolNames).toEqual(["custom_tool", "read_file"]);
    expect(agent.state.systemPrompt.endsWith("EXTRA_APPEND")).toBe(true);
  });

  it("未指定 toolNames 时注入全部内置工具 + 扩展工具", async () => {
    const registry = new ModelRegistry();
    registry.register(makeProvider("deepseek", [TEST_MODEL]));
    const runtime = new ModelRuntime(registry);
    const sm = SessionManager.inMemory("/tmp");
    const agent = new Agent({
      streamFn: vi.fn().mockReturnValue(makeMockStream("ok")),
      initialState: { model: TEST_MODEL },
    });
    const session = new AgentSession({
      agent,
      sessionManager: sm,
      settingsManager: SettingsManager.inMemory(),
      modelRuntime: runtime,
      cwd: "/tmp",
      extraTools: [makeExtraTool("custom_tool")],
    });

    process.env.MIMI_API_KEY_DEEPSEEK = "sk-test";
    await session.prompt("hello");
    delete process.env.MIMI_API_KEY_DEEPSEEK;

    const toolNames = agent.state.tools.map((t) => t.name);
    expect(toolNames).toContain("read_file");
    expect(toolNames).toContain("custom_tool");
    expect(toolNames).toHaveLength(9); // 8 内置 + 1 扩展
  });
});

describe("AgentSession.compact", () => {
  const SUMMARY_MSG = {
    role: "assistant" as const,
    content: [{ type: "text" as const, text: "COMPACTED_SUMMARY" }],
    api: "openai-completions" as const,
    provider: "deepseek" as const,
    model: "deepseek-chat",
    usage: { input: 1, output: 1, totalTokens: 2, cost: { input: 0, output: 0, total: 0 } },
    stopReason: "stop" as const,
    timestamp: Date.now(),
  };

  function assistantMsg(text: string) {
    return {
      role: "assistant" as const,
      content: [{ type: "text" as const, text }],
      api: "openai-completions" as const,
      provider: "deepseek" as const,
      model: "deepseek-chat",
      usage: { input: 1, output: 1, totalTokens: 2, cost: { input: 0, output: 0, total: 0 } },
      stopReason: "stop" as const,
      timestamp: Date.now(),
    };
  }

  function makeSession(settings: any = {}) {
    const registry = new ModelRegistry();
    registry.register(makeProvider("deepseek", [TEST_MODEL]));
    const runtime = new ModelRuntime(registry);
    const sm = SessionManager.inMemory("/tmp");
    const agent = new Agent({
      streamFn: vi.fn().mockReturnValue({ result: async () => SUMMARY_MSG }),
      initialState: { model: TEST_MODEL },
    });
    const session = new AgentSession({
      agent,
      sessionManager: sm,
      settingsManager: SettingsManager.inMemory(settings),
      modelRuntime: runtime,
      cwd: "/tmp",
    });
    return { agent, sm, session };
  }

  it("小会话 compact() 抛 Nothing to compact", async () => {
    const { sm, session } = makeSession();
    sm.appendMessage({ role: "user", content: "hi", timestamp: Date.now() } as any);
    sm.appendMessage(assistantMsg("ok"));

    await expect(session.compact()).rejects.toThrow("Nothing to compact");
  });

  it("大会话 compact() 生成摘要并重载上下文", async () => {
    const { agent, sm, session } = makeSession({ compaction: { enabled: true, reserveTokens: 100, keepRecentTokens: 10 } });
    sm.appendMessage({ role: "user", content: "start", timestamp: Date.now() } as any);
    sm.appendMessage(assistantMsg("ok"));
    sm.appendMessage({ role: "user", content: "Q" + "y".repeat(200), timestamp: Date.now() } as any);
    sm.appendMessage(assistantMsg("A" + "z".repeat(200)));

    const result = await session.compact();

    expect(result.summary).toBe("COMPACTED_SUMMARY");

    // session 里追加了 compaction 条目（叶子是 compaction）
    const branch = sm.getBranch();
    expect(branch[branch.length - 1].type).toBe("compaction");

    // agent.state.messages 被重载为含 compactionSummary 的消息
    expect(agent.state.messages.some((m: any) => m.role === "compactionSummary")).toBe(true);
  });
});

describe("AgentSession 自动压缩 & 重试（集成）", () => {
  /** 空流：不 yield 事件，result() 返回完整 AssistantMessage（让 agent-loop 走 result() 路径） */
  function makeStream(message: any) {
    return {
      async *[Symbol.asyncIterator]() {},
      result: async () => message,
    };
  }

  function assistantMsg(text: string) {
    return {
      role: "assistant" as const,
      content: [{ type: "text" as const, text }],
      api: "openai-completions" as const,
      provider: "deepseek" as const,
      model: "deepseek-chat",
      usage: { input: 1, output: 1, totalTokens: 2, cost: { input: 0, output: 0, total: 0 } },
      stopReason: "stop" as const,
      timestamp: Date.now(),
    };
  }

  it("静默溢出（stop + usage 超窗）触发自动压缩并重载上下文", async () => {
    const registry = new ModelRegistry();
    registry.register(makeProvider("deepseek", [TEST_MODEL]));
    const runtime = new ModelRuntime(registry);
    const sm = SessionManager.inMemory("/tmp");

    // 预置大会话历史，让 prepareCompaction 能切出摘要
    for (let i = 0; i < 3; i++) {
      sm.appendMessage({ role: "user", content: "q" + "q".repeat(100), timestamp: Date.now() } as any);
      sm.appendMessage(assistantMsg("a" + "a".repeat(100)));
    }

    const overflowMsg = {
      ...assistantMsg("overflow"),
      usage: { input: 200000, output: 0, totalTokens: 200000, cost: { input: 0, output: 0, total: 0 } },
    };
    const summaryMsg = assistantMsg("COMPACTED");

    const streamFn = vi.fn()
      .mockReturnValueOnce(makeStream(overflowMsg))
      .mockReturnValueOnce(makeStream(summaryMsg));

    const agent = new Agent({ streamFn, initialState: { model: TEST_MODEL } });
    const session = new AgentSession({
      agent,
      sessionManager: sm,
      settingsManager: SettingsManager.inMemory({ compaction: { enabled: true, reserveTokens: 100, keepRecentTokens: 10 } }),
      modelRuntime: runtime,
      cwd: "/tmp",
    });

    const events: any[] = [];
    session.subscribe((e) => events.push(e));

    process.env.MIMI_API_KEY_DEEPSEEK = "sk-test";
    await session.prompt("hi");
    delete process.env.MIMI_API_KEY_DEEPSEEK;

    expect(events.some((e) => e.type === "compaction_end" && e.reason === "overflow")).toBe(true);
    const branch = sm.getBranch();
    expect(branch[branch.length - 1].type).toBe("compaction");
    expect(agent.state.messages.some((m: any) => m.role === "compactionSummary")).toBe(true);
  });

  it("可重试错误触发外层重试并最终成功", async () => {
    const registry = new ModelRegistry();
    registry.register(makeProvider("deepseek", [TEST_MODEL]));
    const runtime = new ModelRuntime(registry);
    const sm = SessionManager.inMemory("/tmp");

    const errorMsg = {
      role: "assistant" as const,
      content: [] as const,
      api: "openai-completions" as const,
      provider: "deepseek" as const,
      model: "deepseek-chat",
      usage: { input: 1, output: 0, totalTokens: 1, cost: { input: 0, output: 0, total: 0 } },
      stopReason: "error" as const,
      errorMessage: "500 Internal Server Error",
      timestamp: Date.now(),
    };
    const successMsg = assistantMsg("recovered");

    const streamFn = vi.fn()
      .mockReturnValueOnce(makeStream(errorMsg))
      .mockReturnValueOnce(makeStream(errorMsg))
      .mockReturnValueOnce(makeStream(errorMsg))
      .mockReturnValueOnce(makeStream(successMsg));

    const agent = new Agent({ streamFn, initialState: { model: TEST_MODEL } });
    const session = new AgentSession({
      agent,
      sessionManager: sm,
      settingsManager: SettingsManager.inMemory({ retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 } }),
      modelRuntime: runtime,
      cwd: "/tmp",
    });

    const events: any[] = [];
    session.subscribe((e) => events.push(e));

    process.env.MIMI_API_KEY_DEEPSEEK = "sk-test";
    await session.prompt("hi");
    delete process.env.MIMI_API_KEY_DEEPSEEK;

    expect(events.some((e) => e.type === "auto_retry_start")).toBe(true);
    expect(streamFn).toHaveBeenCalledTimes(4);
    const last = agent.state.messages[agent.state.messages.length - 1] as any;
    expect(last.stopReason).toBe("stop");
  });
});
