/**
 * harness/messages/convert.ts 的单元测试。
 *
 * convertToLlm 是 agent-loop 的"上下文投影"入口:
 * 把 AgentMessage[] 投影为 AI 层可消费的 Message[]。
 * 默认过滤掉所有 custom 消息(声明合并进来的扩展类型),
 * 不让它们进 LLM 上下文。
 */

import { describe, expect, it } from "vitest";
import { convertToLlm } from "../../../src/harness/messages/convert.js";
import type { AgentMessage } from "../../../src/types.js";

describe("harness/messages/convert", () => {
  it("空列表 → 空列表", () => {
    expect(convertToLlm([])).toEqual([]);
  });

  it("标准 user 消息保持原样", () => {
    const user: AgentMessage = {
      role: "user",
      content: "hi",
      timestamp: 1,
    };
    const out = convertToLlm([user]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual(user);
  });

  it("标准 assistant 消息保持原样", () => {
    const asst: AgentMessage = {
      role: "assistant",
      content: [{ type: "text", text: "hello" }],
      api: "anthropic-messages",
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      usage: { input: 0, output: 0, totalTokens: 0, cost: { input: 0, output: 0, total: 0 } },
      stopReason: "stop",
      timestamp: 1,
    };
    const out = convertToLlm([asst]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual(asst);
  });

  it("标准 toolResult 消息保持原样", () => {
    const tool: AgentMessage = {
      role: "toolResult",
      toolCallId: "tc1",
      toolName: "echo",
      content: [{ type: "text", text: "echo: hi" }],
      isError: false,
      timestamp: 1,
    };
    const out = convertToLlm([tool]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual(tool);
  });

  it("默认过滤掉 custom 消息", () => {
    // 声明合并:加一个 notification 消息
    type Custom = AgentMessage & {
      role: "custom";
      customType: "notification";
      title: string;
      body: string;
    };
    const custom = {
      role: "custom",
      customType: "notification",
      title: "提醒",
      body: "测试",
      timestamp: 1,
    } as unknown as AgentMessage;

    const user: AgentMessage = {
      role: "user",
      content: "hi",
      timestamp: 2,
    };

    const out = convertToLlm([user, custom, user]);
    // 应当只剩 2 条 user,custom 被过滤
    expect(out).toHaveLength(2);
    expect(out.every((m) => (m as { role?: string }).role !== "custom")).toBe(true);
  });

  it("保持原列表的相对顺序", () => {
    const a: AgentMessage = { role: "user", content: "a", timestamp: 1 };
    const b: AgentMessage = { role: "user", content: "b", timestamp: 2 };
    const c: AgentMessage = { role: "user", content: "c", timestamp: 3 };
    const out = convertToLlm([a, b, c]);
    expect(out).toEqual([a, b, c]);
  });

  it("纯 custom 列表 → 空列表", () => {
    const custom = {
      role: "custom",
      customType: "notification",
      title: "t",
      body: "b",
      timestamp: 1,
    } as unknown as AgentMessage;
    expect(convertToLlm([custom])).toEqual([]);
  });
});
