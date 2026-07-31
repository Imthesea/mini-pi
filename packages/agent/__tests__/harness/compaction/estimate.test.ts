/**
 * estimateTokens 单元测试。
 *
 * 覆盖:
 * - 单条 user message(字符串 content)
 * - 单条 user message(数组 content: text + image)
 * - 单条 assistant message(text / thinking / toolCall)
 * - 单条 toolResult message
 * - 数组输入
 * - 空数组
 * - 异常形状(不抛错,返回 0)
 */

import { describe, expect, it } from "vitest";
import { estimateTokens } from "../../../src/harness/compaction/estimate.js";
import type { AgentMessage, AssistantMessage } from "../../../src/harness/session/types.js";

/** 构造只关心 content 字段的 assistant 消息(其他必填字段用占位) */
function assistantMsg(content: AssistantMessage["content"]): AgentMessage {
  return {
    role: "assistant",
    content,
    api: "anthropic-messages",
    provider: "anthropic",
    model: "claude",
    usage: { input: 0, output: 0, totalTokens: 0, cost: { input: 0, output: 0, total: 0 } },
    stopReason: "stop",
    timestamp: 0,
  };
}

describe("estimateTokens", () => {
  it("估算 user 消息(字符串 content)", () => {
    const msg: AgentMessage = {
      role: "user",
      content: "hello world",
      timestamp: 0,
    };
    // 11 chars / 4 = 2.75 → ceil = 3
    expect(estimateTokens(msg)).toBe(3);
  });

  it("估算 user 消息(数组 content,text 部分)", () => {
    const msg: AgentMessage = {
      role: "user",
      content: [
        { type: "text", text: "hi" },
        { type: "text", text: "world" },
      ],
      timestamp: 0,
    };
    // 2 + 5 = 7 chars / 4 = 1.75 → 2
    expect(estimateTokens(msg)).toBe(2);
  });

  it("user 消息中 image 按 1000 chars 估算", () => {
    const msg: AgentMessage = {
      role: "user",
      content: [
        { type: "text", text: "see " },
        {
          type: "image",
          data: "base64",
          mimeType: "image/png",
        },
      ],
      timestamp: 0,
    };
    // 4 + 1000 = 1004 / 4 = 251
    expect(estimateTokens(msg)).toBe(251);
  });

  it("估算 assistant 消息 text block", () => {
    const msg = assistantMsg([{ type: "text", text: "hello" }]);
    // 5 / 4 = 1.25 → 2
    expect(estimateTokens(msg)).toBe(2);
  });

  it("估算 assistant 消息 thinking block", () => {
    const msg = assistantMsg([{ type: "thinking", thinking: "long thinking content" }]);
    // 21 / 4 = 5.25 → 6
    expect(estimateTokens(msg)).toBe(6);
  });

  it("估算 assistant 消息 toolCall block", () => {
    const msg = assistantMsg([
      {
        type: "toolCall",
        id: "id-1",
        name: "read",
        arguments: { path: "/a/b/c.txt" },
      },
    ]);
    // 4 (id) + 4 (name) + JSON.stringify({path:"/a/b/c.txt"}).length=21 → 29 chars / 4 = 7.25 → ceil = 8
    expect(estimateTokens(msg)).toBe(8);
  });

  it("估算 toolResult 消息", () => {
    const msg: AgentMessage = {
      role: "toolResult",
      toolCallId: "id-1",
      toolName: "read",
      content: [{ type: "text", text: "file contents" }],
      isError: false,
      timestamp: 0,
    };
    // 4 (toolCallId) + 4 (toolName) + 13 (text) = 21 / 4 = 5.25 → 6
    expect(estimateTokens(msg)).toBe(6);
  });

  it("估算 messages 数组(累加)", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "hello", timestamp: 0 },
      { role: "user", content: "world", timestamp: 1 },
    ];
    // 5 + 5 = 10 / 4 = 2.5 → 3
    expect(estimateTokens(messages)).toBe(3);
  });

  it("空数组返回 0", () => {
    expect(estimateTokens([])).toBe(0);
  });

  it("空字符串 user 消息返回 0", () => {
    const msg: AgentMessage = { role: "user", content: "", timestamp: 0 };
    expect(estimateTokens(msg)).toBe(0);
  });

  it("空 content 数组 user 消息返回 0", () => {
    const msg: AgentMessage = { role: "user", content: [], timestamp: 0 };
    expect(estimateTokens(msg)).toBe(0);
  });

  it("空 content 数组 assistant 消息返回 0", () => {
    const msg = assistantMsg([]);
    expect(estimateTokens(msg)).toBe(0);
  });
});
