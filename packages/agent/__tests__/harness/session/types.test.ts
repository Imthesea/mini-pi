/**
 * Session 树形 entry 类型测试。
 *
 * 覆盖 SessionTreeEntry 联合 + 各变体的类型守卫 + 关键派生类型。
 */

import { describe, expect, expectTypeOf, it } from "vitest";
import { SessionError } from "../../../src/harness/session/types.js";
import type {
  ActiveToolsChangeEntry,
  BranchSummaryEntry,
  CompactionEntry,
  CustomEntry,
  CustomMessageEntry,
  JsonlSessionMetadata,
  LabelEntry,
  LeafEntry,
  MessageEntry,
  ModelChangeEntry,
  SessionContext,
  SessionMetadata,
  SessionTreeEntry,
  ThinkingLevelChangeEntry,
} from "../../../src/harness/session/types.js";

describe("session/types — SessionTreeEntry 联合", () => {
  it("应该接受所有 11 种 entry 变体", () => {
    // message
    const msg: MessageEntry = {
      type: "message",
      id: "m1",
      parentId: null,
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "user",
        content: "hi",
        timestamp: Date.now(),
      },
    };

    // thinking_level_change
    const thinking: ThinkingLevelChangeEntry = {
      type: "thinking_level_change",
      id: "t1",
      parentId: "m1",
      timestamp: "2026-01-01T00:00:01Z",
      thinkingLevel: "high",
    };

    // model_change
    const modelChange: ModelChangeEntry = {
      type: "model_change",
      id: "mc1",
      parentId: "t1",
      timestamp: "2026-01-01T00:00:02Z",
      provider: "anthropic",
      modelId: "claude-3-5-sonnet",
    };

    // active_tools_change
    const tools: ActiveToolsChangeEntry = {
      type: "active_tools_change",
      id: "at1",
      parentId: "mc1",
      timestamp: "2026-01-01T00:00:03Z",
      activeToolNames: ["echo", "read"],
    };

    // compaction
    const comp: CompactionEntry = {
      type: "compaction",
      id: "c1",
      parentId: "at1",
      timestamp: "2026-01-01T00:00:04Z",
      summary: "short summary",
      firstKeptEntryId: "at1",
      tokensBefore: 1000,
    };

    // branch_summary
    const branch: BranchSummaryEntry = {
      type: "branch_summary",
      id: "b1",
      parentId: "c1",
      timestamp: "2026-01-01T00:00:05Z",
      fromId: "c1",
      summary: "branch summary",
    };

    // custom
    const custom: CustomEntry = {
      type: "custom",
      id: "x1",
      parentId: "b1",
      timestamp: "2026-01-01T00:00:06Z",
      customType: "myType",
      data: { foo: 1 },
    };

    // custom_message
    const customMsg: CustomMessageEntry = {
      type: "custom_message",
      id: "cm1",
      parentId: "x1",
      timestamp: "2026-01-01T00:00:07Z",
      customType: "myType",
      content: "hello",
      display: true,
    };

    // label
    const label: LabelEntry = {
      type: "label",
      id: "l1",
      parentId: "cm1",
      timestamp: "2026-01-01T00:00:08Z",
      targetId: "m1",
      label: "first msg",
    };

    // session_info (alias for session_info_entry)
    const info = {
      type: "session_info",
      id: "si1",
      parentId: "l1",
      timestamp: "2026-01-01T00:00:09Z",
      name: "my session",
    } as const;

    // leaf
    const leaf: LeafEntry = {
      type: "leaf",
      id: "lf1",
      parentId: info.id,
      timestamp: "2026-01-01T00:00:10Z",
      targetId: "m1",
    };

    // 全部能赋值给 SessionTreeEntry
    const all: SessionTreeEntry[] = [
      msg,
      thinking,
      modelChange,
      tools,
      comp,
      branch,
      custom,
      customMsg,
      label,
      info as unknown as SessionTreeEntry,
      leaf,
    ];
    expect(all).toHaveLength(11);
  });

  it("SessionTreeEntry 联合应包含所有 11 个 type 字面量", () => {
    type EntryType = SessionTreeEntry["type"];
    expectTypeOf<EntryType>().toEqualTypeOf<
      | "message"
      | "thinking_level_change"
      | "model_change"
      | "active_tools_change"
      | "compaction"
      | "branch_summary"
      | "custom"
      | "custom_message"
      | "label"
      | "session_info"
      | "leaf"
    >();
  });

  it("所有 entry 变体应共享 base 字段 id / parentId / timestamp", () => {
    const e: SessionTreeEntry = {
      type: "message",
      id: "x",
      parentId: null,
      timestamp: "now",
      message: { role: "user", content: "hi", timestamp: 1 },
    };
    expect(e.id).toBe("x");
    expect(e.parentId).toBeNull();
    expect(e.timestamp).toBe("now");
  });
});

describe("session/types — SessionMetadata", () => {
  it("SessionMetadata 应有 id / createdAt", () => {
    const m: SessionMetadata = {
      id: "abc",
      createdAt: "2026-01-01T00:00:00Z",
    };
    expect(m.id).toBe("abc");
  });

  it("JsonlSessionMetadata 应继承 SessionMetadata + 加 cwd / path", () => {
    const m: JsonlSessionMetadata = {
      id: "abc",
      createdAt: "2026-01-01T00:00:00Z",
      cwd: "/tmp",
      path: "/tmp/sessions/abc.jsonl",
    };
    expect(m.cwd).toBe("/tmp");
    expect(m.path).toBe("/tmp/sessions/abc.jsonl");
  });

  it("JsonlSessionMetadata 应支持可选 parentSessionPath / metadata", () => {
    const m: JsonlSessionMetadata = {
      id: "abc",
      createdAt: "2026-01-01T00:00:00Z",
      cwd: "/tmp",
      path: "/tmp/sessions/abc.jsonl",
      parentSessionPath: "/tmp/sessions/parent.jsonl",
      metadata: { foo: "bar" },
    };
    expect(m.parentSessionPath).toBe("/tmp/sessions/parent.jsonl");
    expect(m.metadata?.foo).toBe("bar");
  });
});

describe("session/types — SessionContext", () => {
  it("SessionContext 应包含 messages + thinkingLevel + model + activeToolNames", () => {
    const ctx: SessionContext = {
      messages: [],
      thinkingLevel: "off",
      model: { provider: "anthropic", modelId: "claude-3-5-sonnet" },
      activeToolNames: null,
    };
    expect(ctx.thinkingLevel).toBe("off");
    expect(ctx.model?.modelId).toBe("claude-3-5-sonnet");
  });

  it("SessionContext 的 model / activeToolNames 允许 null", () => {
    const ctx: SessionContext = {
      messages: [],
      thinkingLevel: "off",
      model: null,
      activeToolNames: null,
    };
    expect(ctx.model).toBeNull();
    expect(ctx.activeToolNames).toBeNull();
  });
});

describe("session/types — SessionError", () => {
  it("SessionError 应该有 code 字段和 SessionError 名字", () => {
    const err = new SessionError("not_found", "Entry not found");
    expect(err.code).toBe("not_found");
    expect(err.name).toBe("SessionError");
    expect(err.message).toBe("Entry not found");
  });

  it("SessionError 应该支持 cause 透传", () => {
    const cause = new Error("underlying");
    const err = new SessionError("storage", "Storage error", cause);
    expect(err.cause).toBe(cause);
  });

  it("SessionError code 应是有限的字面量联合", () => {
    type Code = SessionError["code"];
    expectTypeOf<Code>().toEqualTypeOf<
      "not_found" | "invalid_session" | "invalid_entry" | "invalid_fork_target" | "storage" | "unknown"
    >();
  });

  it("SessionError 应该是 Error 的实例", () => {
    const err = new SessionError("unknown", "boom");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SessionError);
  });
});
