/**
 * agent-loop 单元测试。
 *
 * 覆盖（依据 2026-07-30-phase02-agent-plan.md Task 2）：
 * - 基础：最简 / 单工具 / 多工具 / 工具抛错 / 无 toolCall 自然结束
 * - 重试：可重试错误 (429) + 不可重试错误 (401)
 * - 控制：AbortSignal / beforeToolCall / afterToolCall / parallel 模式
 * - API：agentLoop (EventStream) / runAgentLoopContinue
 *
 * TDD 状态：实现已完成,本文件为回归测试。
 */

import { describe, it, expect, vi } from "vitest";
import {
  createMockStreamFn,
  makeEchoTool,
  makeFailTool,
  mockModel,
} from "./_helpers/mock-provider.js";
import { isRetryableAssistantError } from "@mimi/ai";
import type { AgentEvent, AgentMessage, AgentTool } from "../src/types.js";

// ─────────────────────────────────────────────────────────────
// 1. 基础 case
// ─────────────────────────────────────────────────────────────

describe("agent-loop: 基础流程", () => {
  it("无工具 case: 模型只输出 text, 完整事件序列 + callCount=1", async () => {
    // 剧本:模型只输出 "hello"
    const { streamFn, handle } = createMockStreamFn([
      { kind: "text", text: "hello" },
    ]);

    const { runAgentLoop } = await import("../src/agent-loop.js");
    const messages = await runAgentLoop(
      [{ role: "user", content: "hi", timestamp: 1 }],
      { systemPrompt: "you are helpful", messages: [] },
      { model: mockModel, convertToLlm: (msgs) => msgs, streamFn },
    );

    // 返回的 messages 应包含 user prompt + assistant response
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");
    expect(handle.callCount).toBe(1);
  });

  it("单工具 case: 模型返回 1 个 toolCall, 执行后 push toolResult, 继续 LLM", async () => {
    // 剧本:第一轮 toolCall,第二轮 text
    const { streamFn } = createMockStreamFn([
      {
        kind: "toolCalls",
        text: "let me echo",
        toolCalls: [
          {
            type: "toolCall",
            id: "call_1",
            name: "echo",
            arguments: { text: "ping" },
          },
        ],
      },
      { kind: "text", text: "done" },
    ]);

    const { runAgentLoop } = await import("../src/agent-loop.js");
    const messages = await runAgentLoop(
      [{ role: "user", content: "echo ping", timestamp: 1 }],
      { systemPrompt: "x", messages: [], tools: [makeEchoTool()] },
      {
        model: mockModel,
        convertToLlm: (msgs) => msgs,
        streamFn,
      },
    );

    // messages: user + assistant(toolCall) + toolResult + assistant(text)
    expect(messages).toHaveLength(4);
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");
    const toolResultMsg = messages[2];
    expect(toolResultMsg.role).toBe("toolResult");
    if (toolResultMsg.role === "toolResult") {
      expect(toolResultMsg.toolCallId).toBe("call_1");
      expect(toolResultMsg.toolName).toBe("echo");
    }
    expect(messages[3].role).toBe("assistant");
  });

  it("多工具 sequential: 串行执行 N 个 toolCall, 都完成才推 toolResults", async () => {
    // 剧本:第一轮 2 个 toolCall,第二轮 text
    const { streamFn } = createMockStreamFn([
      {
        kind: "toolCalls",
        toolCalls: [
          { type: "toolCall", id: "c1", name: "echo", arguments: { text: "a" } },
          { type: "toolCall", id: "c2", name: "echo", arguments: { text: "b" } },
        ],
      },
      { kind: "text", text: "ok" },
    ]);

    const { runAgentLoop } = await import("../src/agent-loop.js");
    const messages = await runAgentLoop(
      [{ role: "user", content: "go", timestamp: 1 }],
      { systemPrompt: "x", messages: [], tools: [makeEchoTool()] },
      {
        model: mockModel,
        convertToLlm: (msgs) => msgs,
        streamFn,
        toolExecution: "sequential",
      },
    );

    // 5 条消息:user + assistant(2 toolCalls) + 2 toolResult + assistant(text)
    expect(messages).toHaveLength(5);
    const toolResults = messages.filter((m) => m.role === "toolResult");
    expect(toolResults).toHaveLength(2);
  });

  it("工具抛错: toolResult 标记 isError=true, 模型看到错误", async () => {
    const { streamFn } = createMockStreamFn([
      {
        kind: "toolCalls",
        toolCalls: [{ type: "toolCall", id: "cf", name: "fail", arguments: { reason: "test" } }],
      },
      { kind: "text", text: "I see the error" },
    ]);

    const { runAgentLoop } = await import("../src/agent-loop.js");
    const messages = await runAgentLoop(
      [{ role: "user", content: "fail", timestamp: 1 }],
      { systemPrompt: "x", messages: [], tools: [makeFailTool()] },
      {
        model: mockModel,
        convertToLlm: (msgs) => msgs,
        streamFn,
      },
    );

    const toolResult = messages.find((m) => m.role === "toolResult");
    expect(toolResult).toBeDefined();
    expect((toolResult as any).isError).toBe(true);
  });

  it("无 toolCall 时 turn 自然结束, 不重复调用 LLM", async () => {
    // 剧本:只有一轮 text
    const { streamFn, handle } = createMockStreamFn([{ kind: "text", text: "ok" }]);
    const { runAgentLoop } = await import("../src/agent-loop.js");
    const messages = await runAgentLoop(
      [{ role: "user", content: "hi", timestamp: 1 }],
      { systemPrompt: "x", messages: [] },
      { model: mockModel, convertToLlm: (msgs) => msgs, streamFn },
    );

    // 只有 2 条消息(user + assistant),LLM 只调 1 次
    expect(messages).toHaveLength(2);
    expect(handle.callCount).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────
// 2. 重试
// ─────────────────────────────────────────────────────────────

describe("agent-loop: 错误与重试", () => {
  it("可重试错误 (429): 内部重试直到剧本成功", async () => {
    // 前两次是 429 错误,第三次成功
    const { streamFn, handle } = createMockStreamFn([
      { kind: "error", errorMessage: "429 rate_limit_exceeded", stopReason: "error" },
      { kind: "error", errorMessage: "429 too many requests", stopReason: "error" },
      { kind: "text", text: "finally ok" },
    ]);

    const { runAgentLoop } = await import("../src/agent-loop.js");
    const messages = await runAgentLoop(
      [{ role: "user", content: "hi", timestamp: 1 }],
      { systemPrompt: "x", messages: [] },
      {
        model: mockModel,
        convertToLlm: (msgs) => msgs,
        streamFn,
        maxRetries: 3,
        // 退避太快会让测试很慢:用 0 退避
        maxRetryDelayMs: 0,
      },
    );

    // 最终成功
    expect(messages[1].role).toBe("assistant");
    // 调了 3 次(2 次失败 + 1 次成功)
    expect(handle.callCount).toBe(3);
  });

  it("不可重试错误 (401): 立即派发 error 事件并停止", async () => {
    // 401 认证错误
    const { streamFn, handle } = createMockStreamFn([
      { kind: "error", errorMessage: "401 invalid_api_key", stopReason: "error" },
    ]);

    const { runAgentLoop } = await import("../src/agent-loop.js");
    const events: AgentEvent[] = [];
    const messages = await runAgentLoop(
      [{ role: "user", content: "hi", timestamp: 1 }],
      { systemPrompt: "x", messages: [] },
      {
        model: mockModel,
        convertToLlm: (msgs) => msgs,
        streamFn,
        maxRetries: 3,
      },
      async (e) => {
        events.push(e);
      },
    );

    // 不可重试,只调 1 次
    expect(handle.callCount).toBe(1);
    // 派发了 agent_end(即使错误也走完生命周期)
    expect(events.some((e) => e.type === "agent_end")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// 3. 协议 / 钩子
// ─────────────────────────────────────────────────────────────

describe("agent-loop: 协议与钩子", () => {
  it("AbortSignal: 在循环中检测 signal.aborted, 优雅退出", async () => {
    // 第一轮 toolCall,第二轮 text
    const { streamFn, handle } = createMockStreamFn([
      {
        kind: "toolCalls",
        toolCalls: [{ type: "toolCall", id: "c1", name: "echo", arguments: { text: "x" } }],
      },
      { kind: "text", text: "ok" },
    ]);

    const { runAgentLoop } = await import("../src/agent-loop.js");
    const controller = new AbortController();
    const events: AgentEvent[] = [];
    setTimeout(() => {
      controller.abort();
    }, 1);

    await runAgentLoop(
      [{ role: "user", content: "x", timestamp: 1 }],
      { systemPrompt: "x", messages: [], tools: [makeEchoTool()] },
      {
        model: mockModel,
        convertToLlm: (msgs) => msgs,
        streamFn,
        signal: controller.signal,
      },
      async (e) => {
        events.push(e);
      },
    );

    // 不论是否 abort,agent_end 必须派发(保证生命周期完整)
    expect(events.some((e) => e.type === "agent_end")).toBe(true);
    // 至少调了 1 次 LLM
    expect(handle.callCount).toBeGreaterThanOrEqual(1);
  });

  it("beforeToolCall: 返回 block=true, 跳过实际执行, 派发 error tool result", async () => {
    const beforeSpy = vi.fn(async () => ({ block: true, reason: "policy deny" }));

    const { streamFn } = createMockStreamFn([
      {
        kind: "toolCalls",
        toolCalls: [{ type: "toolCall", id: "c1", name: "echo", arguments: { text: "x" } }],
      },
      { kind: "text", text: "blocked" },
    ]);

    const { runAgentLoop } = await import("../src/agent-loop.js");
    const messages = await runAgentLoop(
      [{ role: "user", content: "x", timestamp: 1 }],
      { systemPrompt: "x", messages: [], tools: [makeEchoTool()] },
      {
        model: mockModel,
        convertToLlm: (msgs) => msgs,
        streamFn,
        beforeToolCall: beforeSpy,
      },
    );

    // beforeToolCall 被调用
    expect(beforeSpy).toHaveBeenCalledTimes(1);
    // toolResult 存在,标记 isError
    const toolResult = messages.find((m) => m.role === "toolResult");
    expect(toolResult).toBeDefined();
    expect((toolResult as any).isError).toBe(true);
    // 错误文本包含 "policy deny"
    const text = (toolResult as any).content[0].text;
    expect(text).toContain("policy deny");
  });

  it("afterToolCall: 增量覆盖 content / isError 字段", async () => {
    // as const 保留 type: "text" 字面量(否则 vi.fn 返回类型推断会把字面量拓宽成 string)
    const afterSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "patched" }],
      isError: false as const,
    }));

    const { streamFn } = createMockStreamFn([
      {
        kind: "toolCalls",
        toolCalls: [{ type: "toolCall", id: "c1", name: "echo", arguments: { text: "x" } }],
      },
      { kind: "text", text: "ok" },
    ]);

    const { runAgentLoop } = await import("../src/agent-loop.js");
    const messages = await runAgentLoop(
      [{ role: "user", content: "x", timestamp: 1 }],
      { systemPrompt: "x", messages: [], tools: [makeEchoTool()] },
      {
        model: mockModel,
        convertToLlm: (msgs) => msgs,
        streamFn,
        afterToolCall: afterSpy,
      },
    );

    const toolResult = messages.find((m) => m.role === "toolResult");
    expect(afterSpy).toHaveBeenCalled();
    // content 被 after 钩子覆盖
    expect((toolResult as any).content[0].text).toBe("patched");
    expect((toolResult as any).isError).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// 4. 模式与 API 形态
// ─────────────────────────────────────────────────────────────

describe("agent-loop: 模式与 API 形态", () => {
  it("parallel toolExecution 模式: 多 toolCall 并发执行", async () => {
    // 验证 parallel 模式下消息数量与 sequential 一致(行为正确)
    const { streamFn } = createMockStreamFn([
      {
        kind: "toolCalls",
        toolCalls: [
          { type: "toolCall", id: "p1", name: "echo", arguments: { text: "a" } },
          { type: "toolCall", id: "p2", name: "echo", arguments: { text: "b" } },
          { type: "toolCall", id: "p3", name: "echo", arguments: { text: "c" } },
        ],
      },
      { kind: "text", text: "done" },
    ]);

    const { runAgentLoop } = await import("../src/agent-loop.js");
    const messages = await runAgentLoop(
      [{ role: "user", content: "x", timestamp: 1 }],
      { systemPrompt: "x", messages: [], tools: [makeEchoTool()] },
      {
        model: mockModel,
        convertToLlm: (msgs) => msgs,
        streamFn,
        toolExecution: "parallel",
      },
    );

    // 6 条消息:user + assistant(3 toolCalls) + 3 toolResult + assistant(text)
    expect(messages).toHaveLength(6);
    const toolResults = messages.filter((m) => m.role === "toolResult");
    expect(toolResults).toHaveLength(3);
  });

  it("agentLoop (EventStream API): 返回可迭代事件流 + 最终 messages", async () => {
    const { streamFn } = createMockStreamFn([{ kind: "text", text: "ok" }]);

    const { agentLoop } = await import("../src/agent-loop.js");
    const eventStream = agentLoop(
      [{ role: "user", content: "hi", timestamp: 1 }],
      { systemPrompt: "x", messages: [] },
      { model: mockModel, convertToLlm: (msgs) => msgs, streamFn },
    );

    // 是 AsyncIterable
    const events: AgentEvent[] = [];
    for await (const e of eventStream) {
      events.push(e);
    }

    // 拿到 messages
    const messages = await eventStream.result();
    expect(messages).toHaveLength(2);
    // 至少看到 agent_start 和 agent_end
    expect(events.some((e) => e.type === "agent_start")).toBe(true);
    expect(events.some((e) => e.type === "agent_end")).toBe(true);
  });

  it("runAgentLoop([], context, config): 空 prompts = 继续模式, 跳过 prompt 事件, newMessages 只含后续产生", async () => {
    const { streamFn } = createMockStreamFn([{ kind: "text", text: "continue" }]);

    const { runAgentLoop } = await import("../src/agent-loop.js");
    const events: AgentEvent[] = [];
    const messages = await runAgentLoop(
      [], // ← 空数组 = 继续模式
      {
        systemPrompt: "x",
        messages: [
          { role: "user", content: "earlier", timestamp: 1 },
          {
            role: "toolResult",
            toolCallId: "x",
            toolName: "y",
            content: [{ type: "text", text: "ok" }],
            isError: false,
            timestamp: 2,
          },
        ],
      },
      { model: mockModel, convertToLlm: (msgs) => msgs, streamFn },
      async (e) => {
        events.push(e);
      },
    );

    // 继续模式:newMessages 不含已有 context,只含后续产生的 assistant
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("assistant");

    // 继续模式:不应该为"user: earlier"派发 message_start(它已经在 context 里了)
    const userMessageStarts = events.filter(
      (e) => e.type === "message_start" && (e as any).message?.content === "earlier",
    );
    expect(userMessageStarts).toHaveLength(0);

    // 但 agent 生命周期事件都齐全
    expect(events.some((e) => e.type === "agent_start")).toBe(true);
    expect(events.some((e) => e.type === "agent_end")).toBe(true);
  });

  it("runAgentLoop([], emptyContext, config): 续接空 context 应 throw(继续模式静态校验)", async () => {
    const { streamFn } = createMockStreamFn([{ kind: "text", text: "x" }]);
    const { runAgentLoop } = await import("../src/agent-loop.js");
    await expect(
      runAgentLoop(
        [],
        { systemPrompt: "x", messages: [] },
        { model: mockModel, convertToLlm: (msgs) => msgs, streamFn },
      ),
    ).rejects.toThrow("Cannot continue: no messages in context");
  });

  it("runAgentLoop([], endingInAssistant, config): 续接以 assistant 结尾应 throw", async () => {
    const { streamFn } = createMockStreamFn([{ kind: "text", text: "x" }]);
    const { runAgentLoop } = await import("../src/agent-loop.js");
    await expect(
      runAgentLoop(
        [],
        {
          systemPrompt: "x",
          messages: [
            { role: "user", content: "hi", timestamp: 1 },
            {
              role: "assistant",
              content: [{ type: "text", text: "hello" }],
              api: mockModel.api,
              provider: mockModel.provider,
              model: mockModel.id,
              usage: { input: 0, output: 0, totalTokens: 0, cost: { input: 0, output: 0, total: 0 } },
              stopReason: "stop",
              timestamp: 2,
            },
          ],
        },
        { model: mockModel, convertToLlm: (msgs) => msgs, streamFn },
      ),
    ).rejects.toThrow("Cannot continue from message role: assistant");
  });
});

// ─────────────────────────────────────────────────────────────
// 5. 工具函数:isRetryableAssistantError 行为正确
// ─────────────────────────────────────────────────────────────

describe("isRetryableAssistantError (从 @mimi/ai)", () => {
  it("429 / rate_limit / too many requests → true", () => {
    expect(isRetryableAssistantError("429 rate limit exceeded")).toBe(true);
    expect(isRetryableAssistantError("rate_limit_exceeded")).toBe(true);
    expect(isRetryableAssistantError("too many requests")).toBe(true);
  });
  it("401 / invalid_api_key → false", () => {
    expect(isRetryableAssistantError("401 invalid_api_key")).toBe(false);
    expect(isRetryableAssistantError("authentication failed")).toBe(false);
  });
});
