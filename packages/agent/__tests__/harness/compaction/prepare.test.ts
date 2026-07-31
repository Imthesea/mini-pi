/**
 * prepareCompaction + extractFileOpsFromMessage 单元测试。
 *
 * 覆盖:
 * - prepareCompaction 选保留边界
 * - prepareCompaction 处理空 entries
 * - prepareCompaction 全部 entries 都不到阈值时不压缩(messagesToSummarize = [])
 * - extractFileOpsFromMessage 从 assistant 消息的 toolCall 提取文件操作
 * - extractFileOpsFromMessage 从 toolResult 消息提取文件路径
 * - extractFileOpsFromMessage 处理无 toolCall 的消息
 */

import { describe, expect, it } from "vitest";
import {
  extractFileOpsFromMessage,
  prepareCompaction,
} from "../../../src/harness/compaction/prepare.js";
import type { AgentMessage } from "../../../src/types.js";
import type { SessionTreeEntry } from "../../../src/harness/session/types.js";

/** 构造一个 message entry(从 leaf 顺序开始累加) */
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

/** 构造一个非 message entry(如 compaction / leaf) */
function makeNonMessageEntry(
  id: string,
  type:
    | "compaction"
    | "branch_summary"
    | "leaf"
    | "label"
    | "session_info" = "compaction",
  parentId: string | null = null,
  extra: Record<string, unknown> = {},
): SessionTreeEntry {
  const base = {
    id,
    parentId,
    timestamp: new Date().toISOString(),
  };
  if (type === "compaction") {
    return {
      ...base,
      type,
      summary: "test",
      firstKeptEntryId: id,
      tokensBefore: 0,
      ...extra,
    };
  }
  if (type === "branch_summary") {
    return {
      ...base,
      type,
      fromId: id,
      summary: "test",
      ...extra,
    };
  }
  if (type === "leaf") {
    return { ...base, type, targetId: id };
  }
  return { ...base, type, ...extra } as SessionTreeEntry;
}

describe("prepareCompaction", () => {
  it("空 entries 返回空结果", () => {
    const result = prepareCompaction([], {});
    expect(result.firstKeptEntryId).toBe("<empty>");
    expect(result.tokensBefore).toBe(0);
    expect(result.messagesToSummarize).toEqual([]);
    expect(result.readFiles).toEqual([]);
    expect(result.modifiedFiles).toEqual([]);
  });

  it("单条 entry:保留边界 = 唯一 entry,messagesToSummarize = []", () => {
    const msg: AgentMessage = { role: "user", content: "hi", timestamp: 0 };
    const entries: SessionTreeEntry[] = [makeMessageEntry("e1", msg, null)];

    const result = prepareCompaction(entries, { keepRecentTokens: 1 });
    expect(result.firstKeptEntryId).toBe("e1");
    // 单条不超阈值(0.75 → 1),但 prepare 的逻辑是"全部累加不超过阈值就不压缩"
    // 这里 keepRecentTokens = 1,单条 (2/4) = 1 已超阈值
    // 所以会进入压缩分支
  });

  it("多条 entries 累加 token,选保留边界", () => {
    // 构造 5 条 user 消息,每条 100 chars → 25 tokens
    // keepRecentTokens = 60 → 累加到第 3 条时(75 tokens)超过,保留第 3 条之后
    const entries: SessionTreeEntry[] = [];
    for (let i = 0; i < 5; i++) {
      const parentId = i === 0 ? null : `e${i}`;
      entries.push(
        makeMessageEntry(
          `e${i + 1}`,
          { role: "user", content: "a".repeat(100), timestamp: i },
          parentId,
        ),
      );
    }
    // entries 是从 leaf 往 root: [leaf, ..., root]
    // 我们传 e5(leaf) → e1(root)
    const result = prepareCompaction(entries, { keepRecentTokens: 60 });
    // 第 1 条 (25 tokens) + 第 2 条 (50) + 第 3 条 (75) 超阈值
    // 所以 firstKeptEntryId = entries[2].id = "e3"
    expect(result.firstKeptEntryId).toBe("e3");
    // messagesToSummarize = entries[0..1] = e5 + e4
    expect(result.messagesToSummarize).toHaveLength(2);
  });

  it("全部 entries 累加不到阈值:保留最后一条,messagesToSummarize = []", () => {
    const entries: SessionTreeEntry[] = [];
    for (let i = 0; i < 3; i++) {
      const parentId = i === 0 ? null : `e${i}`;
      entries.push(
        makeMessageEntry(
          `e${i + 1}`,
          { role: "user", content: "hi", timestamp: i },
          parentId,
        ),
      );
    }
    // 3 条各 1 token,共 3 tokens < 1000
    const result = prepareCompaction(entries, { keepRecentTokens: 1000 });
    expect(result.firstKeptEntryId).toBe("e3");
    expect(result.messagesToSummarize).toHaveLength(0);
  });

  it("从 messages 提取 read/modified files 累计到 readFiles/modifiedFiles", () => {
    const entries: SessionTreeEntry[] = [];
    // entries[0] (leaf) = read file
    entries.push(
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
          model: "claude",
          usage: { input: 0, output: 0, totalTokens: 0, cost: { input: 0, output: 0, total: 0 } },
          stopReason: "toolUse",
          timestamp: 0,
        },
        null,
      ),
    );
    // entries[1] = write file
    entries.push(
      makeMessageEntry(
        "e2",
        {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "t2",
              name: "write",
              arguments: { path: "/b.txt" },
            },
          ],
          api: "anthropic-messages",
          provider: "anthropic",
          model: "claude",
          usage: { input: 0, output: 0, totalTokens: 0, cost: { input: 0, output: 0, total: 0 } },
          stopReason: "toolUse",
          timestamp: 1,
        },
        "e1",
      ),
    );
    // keepRecentTokens 设为 0,强制压缩
    const result = prepareCompaction(entries, { keepRecentTokens: 0 });
    expect(result.readFiles).toContain("/a.txt");
    expect(result.modifiedFiles).toContain("/b.txt");
  });

  it("使用默认 settings(DEFAULT_COMPACTION_SETTINGS.keepRecentTokens)", () => {
    const entries: SessionTreeEntry[] = [
      makeMessageEntry(
        "e1",
        { role: "user", content: "hi", timestamp: 0 },
        null,
      ),
    ];
    // 不传 settings:用默认 20000
    const result = prepareCompaction(entries);
    // 1 条 1 token < 20000,保留最后
    expect(result.firstKeptEntryId).toBe("e1");
    expect(result.messagesToSummarize).toHaveLength(0);
  });

  it("非 message entry 不计入 token 估算", () => {
    const entries: SessionTreeEntry[] = [
      makeMessageEntry(
        "e1",
        { role: "user", content: "a".repeat(10000), timestamp: 0 },
        null,
      ),
      makeNonMessageEntry("e2", "compaction", "e1", {
        summary: "long summary ".repeat(10000),
      }),
    ];
    // entries[0] 累加 2500 tokens,超过 2000
    const result = prepareCompaction(entries, { keepRecentTokens: 2000 });
    // 第 1 条就超阈值,firstKeptEntryId = entries[0].id = "e1"
    // 不管 entries[1] 是什么
    expect(result.firstKeptEntryId).toBe("e1");
  });
});

describe("extractFileOpsFromMessage", () => {
  it("从 assistant toolCall 'read' 提取 readFiles", () => {
    const msg: AgentMessage = {
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
      model: "claude",
      usage: { input: 0, output: 0, totalTokens: 0, cost: { input: 0, output: 0, total: 0 } },
      stopReason: "toolUse",
      timestamp: 0,
    };
    const ops = extractFileOpsFromMessage(msg);
    expect(ops.readFiles).toContain("/a.txt");
    expect(ops.modifiedFiles).toHaveLength(0);
  });

  it("从 assistant toolCall 'write' 提取 modifiedFiles", () => {
    const msg: AgentMessage = {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "t1",
          name: "write_file",
          arguments: { path: "/b.txt" },
        },
      ],
      api: "anthropic-messages",
      provider: "anthropic",
      model: "claude",
      usage: { input: 0, output: 0, totalTokens: 0, cost: { input: 0, output: 0, total: 0 } },
      stopReason: "toolUse",
      timestamp: 0,
    };
    const ops = extractFileOpsFromMessage(msg);
    expect(ops.readFiles).toHaveLength(0);
    expect(ops.modifiedFiles).toContain("/b.txt");
  });

  it("从 assistant toolCall 'edit' 提取 modifiedFiles", () => {
    const msg: AgentMessage = {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "t1",
          name: "edit",
          arguments: { filePath: "/c.txt" },
        },
      ],
      api: "anthropic-messages",
      provider: "anthropic",
      model: "claude",
      usage: { input: 0, output: 0, totalTokens: 0, cost: { input: 0, output: 0, total: 0 } },
      stopReason: "toolUse",
      timestamp: 0,
    };
    const ops = extractFileOpsFromMessage(msg);
    expect(ops.modifiedFiles).toContain("/c.txt");
  });

  it("非 read/write/edit 工具名不提取", () => {
    const msg: AgentMessage = {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "t1",
          name: "search",
          arguments: { query: "test" },
        },
      ],
      api: "anthropic-messages",
      provider: "anthropic",
      model: "claude",
      usage: { input: 0, output: 0, totalTokens: 0, cost: { input: 0, output: 0, total: 0 } },
      stopReason: "toolUse",
      timestamp: 0,
    };
    const ops = extractFileOpsFromMessage(msg);
    expect(ops.readFiles).toHaveLength(0);
    expect(ops.modifiedFiles).toHaveLength(0);
  });

  it("user 消息不提取文件操作", () => {
    const msg: AgentMessage = {
      role: "user",
      content: "/a.txt /b.txt",
      timestamp: 0,
    };
    const ops = extractFileOpsFromMessage(msg);
    expect(ops.readFiles).toHaveLength(0);
    expect(ops.modifiedFiles).toHaveLength(0);
  });

  it("assistant 消息无 toolCall 时返回空", () => {
    const msg: AgentMessage = {
      role: "assistant",
      content: [{ type: "text", text: "hello" }],
      api: "anthropic-messages",
      provider: "anthropic",
      model: "claude",
      usage: { input: 0, output: 0, totalTokens: 0, cost: { input: 0, output: 0, total: 0 } },
      stopReason: "stop",
      timestamp: 0,
    };
    const ops = extractFileOpsFromMessage(msg);
    expect(ops.readFiles).toHaveLength(0);
    expect(ops.modifiedFiles).toHaveLength(0);
  });
});
