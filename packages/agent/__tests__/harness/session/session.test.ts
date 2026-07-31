/**
 * Session 主类测试。
 *
 * 覆盖:
 * - 基础查询:getMetadata / getLeafId / getEntry / getEntries / getBranch
 * - appendXxx:Message / ThinkingLevel / Model / ActiveTools / Compaction / Custom / Label / SessionName
 * - moveTo:切换 leaf + 追加 BranchSummaryEntry
 * - buildContext:压缩感知 + 默认过滤 custom + entryProjectors 投影
 * - 异常:appendLabel 指向不存在的 entry / moveTo 指向不存在的 entry
 */

import { beforeEach, describe, expect, it } from "vitest";
import { Session } from "../../../src/harness/session/session.js";
import { InMemorySessionStorage } from "../../../src/harness/session/repos/memory-storage.js";
import type {
  AgentMessage,
  CustomEntry,
  SessionTreeEntry,
  UserMessage,
  AssistantMessage,
} from "../../../src/harness/session/types.js";
import { SessionError } from "../../../src/harness/session/types.js";

// 工厂
function userMsg(text: string, timestamp = Date.now()): UserMessage {
  return { role: "user", content: text, timestamp };
}
function assistantMsg(text: string, model = "claude-3-5-sonnet", timestamp = Date.now()): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "anthropic-messages",
    provider: "anthropic",
    model,
    usage: { input: 1, output: 1, totalTokens: 2, cost: { input: 0, output: 0, total: 0 } },
    stopReason: "stop",
    timestamp,
  };
}

describe("Session — 基础查询", () => {
  let s: Session;
  beforeEach(() => {
    s = new Session(new InMemorySessionStorage());
  });

  it("getMetadata / getLeafId 初始状态", async () => {
    const meta = await s.getMetadata();
    expect(meta.id).toBeTruthy();
    expect(await s.getLeafId()).toBeNull();
  });

  it("getStorage 返回内部 storage 引用", () => {
    const storage = s.getStorage();
    expect(storage).toBeInstanceOf(InMemorySessionStorage);
  });

  it("getBranch 空 session 返回 []", async () => {
    expect(await s.getBranch()).toEqual([]);
  });

  it("getBranch(从指定 id) 沿 parentId 回溯", async () => {
    const id1 = await s.appendMessage(userMsg("a"));
    const id2 = await s.appendMessage(userMsg("b"));
    const id3 = await s.appendMessage(userMsg("c"));
    const path = await s.getBranch(id3);
    expect(path.map((e) => e.id)).toEqual([id1, id2, id3]);
  });
});

describe("Session — appendXxx", () => {
  let s: Session;
  beforeEach(() => {
    s = new Session(new InMemorySessionStorage());
  });

  it("appendMessage 追加后 getEntries 包含", async () => {
    await s.appendMessage(userMsg("hi"));
    const entries = await s.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.type).toBe("message");
  });

  it("appendThinkingLevelChange 记录变更", async () => {
    const id = await s.appendThinkingLevelChange("high");
    const entry = (await s.getEntry(id))!;
    expect(entry?.type).toBe("thinking_level_change");
    if (entry?.type === "thinking_level_change") {
      expect(entry.thinkingLevel).toBe("high");
    }
  });

  it("appendModelChange 记录 model 切换", async () => {
    const id = await s.appendModelChange("anthropic", "claude-3-5-sonnet");
    const entry = (await s.getEntry(id))!;
    expect(entry?.type).toBe("model_change");
  });

  it("appendActiveToolsChange 复制 activeToolNames 防止外部修改影响", async () => {
    const tools = ["a", "b"];
    const id = await s.appendActiveToolsChange(tools);
    tools.push("c");
    const entry = (await s.getEntry(id))!;
    if (entry?.type === "active_tools_change") {
      expect(entry.activeToolNames).toEqual(["a", "b"]);
    }
  });

  it("appendCompaction 记录压缩", async () => {
    const id1 = await s.appendMessage(userMsg("a"));
    const id = await s.appendCompaction("summary", id1, 1000, { foo: 1 });
    const entry = (await s.getEntry(id))!;
    expect(entry?.type).toBe("compaction");
    if (entry?.type === "compaction") {
      expect(entry.firstKeptEntryId).toBe(id1);
      expect(entry.tokensBefore).toBe(1000);
      expect(entry.details).toEqual({ foo: 1 });
    }
  });

  it("appendCustomEntry 记录声明合并扩展点", async () => {
    const id = await s.appendCustomEntry("myType", { data: 1 });
    const entry = (await s.getEntry(id))!;
    expect(entry?.type).toBe("custom");
  });

  it("appendCustomMessageEntry 记录 custom_message", async () => {
    const id = await s.appendCustomMessageEntry("note", "hello", true, { k: 1 });
    const entry = (await s.getEntry(id))!;
    expect(entry?.type).toBe("custom_message");
  });

  it("appendLabel 追加 label entry", async () => {
    const id1 = await s.appendMessage(userMsg("a"));
    const lid = await s.appendLabel(id1, "first");
    expect(await s.getLabel(id1)).toBe("first");
    expect((await s.getEntry(lid))?.type).toBe("label");
  });

  it("appendLabel 指向不存在的 entry 抛 not_found", async () => {
    await expect(s.appendLabel("missing", "x")).rejects.toThrow(SessionError);
  });

  it("appendSessionName 去除换行", async () => {
    const id = await s.appendSessionName("my\nname\rwith\nnewlines");
    const entry = (await s.getEntry(id))!;
    if (entry?.type === "session_info") {
      expect(entry.name).toBe("my name with newlines");
    }
  });

  it("getSessionName 读取最近一条 session_info 的 name", async () => {
    await s.appendSessionName("first");
    await s.appendSessionName("second");
    expect(await s.getSessionName()).toBe("second");
  });

  it("getSessionName 无 name 时返回 undefined", async () => {
    expect(await s.getSessionName()).toBeUndefined();
  });
});

describe("Session — moveTo", () => {
  let s: Session;
  beforeEach(async () => {
    s = new Session(new InMemorySessionStorage());
    await s.appendMessage(userMsg("a"));
  });

  it("moveTo(null) 切到空", async () => {
    await s.moveTo(null);
    expect(await s.getLeafId()).toBeNull();
  });

  it("moveTo(id) 切到指定 entry", async () => {
    const entries = await s.getEntries();
    const e1 = entries[0]!;
    await s.moveTo(e1.id);
    expect(await s.getLeafId()).toBe(e1.id);
  });

  it("moveTo + summary 追加 BranchSummaryEntry", async () => {
    const e1 = (await s.getEntries())[0]!;
    const summaryId = await s.moveTo(e1.id, { summary: "branch!" });
    expect(summaryId).toBeTruthy();
    const entry = (await s.getEntry(summaryId!))!;
    expect(entry?.type).toBe("branch_summary");
  });

  it("moveTo 不传 summary 不追加 BranchSummaryEntry", async () => {
    const e1 = (await s.getEntries())[0]!;
    const result = await s.moveTo(e1.id);
    expect(result).toBeUndefined();
  });

  it("moveTo 指向不存在的 entry 抛 not_found", async () => {
    await expect(s.moveTo("missing")).rejects.toThrow(SessionError);
  });
});

describe("Session — buildContext(压缩感知 + custom 投影)", () => {
  it("buildContext 默认过滤 custom entry", async () => {
    const s = new Session(new InMemorySessionStorage());
    await s.appendMessage(userMsg("a"));
    await s.appendCustomEntry("noise", { data: 1 });
    await s.appendMessage(userMsg("b"));
    const ctx = await s.buildContext();
    const userMsgs = ctx.messages.filter((m) => m.role === "user");
    expect(userMsgs).toHaveLength(2);
  });

  it("buildContext 接受 entryProjectors 把 custom 投影为消息", async () => {
    const s = new Session(new InMemorySessionStorage());
    await s.appendMessage(userMsg("a"));
    const cid = await s.appendCustomEntry("notice", { text: "notice!" });
    await s.appendMessage(userMsg("b"));
    const ctx = await s.buildContext({
      entryProjectors: {
        notice: (entry: CustomEntry): readonly AgentMessage[] => {
          if (entry.type === "custom" && entry.data) {
            return [
              {
                role: "user",
                content: (entry.data as { text: string }).text,
                timestamp: Date.now(),
              },
            ];
          }
          return [];
        },
      },
    });
    const userMsgs = ctx.messages.filter((m) => m.role === "user");
    expect(userMsgs).toHaveLength(3);
  });

  it("buildContext 压缩感知:被 compaction 覆盖的 entry 不出现", async () => {
    const s = new Session(new InMemorySessionStorage());
    const id1 = await s.appendMessage(userMsg("a"));
    const id2 = await s.appendMessage(userMsg("b"));
    await s.appendMessage(userMsg("c"));
    // 压缩,只保留 id2 之后
    await s.appendCompaction("summary of a", id2, 100);
    const ctx = await s.buildContext();
    const userMsgs = ctx.messages.filter((m) => m.role === "user");
    // 应当是 b、c + compaction summary,不含 a
    expect(userMsgs).toHaveLength(2);
    const customMsgs = ctx.messages.filter(
      (m) => (m as any).role === "custom" && (m as any).customType === "compaction_summary",
    );
    expect(customMsgs).toHaveLength(1);
  });

  it("buildContext 派生 state:thinkingLevel / model / activeToolNames", async () => {
    const s = new Session(new InMemorySessionStorage());
    await s.appendMessage(userMsg("a"));
    await s.appendThinkingLevelChange("high");
    await s.appendModelChange("anthropic", "claude-3-5-sonnet");
    await s.appendActiveToolsChange(["echo"]);
    await s.appendMessage(assistantMsg("hi"));
    const ctx = await s.buildContext();
    expect(ctx.thinkingLevel).toBe("high");
    expect(ctx.model).toEqual({ provider: "anthropic", modelId: "claude-3-5-sonnet" });
    expect(ctx.activeToolNames).toEqual(["echo"]);
  });
});

describe("Session — contextBuildOptions 默认值", () => {
  it("构造时传的 entryProjectors 也会应用到 buildContext", async () => {
    const s = new Session(new InMemorySessionStorage(), {
      entryProjectors: {
        notice: (entry): readonly AgentMessage[] => {
          if (entry.type === "custom" && entry.data) {
            return [
              {
                role: "user",
                content: (entry.data as { text: string }).text,
                timestamp: Date.now(),
              },
            ];
          }
          return [];
        },
      },
    });
    await s.appendMessage(userMsg("a"));
    await s.appendCustomEntry("notice", { text: "from-default" });
    await s.appendMessage(userMsg("b"));
    const ctx = await s.buildContext();
    const userTexts = ctx.messages
      .filter((m) => m.role === "user")
      .map((m) => (m as UserMessage).content);
    expect(userTexts).toContain("from-default");
  });
});
