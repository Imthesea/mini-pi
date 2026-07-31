/**
 * context-builder.ts 纯函数测试。
 *
 * 覆盖:
 * - defaultContextEntryTransform:无 compaction / 有 compaction
 * - buildContextEntries:叠加 transforms
 * - sessionEntryToContextMessages:各种 entry 类型的转换
 * - buildSessionContext:完整 SessionContext 派生
 */

import { describe, expect, it } from "vitest";
import {
  buildContextEntries,
  buildSessionContext,
  defaultContextEntryTransform,
  sessionEntryToContextMessages,
} from "../../../src/harness/session/context-builder.js";
import type {
  AssistantMessage,
  SessionTreeEntry,
  UserMessage,
} from "../../../src/harness/session/types.js";

function userMsg(id: string, parentId: string | null, text: string): SessionTreeEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp: "2026-01-01T00:00:00Z",
    message: { role: "user", content: text, timestamp: 0 } as UserMessage,
  };
}
function assistantMsg(id: string, parentId: string | null): SessionTreeEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp: "2026-01-01T00:00:01Z",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "ok" }],
      api: "anthropic-messages",
      provider: "anthropic",
      model: "claude-3-5-sonnet",
      usage: { input: 0, output: 0, totalTokens: 0, cost: { input: 0, output: 0, total: 0 } },
      stopReason: "stop",
      timestamp: 0,
    } as AssistantMessage,
  };
}
function comp(id: string, parentId: string | null, firstKept: string): SessionTreeEntry {
  return {
    type: "compaction",
    id,
    parentId,
    timestamp: "2026-01-01T00:00:02Z",
    summary: "summary",
    firstKeptEntryId: firstKept,
    tokensBefore: 100,
  };
}

describe("defaultContextEntryTransform", () => {
  it("无 compaction:返回原 entries 拷贝", () => {
    const entries: SessionTreeEntry[] = [
      userMsg("a", null, "x"),
      userMsg("b", "a", "y"),
    ];
    expect(defaultContextEntryTransform(entries)).toEqual(entries);
  });

  it("有 compaction:跳过 firstKeptEntryId 之前的部分,保留 compaction + 之后", () => {
    const entries: SessionTreeEntry[] = [
      userMsg("a", null, "x"),
      userMsg("b", "a", "y"),
      userMsg("c", "b", "z"),
      comp("k", "c", "c"),
      userMsg("d", "k", "after"),
    ];
    const result = defaultContextEntryTransform(entries);
    expect(result.map((e) => e.id)).toEqual(["k", "c", "d"]);
  });

  it("compaction 之前的 firstKeptEntryId 之后的 entries 保留", () => {
    const entries: SessionTreeEntry[] = [
      userMsg("a", null, "1"),
      userMsg("b", "a", "2"),
      userMsg("c", "b", "3"),
      comp("k", "c", "b"), // firstKept = b
    ];
    const result = defaultContextEntryTransform(entries);
    // [k, b, c] — a 被压缩,b/c 保留
    expect(result.map((e) => e.id)).toEqual(["k", "b", "c"]);
  });

  it("多条 compaction:用最后一条", () => {
    const entries: SessionTreeEntry[] = [
      userMsg("a", null, "1"),
      userMsg("b", "a", "2"),
      comp("k1", "b", "b"),
      userMsg("c", "k1", "3"),
      comp("k2", "c", "c"),
    ];
    const result = defaultContextEntryTransform(entries);
    // 最后一条 compaction 是 k2,firstKept=c → [k2, c]
    expect(result.map((e) => e.id)).toEqual(["k2", "c"]);
  });
});

describe("buildContextEntries — transforms 叠加", () => {
  it("调用方 transforms 在默认 transform 之后应用", () => {
    const entries: SessionTreeEntry[] = [
      userMsg("a", null, "1"),
      userMsg("b", "a", "2"),
    ];
    const result = buildContextEntries(entries, {
      entryTransforms: [
        (es) => es.filter((e) => e.id !== "a"),
      ],
    });
    expect(result.map((e) => e.id)).toEqual(["b"]);
  });
});

describe("sessionEntryToContextMessages", () => {
  it("message entry → [entry.message]", () => {
    const e = userMsg("a", null, "hi");
    const result = sessionEntryToContextMessages(e, 0, [e]);
    expect(result).toHaveLength(1);
    expect((result[0] as UserMessage).content).toBe("hi");
  });

  it("compaction entry → [compaction_summary custom message]", () => {
    const e: SessionTreeEntry = {
      type: "compaction",
      id: "k",
      parentId: null,
      timestamp: "2026-01-01",
      summary: "sum",
      firstKeptEntryId: "x",
      tokensBefore: 100,
    };
    const result = sessionEntryToContextMessages(e, 0, [e]);
    expect(result).toHaveLength(1);
    expect((result[0] as any).customType).toBe("compaction_summary");
  });

  it("branch_summary entry → [branch_summary custom message]", () => {
    const e: SessionTreeEntry = {
      type: "branch_summary",
      id: "b",
      parentId: null,
      timestamp: "2026-01-01",
      fromId: "x",
      summary: "branch!",
    };
    const result = sessionEntryToContextMessages(e, 0, [e]);
    expect(result).toHaveLength(1);
    expect((result[0] as any).customType).toBe("branch_summary");
  });

  it("custom entry 无 projector → []", () => {
    const e: SessionTreeEntry = {
      type: "custom",
      id: "x",
      parentId: null,
      timestamp: "2026-01-01",
      customType: "noise",
      data: 1,
    };
    expect(sessionEntryToContextMessages(e, 0, [e])).toEqual([]);
  });

  it("label / leaf / thinking_level_change / model_change → []", () => {
    const entries: SessionTreeEntry[] = [
      { type: "label", id: "l", parentId: null, timestamp: "", targetId: "x", label: "y" },
      { type: "leaf", id: "lf", parentId: null, timestamp: "", targetId: "x" },
      { type: "thinking_level_change", id: "t", parentId: null, timestamp: "", thinkingLevel: "high" },
      { type: "model_change", id: "m", parentId: null, timestamp: "", provider: "p", modelId: "id" },
    ];
    for (const e of entries) {
      expect(sessionEntryToContextMessages(e, 0, [e])).toEqual([]);
    }
  });
});

describe("buildSessionContext", () => {
  it("派生 state + messages", () => {
    const entries: SessionTreeEntry[] = [
      userMsg("a", null, "1"),
      assistantMsg("b", "a"),
      { type: "thinking_level_change", id: "t", parentId: "b", timestamp: "", thinkingLevel: "high" },
    ];
    const ctx = buildSessionContext(entries);
    expect(ctx.thinkingLevel).toBe("high");
    expect(ctx.model).toEqual({ provider: "anthropic", modelId: "claude-3-5-sonnet" });
    expect(ctx.messages).toHaveLength(2);
  });

  it("无 assistant message 时 model 为 null", () => {
    const entries: SessionTreeEntry[] = [userMsg("a", null, "1")];
    const ctx = buildSessionContext(entries);
    expect(ctx.model).toBeNull();
  });

  it("active_tools_change 派生 activeToolNames", () => {
    const entries: SessionTreeEntry[] = [
      userMsg("a", null, "1"),
      {
        type: "active_tools_change",
        id: "at",
        parentId: "a",
        timestamp: "",
        activeToolNames: ["x", "y"],
      },
    ];
    const ctx = buildSessionContext(entries);
    expect(ctx.activeToolNames).toEqual(["x", "y"]);
  });
});
