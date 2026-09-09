import { describe, it, expect } from "vitest";
import {
  applyEvent,
  initialStreamState,
  type StreamState,
} from "./message-reducer";
import type { ChatMessage } from "./types";

function startAssistant(id = "a1"): StreamState {
  return applyEvent(initialStreamState, {
    type: "message_start",
    id,
    role: "assistant",
  });
}

describe("applyEvent", () => {
  it("message_start(user) 清掉乐观消息并追加 user", () => {
    const state: StreamState = {
      messages: [{ id: "user-123", role: "user", content: "乐观" }],
      streamingId: null,
      isRunning: true,
    };

    const next = applyEvent(state, {
      type: "message_start",
      id: "u1",
      role: "user",
      content: "你好",
    });

    expect(next.messages).toEqual([
      { id: "u1", role: "user", content: "你好" },
    ]);
  });

  it("message_start(assistant) 追加空 assistant 并指向 streamingId", () => {
    const next = startAssistant("a1");

    expect(next.streamingId).toBe("a1");
    expect(next.messages).toEqual([
      { id: "a1", role: "assistant", content: "" },
    ]);
  });

  it("message_update 有 streamingId 时更新 content/thinking", () => {
    const next = applyEvent(startAssistant("a1"), {
      type: "message_update",
      content: "文本",
      thinking: "思考",
    });

    const msg = next.messages[0];
    expect(msg.content).toBe("文本");
    expect(msg.thinkingContent).toBe("思考");
  });

  it("message_update 无 streamingId 时状态不变", () => {
    const state = initialStreamState;
    const next = applyEvent(state, {
      type: "message_update",
      content: "x",
    });

    expect(next).toBe(state);
  });

  it("message_update 只带 thinking 时 content 保持旧值", () => {
    const state = applyEvent(startAssistant("a1"), {
      type: "message_update",
      content: "旧文本",
    });
    const next = applyEvent(state, {
      type: "message_update",
      thinking: "新思考",
    });

    expect(next.messages[0].content).toBe("旧文本");
    expect(next.messages[0].thinkingContent).toBe("新思考");
  });

  it("tool_execution_start 挂到 streaming 消息 toolCalls", () => {
    const next = applyEvent(startAssistant("a1"), {
      type: "tool_execution_start",
      toolCallId: "t1",
      toolName: "Read",
      args: { filePath: "a.txt" },
    });

    expect(next.messages[0].toolCalls).toEqual([
      {
        toolCallId: "t1",
        toolName: "Read",
        status: "running",
        args: { filePath: "a.txt" },
      },
    ]);
  });

  it("tool_execution_start 重复 toolCallId 去重", () => {
    const state = applyEvent(startAssistant("a1"), {
      type: "tool_execution_start",
      toolCallId: "t1",
      toolName: "Read",
      args: {},
    });
    const next = applyEvent(state, {
      type: "tool_execution_start",
      toolCallId: "t1",
      toolName: "Read",
      args: {},
    });

    expect(next).toBe(state);
    expect(next.messages[0].toolCalls).toHaveLength(1);
  });

  it("tool_execution_start 无 streaming 消息时状态不变", () => {
    const state = initialStreamState;
    const next = applyEvent(state, {
      type: "tool_execution_start",
      toolCallId: "t1",
      toolName: "Read",
      args: {},
    });

    expect(next).toBe(state);
  });

  it("tool_execution_end 成功时写入 done 与 result", () => {
    const state = applyEvent(startAssistant("a1"), {
      type: "tool_execution_start",
      toolCallId: "t1",
      toolName: "Read",
      args: {},
    });
    const next = applyEvent(state, {
      type: "tool_execution_end",
      toolCallId: "t1",
      result: "content",
      isError: false,
    });

    expect(next.messages[0].toolCalls?.[0]).toMatchObject({
      status: "done",
      result: "content",
    });
  });

  it("tool_execution_end 失败时写入 error", () => {
    const state = applyEvent(startAssistant("a1"), {
      type: "tool_execution_start",
      toolCallId: "t1",
      toolName: "Read",
      args: {},
    });
    const next = applyEvent(state, {
      type: "tool_execution_end",
      toolCallId: "t1",
      result: "err",
      isError: true,
    });

    expect(next.messages[0].toolCalls?.[0]).toMatchObject({
      status: "error",
      result: "err",
    });
  });

  it("tool_execution_end 找不到 toolCallId 时状态不变", () => {
    const state = startAssistant("a1");
    const next = applyEvent(state, {
      type: "tool_execution_end",
      toolCallId: "missing",
      result: "x",
      isError: false,
    });

    expect(next).toBe(state);
  });

  it("agent_end willRetry=false 时 isRunning=false", () => {
    const state: StreamState = { ...initialStreamState, isRunning: true };
    const next = applyEvent(state, { type: "agent_end", willRetry: false });

    expect(next.isRunning).toBe(false);
  });

  it("agent_end willRetry=true 时 isRunning 保持", () => {
    const state: StreamState = { ...initialStreamState, isRunning: true };
    const next = applyEvent(state, { type: "agent_end", willRetry: true });

    expect(next.isRunning).toBe(true);
  });

  it("message_end 清空 streamingId", () => {
    const next = applyEvent(startAssistant("a1"), { type: "message_end" });

    expect(next.streamingId).toBeNull();
  });

  it("多轮事件序列流转正确", () => {
    let state: StreamState = { ...initialStreamState, isRunning: true };
    state = applyEvent(state, {
      type: "message_start",
      id: "a1",
      role: "assistant",
    });
    state = applyEvent(state, { type: "message_update", content: "hi" });
    state = applyEvent(state, {
      type: "tool_execution_start",
      toolCallId: "t1",
      toolName: "Read",
      args: {},
    });
    state = applyEvent(state, {
      type: "tool_execution_end",
      toolCallId: "t1",
      result: "done",
      isError: false,
    });
    state = applyEvent(state, { type: "message_end" });
    state = applyEvent(state, { type: "agent_end", willRetry: false });

    const msg = state.messages[0] as ChatMessage;
    expect(msg.content).toBe("hi");
    expect(msg.toolCalls?.[0]).toMatchObject({ status: "done" });
    expect(state.streamingId).toBeNull();
    expect(state.isRunning).toBe(false);
  });
});
