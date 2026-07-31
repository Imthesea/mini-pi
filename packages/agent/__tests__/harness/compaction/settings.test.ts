/**
 * DEFAULT_COMPACTION_SETTINGS + shouldCompact 单元测试。
 *
 * 覆盖:
 * - DEFAULT_COMPACTION_SETTINGS 默认值
 * - shouldCompact 在 enabled=false 时返回 false
 * - shouldCompact 在 token 不足时返回 false
 * - shouldCompact 在 token 充足时返回 true
 * - shouldCompact 接受自定义 settings
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMPACTION_SETTINGS,
  shouldCompact,
} from "../../../src/harness/compaction/settings.js";
import type { AgentMessage } from "../../../src/types.js";
import type { SessionContext } from "../../../src/harness/session/types.js";

describe("DEFAULT_COMPACTION_SETTINGS", () => {
  it("默认 enabled 为 true", () => {
    expect(DEFAULT_COMPACTION_SETTINGS.enabled).toBe(true);
  });

  it("默认 keepRecentTokens 为 20000", () => {
    expect(DEFAULT_COMPACTION_SETTINGS.keepRecentTokens).toBe(20000);
  });

  it("包含默认 compactionPrompt", () => {
    expect(DEFAULT_COMPACTION_SETTINGS.compactionPrompt).toBeDefined();
    expect(typeof DEFAULT_COMPACTION_SETTINGS.compactionPrompt).toBe("string");
    expect(DEFAULT_COMPACTION_SETTINGS.compactionPrompt!.length).toBeGreaterThan(
      0,
    );
  });
});

describe("shouldCompact", () => {
  function makeContext(messages: AgentMessage[]): SessionContext {
    return {
      messages,
      thinkingLevel: "medium",
      model: null,
      activeToolNames: null,
    };
  }

  it("enabled=false 时返回 false(不论 token 数)", () => {
    const ctx = makeContext([
      { role: "user", content: "a".repeat(1000), timestamp: 0 },
    ]);
    expect(shouldCompact(ctx, { enabled: false })).toBe(false);
  });

  it("空 messages 返回 false", () => {
    const ctx = makeContext([]);
    expect(shouldCompact(ctx)).toBe(false);
  });

  it("小 messages(token < 100K)返回 false", () => {
    const ctx = makeContext([
      { role: "user", content: "hello world", timestamp: 0 },
    ]);
    expect(shouldCompact(ctx)).toBe(false);
  });

  it("大 messages(token > 100K)返回 true", () => {
    // 构造一个 500K chars 的消息(估算 ~125K tokens)
    const bigContent = "a".repeat(500_000);
    const ctx = makeContext([{ role: "user", content: bigContent, timestamp: 0 }]);
    expect(shouldCompact(ctx)).toBe(true);
  });

  it("多条 user 消息累加 token", () => {
    const messages: AgentMessage[] = [];
    for (let i = 0; i < 200; i++) {
      // 每条 3000 chars → 累加 600K chars → 150K tokens
      messages.push({ role: "user", content: "a".repeat(3000), timestamp: i });
    }
    const ctx = makeContext(messages);
    expect(shouldCompact(ctx)).toBe(true);
  });

  it("assistant 消息的 text/thinking/toolCall 都计入 token", () => {
    const messages: AgentMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "a".repeat(500_000) },
        ],
        api: "anthropic-messages",
        provider: "anthropic",
        model: "claude",
        usage: { input: 0, output: 0, totalTokens: 0, cost: { input: 0, output: 0, total: 0 } },
        stopReason: "stop",
        timestamp: 0,
      },
    ];
    const ctx = makeContext(messages);
    expect(shouldCompact(ctx)).toBe(true);
  });
});
