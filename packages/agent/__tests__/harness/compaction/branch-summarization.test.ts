/**
 * branch-summarization 单元测试。
 *
 * 覆盖:
 * - collectEntriesForBranchSummary 收集"被丢弃"entries
 * - collectEntriesForBranchSummary targetId 不在 entries 中时返回空
 * - collectEntriesForBranchSummary targetId 是 root 时返回全部
 * - generateBranchSummary 调 LLM 生成 summary
 * - generateBranchSummary 接受 customInstructions
 */

import { describe, expect, it, vi } from "vitest";
import {
  collectEntriesForBranchSummary,
  generateBranchSummary,
} from "../../../src/harness/compaction/branch-summarization.js";
import type { AgentMessage } from "../../../src/types.js";
import type { SessionTreeEntry } from "../../../src/harness/session/types.js";
import type { Model, AssistantMessage } from "@mimi/ai";

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

describe("collectEntriesForBranchSummary", () => {
  it("targetId 是中间:返回 targetId 之后的 entries(不含 targetId)", () => {
    const entries: SessionTreeEntry[] = [
      makeMessageEntry("leaf", { role: "user", content: "leaf", timestamp: 0 }, "mid"),
      makeMessageEntry("mid", { role: "user", content: "mid", timestamp: 1 }, "root"),
      makeMessageEntry("root", { role: "user", content: "root", timestamp: 2 }, null),
    ];
    // targetId = "mid":丢弃 leaf
    const result = collectEntriesForBranchSummary(entries, "mid");
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("leaf");
  });

  it("targetId 是 root(最后一条):返回空数组", () => {
    const entries: SessionTreeEntry[] = [
      makeMessageEntry("leaf", { role: "user", content: "leaf", timestamp: 0 }, "root"),
      makeMessageEntry("root", { role: "user", content: "root", timestamp: 1 }, null),
    ];
    const result = collectEntriesForBranchSummary(entries, "root");
    expect(result).toHaveLength(0);
  });

  it("targetId 不在 entries 中:返回空数组(不抛错)", () => {
    const entries: SessionTreeEntry[] = [
      makeMessageEntry("leaf", { role: "user", content: "leaf", timestamp: 0 }, "root"),
      makeMessageEntry("root", { role: "user", content: "root", timestamp: 1 }, null),
    ];
    const result = collectEntriesForBranchSummary(entries, "nonexistent");
    expect(result).toHaveLength(0);
  });

  it("空 entries 返回空数组", () => {
    const result = collectEntriesForBranchSummary([], "any");
    expect(result).toEqual([]);
  });
});

describe("generateBranchSummary", () => {
  function makeMockStreamFn(
    summaryText: string,
  ): Parameters<typeof generateBranchSummary>[3] {
    const fn: Parameters<typeof generateBranchSummary>[3] = (
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

  it("调 LLM 生成 summary", async () => {
    const entries: SessionTreeEntry[] = [
      makeMessageEntry("leaf", { role: "user", content: "hi", timestamp: 0 }, "root"),
      makeMessageEntry("root", { role: "user", content: "root", timestamp: 1 }, null),
    ];
    const streamFn = makeMockStreamFn("This is a summary");

    const result = await generateBranchSummary(
      entries,
      "root",
      mockModel,
      streamFn,
    );

    expect(result.summary).toBe("This is a summary");
    expect(result.details).toBeDefined();
    expect(result.details?.customInstructions).toBeUndefined();
  });

  it("接受 customInstructions(覆盖默认 system prompt)", async () => {
    const entries: SessionTreeEntry[] = [
      makeMessageEntry("leaf", { role: "user", content: "hi", timestamp: 0 }, "root"),
      makeMessageEntry("root", { role: "user", content: "root", timestamp: 1 }, null),
    ];
    const streamFn = vi.fn(makeMockStreamFn("Custom summary"));

    await generateBranchSummary(entries, "root", mockModel, streamFn as any, {
      customInstructions: "Custom instruction here",
    });

    expect(streamFn).toHaveBeenCalled();
    // 第二次调用参数 (model, context, options)
    const callArgs = streamFn.mock.calls[0];
    const ctx = callArgs?.[1] as { systemPrompt: string; messages: AgentMessage[] };
    expect(ctx.systemPrompt).toBe("Custom instruction here");
  });

  it("接受 apiKey + signal 选项", async () => {
    const entries: SessionTreeEntry[] = [
      makeMessageEntry("leaf", { role: "user", content: "hi", timestamp: 0 }, "root"),
      makeMessageEntry("root", { role: "user", content: "root", timestamp: 1 }, null),
    ];
    const streamFn = vi.fn(makeMockStreamFn("test"));

    const controller = new AbortController();
    await generateBranchSummary(entries, "root", mockModel, streamFn as any, {
      apiKey: "test-key",
      signal: controller.signal,
    });

    expect(streamFn).toHaveBeenCalled();
    const options = streamFn.mock.calls[0]?.[2] as
      | { apiKey?: string; signal?: AbortSignal }
      | undefined;
    expect(options?.apiKey).toBe("test-key");
    expect(options?.signal).toBe(controller.signal);
  });

  it("targetId 不在 entries 中:返回空 discarded,但仍调 LLM", async () => {
    const entries: SessionTreeEntry[] = [
      makeMessageEntry("root", { role: "user", content: "hi", timestamp: 0 }, null),
    ];
    const streamFn = vi.fn(makeMockStreamFn("summary"));

    const result = await generateBranchSummary(
      entries,
      "nonexistent",
      mockModel,
      streamFn as any,
    );

    expect(streamFn).toHaveBeenCalled();
    expect(result.summary).toBe("summary");
  });

  it("LLM 返回空文本:summary 为空字符串", async () => {
    const entries: SessionTreeEntry[] = [
      makeMessageEntry("leaf", { role: "user", content: "hi", timestamp: 0 }, "root"),
      makeMessageEntry("root", { role: "user", content: "root", timestamp: 1 }, null),
    ];
    const streamFn = makeMockStreamFn("");

    const result = await generateBranchSummary(
      entries,
      "root",
      mockModel,
      streamFn,
    );
    expect(result.summary).toBe("");
  });
});
