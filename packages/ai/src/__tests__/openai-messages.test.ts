/**
 * OpenAI convertMessages 的真实单元测试。
 * 覆盖：reasoning_content 回传、tool_calls 序列化、tool 消息格式。
 */
import { describe, it, expect } from "vitest";
import { _convertMessages, mapOpenAIFinishReason } from "../api/openai-compat-base.js";
import type { Context, UserMessage, AssistantMessage, ToolResultMessage } from "../types.js";

function makeUser(text: string): UserMessage {
  return { role: "user", content: text, timestamp: Date.now() };
}

function makeAssistant(content: AssistantMessage["content"]): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: "openai",
    model: "gpt-5.5",
    usage: { input: 0, output: 0, totalTokens: 0, cost: { input: 0, output: 0, total: 0 } },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function makeToolResult(toolCallId: string, name: string, text: string): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId,
    toolName: name,
    content: [{ type: "text", text }],
    isError: false,
    timestamp: Date.now(),
  };
}

describe("_convertMessages", () => {
  it("用户文本消息", () => {
    const msgs: Context["messages"] = [makeUser("hello")];
    const result = _convertMessages(msgs);
    expect(result).toEqual([{ role: "user", content: "hello" }]);
  });

  it("包含 tool_calls 的助手消息", () => {
    const msgs: Context["messages"] = [
      makeAssistant([
        { type: "text", text: "let me check" },
        { type: "toolCall", id: "call_1", name: "get_weather", arguments: { city: "Beijing" } },
      ]),
    ];
    const result = _convertMessages(msgs);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      role: "assistant",
      content: "let me check",
    });
    expect((result[0] as any).tool_calls).toEqual([{
      id: "call_1",
      type: "function",
      function: { name: "get_weather", arguments: '{"city":"Beijing"}' },
    }]);
  });

  it("reasoning_content 回传——DeepSeek 多轮关键", () => {
    const msgs: Context["messages"] = [
      makeAssistant([
        { type: "thinking", thinking: "用户想要天气" },
        { type: "toolCall", id: "call_2", name: "search", arguments: { q: "weather" } },
      ]),
    ];
    const result = _convertMessages(msgs);
    expect(result).toHaveLength(1);
    // 关键：reasoning_content 必须回传
    expect((result[0] as any).reasoning_content).toBe("用户想要天气");
    // 但不应该出现在 content
    expect(result[0].content).toBeNull();
  });

  it("纯思考助手消息", () => {
    const msgs: Context["messages"] = [
      makeAssistant([{ type: "thinking", thinking: "分析中..." }]),
    ];
    const result = _convertMessages(msgs);
    expect((result[0] as any).reasoning_content).toBe("分析中...");
    expect(result[0].content).toBeNull();
  });

  it("tool 消息正确映射 tool_call_id", () => {
    const msgs: Context["messages"] = [makeToolResult("call_abc", "weather", "sunny")];
    const result = _convertMessages(msgs);
    expect(result).toEqual([{
      role: "tool",
      tool_call_id: "call_abc",
      content: "sunny",
    }]);
  });

  it("多轮完整流程", () => {
    const msgs: Context["messages"] = [
      makeUser("天气?"),
      makeAssistant([
        { type: "thinking", thinking: "需要调用工具" },
        { type: "toolCall", id: "call_3", name: "get_weather", arguments: { city: "上海" } },
      ]),
      makeToolResult("call_3", "get_weather", "晴天 28度"),
    ];
    const result = _convertMessages(msgs);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ role: "user", content: "天气?" });
    expect((result[1] as any).reasoning_content).toBe("需要调用工具");
    expect((result[1] as any).tool_calls).toHaveLength(1);
    expect(result[2]).toEqual({ role: "tool", tool_call_id: "call_3", content: "晴天 28度" });
  });

  it("多模态用户消息（文本+图片）", () => {
    const msgs: Context["messages"] = [{
      role: "user",
      content: [
        { type: "text", text: "看图" },
        { type: "image", data: "base64data", mimeType: "image/png" as const },
      ],
      timestamp: Date.now(),
    }];
    const result = _convertMessages(msgs);
    expect(result).toHaveLength(1);
    expect(Array.isArray((result[0] as any).content)).toBe(true);
    expect((result[0] as any).content[1].type).toBe("image_url");
  });
});

describe("mapOpenAIFinishReason", () => {
  it("tool_calls → toolUse", () => {
    expect(mapOpenAIFinishReason("tool_calls")).toBe("toolUse");
  });

  it("length → length（之前 buildAssistantMessage 会错误归为 stop）", () => {
    expect(mapOpenAIFinishReason("length")).toBe("length");
  });

  it("stop → stop", () => {
    expect(mapOpenAIFinishReason("stop")).toBe("stop");
  });

  it("未知值 / null / undefined → stop（默认值）", () => {
    expect(mapOpenAIFinishReason(null)).toBe("stop");
    expect(mapOpenAIFinishReason(undefined)).toBe("stop");
    expect(mapOpenAIFinishReason("content_filter")).toBe("stop");
  });
});
