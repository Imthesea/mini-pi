/**
 * Compaction 纯函数的单元测试。
 *
 * 覆盖：calculateContextTokens / shouldCompact / estimateTokens /
 *        findCutPoint / prepareCompaction。
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  calculateContextTokens,
  shouldCompact,
  estimateTokens,
  findCutPoint,
  prepareCompaction,
  type CompactionSettings,
} from "../core/compaction/index.js";
import type { SessionEntry } from "../core/session-manager.js";

const SETTINGS: CompactionSettings = { enabled: true, reserveTokens: 100, keepRecentTokens: 10 };

/** 构造一条宽松类型的消息（estimateTokens / findCutPoint 只读 role + content） */
function msg(role: "user" | "assistant" | "toolResult", text: string): any {
  if (role === "user") {
    return { role, content: text, timestamp: Date.now() };
  }
  if (role === "toolResult") {
    return { role, toolCallId: "tc", toolName: "read_file", content: text, isError: false, timestamp: Date.now() };
  }
  return {
    role,
    content: [{ type: "text", text }],
    api: "openai-completions",
    provider: "deepseek",
    model: "deepseek-chat",
    usage: { input: 1, output: 1, totalTokens: 2, cost: { input: 0, output: 0, total: 0 } },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

/** 构造一条 message 条目，parentId 自动链接上一条（形成线性链） */
let seq = 0;
let prevId: string | null = null;
function entry(m: any): SessionEntry {
  const id = `e${++seq}`;
  const e = { type: "message", id, parentId: prevId, timestamp: new Date().toISOString(), message: m } as SessionEntry;
  prevId = id;
  return e;
}

beforeEach(() => {
  seq = 0;
  prevId = null;
});

describe("calculateContextTokens", () => {
  it("totalTokens 优先", () => {
    const usage = { input: 10, output: 5, totalTokens: 100, cacheRead: 3, cacheWrite: 2, cost: { input: 0, output: 0, total: 0 } } as any;
    expect(calculateContextTokens(usage)).toBe(100);
  });

  it("无 totalTokens 时按各字段求和", () => {
    const usage = { input: 10, output: 5, totalTokens: 0, cacheRead: 3, cacheWrite: 2, cost: { input: 0, output: 0, total: 0 } } as any;
    expect(calculateContextTokens(usage)).toBe(20);
  });
});

describe("shouldCompact", () => {
  it("enabled=false 永远不压缩", () => {
    expect(shouldCompact(99999, 10000, { ...SETTINGS, enabled: false })).toBe(false);
  });

  it("超过阈值 → true", () => {
    // contextWindow 10000 - reserveTokens 100 = 9900，9901 已超
    expect(shouldCompact(9901, 10000, SETTINGS)).toBe(true);
  });

  it("未超阈值 → false", () => {
    expect(shouldCompact(9900, 10000, SETTINGS)).toBe(false);
  });
});

describe("estimateTokens", () => {
  it("user 文本按字符数/4 估算", () => {
    expect(estimateTokens(msg("user", "abcd"))).toBe(1);
  });

  it("assistant 文本按字符数/4 估算", () => {
    expect(estimateTokens(msg("assistant", "abcdefgh"))).toBe(2);
  });

  it("toolResult 文本按字符数/4 估算", () => {
    expect(estimateTokens(msg("toolResult", "abcd"))).toBe(1);
  });
});

describe("findCutPoint", () => {
  it("小会话无足够 token 时保留全部（firstKeptEntryIndex=0）", () => {
    const entries = [entry(msg("user", "hi")), entry(msg("assistant", "ok"))];
    expect(findCutPoint(entries, 0, 2, 10).firstKeptEntryIndex).toBe(0);
  });
});

describe("prepareCompaction", () => {
  it("小会话返回 undefined（无可摘要内容）", () => {
    const entries = [entry(msg("user", "hi")), entry(msg("assistant", "ok"))];
    expect(prepareCompaction(entries, SETTINGS)).toBeUndefined();
  });

  it("大会话生成 preparation，识别 split-turn", () => {
    const entries = [
      entry(msg("user", "start")),
      entry(msg("assistant", "ok")),
      entry(msg("user", "Q" + "y".repeat(200))),
      entry(msg("assistant", "A" + "z".repeat(200))),
    ];

    const prep = prepareCompaction(entries, SETTINGS)!;

    expect(prep).toBeDefined();
    expect(prep.firstKeptEntryId).toBe(entries[3].id);
    // 被摘要的是前 2 条（切割点落在最后一条 assistant，回退到上一条 user 作为轮次起点）
    expect(prep.messagesToSummarize.length).toBe(2);
    expect(prep.turnPrefixMessages.length).toBe(1);
    expect(prep.isSplitTurn).toBe(true);
    expect(prep.tokensBefore).toBeGreaterThan(0);
  });
});
