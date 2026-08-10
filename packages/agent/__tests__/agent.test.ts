/**
 * Agent 类单元测试 —— TDD Step 1: 测试先写。
 *
 * 覆盖：
 * - 构造后 state 可访问
 * - prompt() 后 messages 包含 assistant 回复
 * - abort() 中断当前 run
 * - steer() 入队
 * - subscribe 返回退订函数
 */

import { describe, it, expect, vi } from "vitest";
import { Agent } from "../src/agent.js";
import type { AgentMessage } from "../src/types.js";

// ── 辅助：mock 一个 streamFn，返回可被 runAgentLoop 消费的流 ──

function makeMockStream(text: string) {
  const message = {
    role: "assistant" as const,
    content: [{ type: "text" as const, text }],
    api: "openai-completions" as const,
    provider: "deepseek" as const,
    model: "deepseek-chat",
    usage: { input: 5, output: 2, totalTokens: 7, cost: { input: 0, output: 0, total: 0 } },
    stopReason: "stop" as const,
    timestamp: Date.now(),
  };

  const stream = {
    async *[Symbol.asyncIterator]() {
      yield { type: "start" as const, partial: { ...message, content: [] } };
      yield { type: "text_delta" as const, contentIndex: 0, delta: text, partial: message };
      yield { type: "text_end" as const, contentIndex: 0, content: text, partial: message };
      yield { type: "done" as const, reason: "stop" as const, message };
    },
    result: async (): Promise<AgentMessage[]> => [message],
  };
  return stream;
}

function mockStreamFn(text = "你好！") {
  return vi.fn().mockReturnValue(makeMockStream(text));
}

// ── 辅助：构造一个最小可用的 model ──

const TEST_MODEL = {
  id: "deepseek-chat",
  name: "DeepSeek Chat",
  api: "openai-completions" as const,
  provider: "deepseek",
  baseUrl: "https://api.deepseek.com",
  reasoning: false,
  input: ["text" as const],
  cost: { input: 0, output: 0 },
  contextWindow: 128000,
  maxTokens: 8192,
};

// ── 测试 ──

describe("Agent", () => {
  it("构造后 state 可访问", () => {
    const agent = new Agent();
    expect(agent.state.messages).toEqual([]);
    expect(agent.state.tools).toEqual([]);
    expect(agent.state.isStreaming).toBe(false);
    expect(agent.state.systemPrompt).toBe("");
  });

  it("prompt() 后 messages 包含 assistant 回复", async () => {
    const agent = new Agent({
      initialState: { model: TEST_MODEL },
      streamFn: mockStreamFn("你好！"),
    });

    const events: any[] = [];
    agent.subscribe((event) => { events.push(event); });

    await agent.prompt("你好");

    // prompt 后应至少有一条 assistant 消息
    const lastMsg = agent.state.messages[agent.state.messages.length - 1];
    expect(lastMsg).toBeDefined();
    expect(lastMsg!.role).toBe("assistant");

    // 应有 agent_end 事件
    expect(events.some((e) => e.type === "agent_end")).toBe(true);
  });

  it("abort() 中断当前 run", async () => {
    const agent = new Agent({
      initialState: { model: TEST_MODEL },
      streamFn: mockStreamFn(),
    });

    // 同时启动 prompt + abort
    const promptPromise = agent.prompt("你好");
    agent.abort();
    await promptPromise;

    // abort 后 errorMessage 可能有值
    expect(agent.state.isStreaming).toBe(false);
  });

  it("steer() 入队后可被 hasQueuedMessages 检测", () => {
    const agent = new Agent();
    agent.steer({
      role: "user",
      content: "补充",
      timestamp: Date.now(),
    });
    expect(agent.hasQueuedMessages()).toBe(true);
  });

  it("subscribe 返回退订函数", () => {
    const agent = new Agent();
    const unsub = agent.subscribe(() => {});
    expect(typeof unsub).toBe("function");
    unsub(); // 不抛错
  });

  it("continue() 从当前 transcript 继续", async () => {
    const agent = new Agent({
      initialState: {
        model: TEST_MODEL,
        messages: [
          {
            role: "user",
            content: "hello",
            timestamp: Date.now(),
          },
          {
            role: "toolResult",
            toolCallId: "t1",
            toolName: "read_file",
            content: [{ type: "text", text: "file content" }],
            isError: false,
            timestamp: Date.now(),
          },
        ],
      },
      streamFn: mockStreamFn("继续的回复"),
    });

    await agent.continue();

    // 应该有两条 assistant 消息（原有 toolResult 保留 + 新 assistant）
    expect(agent.state.messages.some((m) => m.role === "assistant")).toBe(true);
  });

  it("reset() 清空状态", () => {
    const agent = new Agent({
      initialState: {
        messages: [{ role: "user", content: "test", timestamp: Date.now() }],
      },
    });
    agent.reset();
    expect(agent.state.messages).toEqual([]);
    expect(agent.state.errorMessage).toBeUndefined();
  });
});
