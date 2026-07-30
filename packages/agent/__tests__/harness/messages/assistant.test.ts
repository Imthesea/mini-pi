/**
 * harness/messages/assistant.ts 的单元测试。
 *
 * buildAssistantMessage 把 AI 层的 AssistantMessageEvent 流
 * 累积成一个 AssistantMessage,content 数组严格按 text → thinking → tools
 * 顺序排列(与 AI 层 buildAssistantMessage 契约一致,见 phase01 规范)。
 *
 * 本模块是 harness 层"消息重建"工具,主要给 compaction / branch summary
 * 等需要从事件流重建消息的场景使用。
 */

import { describe, expect, it } from "vitest";
import { buildAssistantMessage } from "../../../src/harness/messages/assistant.js";
import type {
  AssistantMessage,
  AssistantMessageEvent,
  Model,
} from "@mimi/ai";

const mockModel: Model<any> = {
  id: "claude-sonnet-4-20250514",
  name: "Claude Sonnet 4",
  api: "anthropic-messages",
  provider: "anthropic",
  baseUrl: "https://api.anthropic.com",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0 },
  contextWindow: 200000,
  maxTokens: 8192,
};

/** 构造一个 partial + event 序列,模拟流式响应 */
function makeEvents(blocks: AssistantMessageEvent[]): AssistantMessageEvent[] {
  return blocks;
}

describe("harness/messages/assistant", () => {
  it("空事件列表 → 内容为空的 AssistantMessage", () => {
    const events: AssistantMessageEvent[] = [];
    const msg = buildAssistantMessage(events, mockModel);
    expect(msg.role).toBe("assistant");
    expect(msg.content).toEqual([]);
    expect(msg.model).toBe(mockModel.id);
  });

  it("纯文本:content 顺序 text 在前", () => {
    const events = makeEvents([
      { type: "start", partial: emptyPartial(mockModel) },
      { type: "text_start", contentIndex: 0, partial: emptyPartial(mockModel) },
      { type: "text_delta", contentIndex: 0, delta: "Hello", partial: emptyPartial(mockModel) },
      { type: "text_end", contentIndex: 0, content: "Hello", partial: emptyPartial(mockModel) },
      {
        type: "done",
        reason: "stop",
        message: withContent(mockModel, [{ type: "text", text: "Hello" }]),
      },
    ]);
    const msg = buildAssistantMessage(events, mockModel);
    expect(msg.content).toEqual([{ type: "text", text: "Hello" }]);
  });

  it("content 顺序:text → thinking → tools(契约保证)", () => {
    // 模拟混合内容:text + thinking + toolCall
    const events = makeEvents([
      { type: "start", partial: emptyPartial(mockModel) },
      { type: "text_start", contentIndex: 0, partial: emptyPartial(mockModel) },
      { type: "text_delta", contentIndex: 0, delta: "Let me check", partial: emptyPartial(mockModel) },
      { type: "text_end", contentIndex: 0, content: "Let me check", partial: emptyPartial(mockModel) },
      { type: "thinking_start", contentIndex: 1, partial: emptyPartial(mockModel) },
      { type: "thinking_delta", contentIndex: 1, delta: "thinking...", partial: emptyPartial(mockModel) },
      { type: "thinking_end", contentIndex: 1, content: "thinking...", partial: emptyPartial(mockModel) },
      { type: "toolcall_start", contentIndex: 2, partial: emptyPartial(mockModel) },
      {
        type: "toolcall_end",
        contentIndex: 2,
        toolCall: { type: "toolCall", id: "tc1", name: "echo", arguments: { text: "hi" } },
        partial: emptyPartial(mockModel),
      },
      {
        type: "done",
        reason: "toolUse",
        message: withContent(mockModel, [
          { type: "text", text: "Let me check" },
          { type: "thinking", thinking: "thinking..." },
          { type: "toolCall", id: "tc1", name: "echo", arguments: { text: "hi" } },
        ]),
      },
    ]);
    const msg = buildAssistantMessage(events, mockModel);
    expect(msg.content.map((b) => b.type)).toEqual([
      "text",
      "thinking",
      "toolCall",
    ]);
  });

  it("events 中只取 final done 事件作为 message 来源", () => {
    const events = makeEvents([
      { type: "start", partial: emptyPartial(mockModel) },
      { type: "text_start", contentIndex: 0, partial: emptyPartial(mockModel) },
      { type: "text_delta", contentIndex: 0, delta: "x", partial: emptyPartial(mockModel) },
      { type: "text_end", contentIndex: 0, content: "x", partial: emptyPartial(mockModel) },
      {
        type: "done",
        reason: "stop",
        message: withContent(mockModel, [{ type: "text", text: "x" }]),
      },
    ]);
    const msg = buildAssistantMessage(events, mockModel);
    expect(msg.stopReason).toBe("stop");
  });
});

/** 构造一个最小 partial */
function emptyPartial(model: Model<any>): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: { input: 0, output: 0, totalTokens: 0, cost: { input: 0, output: 0, total: 0 } },
    stopReason: "stop",
    timestamp: 0,
  };
}

/** 构造一个完整 AssistantMessage */
function withContent(model: Model<any>, content: AssistantMessage["content"]): AssistantMessage {
  return { ...emptyPartial(model), content, stopReason: "stop" };
}
