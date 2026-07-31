/**
 * compact + compaction-ops 单元测试。
 *
 * 覆盖:
 * - compact() 真实跑通(用 mock model):生成 summary + 派生 CompactionResult
 * - compact() 不写 session(由 harness 负责 appendCompaction)
 * - compact() 接受 customInstructions
 * - runCompactOp 触发 session_before_compact 钩子
 * - 钩子 cancel: true 阻止压缩
 * - 钩子 compaction: 注入已有结果,跳过 LLM
 * - runCompactOp 完成后 emit session_compact
 * - runCompactOp 写 CompactionEntry 到 session
 */

import { describe, expect, it, vi } from "vitest";
import { compact } from "../../../src/harness/compaction/compact.js";
import { runCompactOp, runNavigateTreeOp } from "../../../src/harness/agent-harness/compaction-ops.js";
import { DefaultAgentHarnessHooks } from "../../../src/harness/hooks/index.js";
import type { AgentMessage } from "../../../src/types.js";
import type { SessionTreeEntry } from "../../../src/harness/session/types.js";
import type { Model, AssistantMessage } from "@mimi/ai";
import type { Session } from "../../../src/harness/session/session.js";

const mockModel: Model<any> = {
  id: "test-model",
  name: "Test Model",
  api: "anthropic-messages",
  provider: "anthropic",
  baseUrl: "https://test.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0 },
  contextWindow: 200000,
  maxTokens: 8192,
};

function makeMockStreamFn(
  summaryText: string,
): Parameters<typeof compact>[2] {
  // 显式标注 streamFn 参数类型,避免 Parameters 推导过宽导致子函数参数隐式 any
  const fn: Parameters<typeof compact>[2] = (
    _model: Model<any>,
    _context: { systemPrompt?: string; messages: AgentMessage[] },
    _options?: { signal?: AbortSignal; apiKey?: string },
  ) => {
    const result: AssistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: summaryText }],
      api: mockModel.api,
      provider: mockModel.provider,
      model: mockModel.id,
      usage: { input: 0, output: 0, totalTokens: 0, cost: { input: 0, output: 0, total: 0 } },
      stopReason: "stop",
      timestamp: Date.now(),
    };
    return {
      result: () => Promise.resolve(result),
    };
  };
  return fn;
}

function makeMessageEntry(
  id: string,
  message: AgentMessage,
  parentId: string | null = null,
): SessionTreeEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp: new Date().toISOString(),
    message,
  };
}

/** Mock session,只记录 appendCompaction 调用 */
function makeMockSession(
  entries: SessionTreeEntry[] = [],
  options: { leafId?: string | null } = {},
): Session<any> {
  const appendCompaction = vi.fn(async () => "compaction-id");
  const appendMessage = vi.fn(async () => "message-id");
  const getBranch = vi.fn(async () => entries);
  const getEntries = vi.fn(async () => entries);
  const getLeafId = vi.fn(async () => options.leafId ?? null);
  const setLeafId = vi.fn(async () => {});
  const getMetadata = vi.fn(async () => ({
    id: "test-session",
    createdAt: new Date().toISOString(),
  }));
  const buildContext = vi.fn(async () => ({ messages: [], thinkingLevel: "medium", model: null, activeToolNames: null }));
  const moveTo = vi.fn(async (_id: string | null, summary?: any) =>
    summary ? "branch-id" : undefined,
  );

  return {
    appendCompaction,
    appendMessage,
    getBranch,
    getEntries,
    getLeafId,
    setLeafId,
    getMetadata,
    buildContext,
    moveTo,
  } as any;
}

describe("compact() 底层函数", () => {
  it("调 LLM 生成 CompactionResult", async () => {
    const entries: SessionTreeEntry[] = [
      makeMessageEntry("e1", { role: "user", content: "hi", timestamp: 0 }, null),
    ];
    const session = makeMockSession(entries);
    const streamFn = makeMockStreamFn("Summary text");

    const result = await compact(session, mockModel, streamFn, {
      settings: { keepRecentTokens: 0 }, // 强制压缩
    });

    expect(result.summary).toBe("Summary text");
    expect(result.firstKeptEntryId).toBe("e1");
    expect(result.tokensBefore).toBeGreaterThanOrEqual(0);
    expect(result.details).toBeDefined();
  });

  it("不写 session(由 harness 负责)", async () => {
    const entries: SessionTreeEntry[] = [
      makeMessageEntry("e1", { role: "user", content: "hi", timestamp: 0 }, null),
    ];
    const session = makeMockSession(entries);
    const streamFn = makeMockStreamFn("Summary");

    await compact(session, mockModel, streamFn, { settings: { keepRecentTokens: 0 } });

    expect(session.appendCompaction).not.toHaveBeenCalled();
  });

  it("接受 customInstructions 覆盖 system prompt", async () => {
    const entries: SessionTreeEntry[] = [
      makeMessageEntry("e1", { role: "user", content: "hi", timestamp: 0 }, null),
    ];
    const session = makeMockSession(entries);
    const streamFn = vi.fn(makeMockStreamFn("summary"));

    await compact(session, mockModel, streamFn as any, {
      settings: { keepRecentTokens: 0 },
      customInstructions: "Custom system prompt",
    });

    expect(streamFn).toHaveBeenCalled();
    const ctx = streamFn.mock.calls[0]?.[1] as { systemPrompt: string };
    expect(ctx.systemPrompt).toBe("Custom system prompt");
  });

  it("空 session:返回合理结果", async () => {
    const session = makeMockSession([]);
    const streamFn = makeMockStreamFn("empty summary");

    const result = await compact(session, mockModel, streamFn);
    expect(result.summary).toBe("empty summary");
    // entries 为空:prepareCompaction 返回 firstKeptEntryId = "<empty>"
    expect(result.firstKeptEntryId).toBe("<empty>");
  });

  it("details 包含 readFiles / modifiedFiles / customInstructions", async () => {
    const entries: SessionTreeEntry[] = [
      makeMessageEntry(
        "e1",
        {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "t1",
              name: "read",
              arguments: { path: "/a.txt" },
            },
          ],
          api: "anthropic-messages",
          provider: "anthropic",
          model: mockModel.id,
          usage: { input: 0, output: 0, totalTokens: 0, cost: { input: 0, output: 0, total: 0 } },
          stopReason: "toolUse",
          timestamp: 0,
        },
        null,
      ),
    ];
    const session = makeMockSession(entries);
    const streamFn = makeMockStreamFn("summary");

    const result = await compact(session, mockModel, streamFn, {
      settings: { keepRecentTokens: 0 },
      customInstructions: "Custom",
    });

    expect(result.details?.readFiles).toContain("/a.txt");
    expect(result.details?.customInstructions).toBe("Custom");
  });
});

describe("runCompactOp() 业务编排", () => {
  function makeHooks() {
    return new DefaultAgentHarnessHooks({
      context: { harness: null, session: {}, models: {}, messages: [] },
    });
  }

  it("正常流程:生成 summary + 写 session + emit session_compact", async () => {
    const entries: SessionTreeEntry[] = [
      makeMessageEntry("e1", { role: "user", content: "hi", timestamp: 0 }, null),
    ];
    const session = makeMockSession(entries);
    const hooks = makeHooks();
    const emitSpy = vi.spyOn(hooks, "emit");
    const streamFn = makeMockStreamFn("summary text");

    const result = await runCompactOp({
      session,
      model: mockModel,
      hooks,
      streamFn,
    });

    expect(result?.summary).toBe("summary text");
    expect(session.appendCompaction).toHaveBeenCalledTimes(1);
    expect(emitSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: "session_before_compact" }),
    );
    expect(emitSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: "session_compact" }),
    );
  });

  it("钩子 cancel: true:跳过压缩,返回 undefined", async () => {
    const session = makeMockSession();
    const hooks = makeHooks();
    hooks.on("session_before_compact", () => ({ cancel: true } as any));
    const streamFn = makeMockStreamFn("summary");

    const result = await runCompactOp({
      session,
      model: mockModel,
      hooks,
      streamFn,
    });

    expect(result).toBeUndefined();
    expect(session.appendCompaction).not.toHaveBeenCalled();
  });

  it("钩子 compaction: 注入已有结果,跳过 LLM 调用", async () => {
    const session = makeMockSession();
    const hooks = makeHooks();
    const injectedResult = {
      summary: "Injected summary",
      firstKeptEntryId: "e1",
      tokensBefore: 100,
      details: { readFiles: [], modifiedFiles: [] },
    };
    hooks.on("session_before_compact", () => ({ compaction: injectedResult } as any));
    const streamFn = vi.fn(makeMockStreamFn("not called"));

    const result = await runCompactOp({
      session,
      model: mockModel,
      hooks,
      streamFn: streamFn as any,
    });

    expect(result?.summary).toBe("Injected summary");
    expect(streamFn).not.toHaveBeenCalled();
    expect(session.appendCompaction).toHaveBeenCalledTimes(1);
    // 注入的 compaction 应标记 fromHook = true
    // appendCompaction 签名: (summary, firstKeptEntryId, tokensBefore, details?, fromHook?)
    // 位置 4 = fromHook
    // 用 as any 让 tsc 不收窄:appendCompaction 的真类型是 vi.fn(),带 .mock 属性
    const callArgs = (session as any).appendCompaction.mock.calls[0];
    expect(callArgs?.[4]).toBe(true); // fromHook
  });

  it("空 session:返回 undefined", async () => {
    const hooks = makeHooks();
    const streamFn = makeMockStreamFn("summary");

    const result = await runCompactOp({
      session: null as any,
      model: mockModel,
      hooks,
      streamFn,
    });

    expect(result).toBeUndefined();
  });
});

describe("runNavigateTreeOp() 业务编排", () => {
  function makeHooks() {
    return new DefaultAgentHarnessHooks({
      context: { harness: null, session: {}, models: {}, messages: [] },
    });
  }

  it("正常流程:生成 summary + moveTo + emit session_tree", async () => {
    const entries: SessionTreeEntry[] = [
      makeMessageEntry("leaf", { role: "user", content: "leaf", timestamp: 0 }, "root"),
      makeMessageEntry("root", { role: "user", content: "root", timestamp: 1 }, null),
    ];
    const session = makeMockSession(entries);
    const hooks = makeHooks();
    const emitSpy = vi.spyOn(hooks, "emit");
    const streamFn = makeMockStreamFn("Branch summary");

    const branchId = await runNavigateTreeOp({
      session,
      model: mockModel,
      hooks,
      streamFn,
      targetId: "root",
    });

    expect(branchId).toBe("branch-id");
    expect(session.moveTo).toHaveBeenCalledTimes(1);
    expect(emitSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: "session_before_tree" }),
    );
    expect(emitSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: "session_tree" }),
    );
  });

  it("钩子 cancel: true:跳过跳转,返回 undefined", async () => {
    const session = makeMockSession();
    const hooks = makeHooks();
    hooks.on("session_before_tree", () => ({ cancel: true } as any));
    const streamFn = makeMockStreamFn("summary");

    const result = await runNavigateTreeOp({
      session,
      model: mockModel,
      hooks,
      streamFn,
      targetId: "root",
    });

    expect(result).toBeUndefined();
    expect(session.moveTo).not.toHaveBeenCalled();
  });

  it("钩子 summary 注入:跳过 LLM", async () => {
    const session = makeMockSession();
    const hooks = makeHooks();
    hooks.on("session_before_tree", () => ({
      summary: { summary: "Injected", details: { customInstructions: "x" } },
    } as any));
    const streamFn = vi.fn(makeMockStreamFn("not called"));

    const branchId = await runNavigateTreeOp({
      session,
      model: mockModel,
      hooks,
      streamFn: streamFn as any,
      targetId: "root",
    });

    expect(branchId).toBe("branch-id");
    expect(streamFn).not.toHaveBeenCalled();
    // moveTo 是 vi.fn(),用 (session as any) 让 tsc 不收窄
    const moveToArgs = (session as any).moveTo.mock.calls[0];
    expect(moveToArgs?.[1]?.fromHook).toBe(true);
  });

  it("targetId = null:切到空 leaf,仍调 LLM", async () => {
    const session = makeMockSession();
    const hooks = makeHooks();
    const streamFn = vi.fn(makeMockStreamFn("summary"));

    const branchId = await runNavigateTreeOp({
      session,
      model: mockModel,
      hooks,
      streamFn: streamFn as any,
      targetId: null,
    });

    expect(streamFn).toHaveBeenCalled();
    expect(session.moveTo).toHaveBeenCalledWith(null, expect.any(Object));
    expect(branchId).toBe("branch-id");
  });
});
