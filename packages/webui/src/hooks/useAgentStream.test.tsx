import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useAgentStream } from "./useAgentStream";

const mocks = vi.hoisted(() => {
  const handlers: Array<(e: unknown) => void> = [];
  return {
    handlers,
    send: vi.fn(),
    request: vi.fn(),
    onEvent: (handler: (e: unknown) => void) => {
      handlers.push(handler);
      return () => {};
    },
  };
});

vi.mock("./useWebSocket", () => ({
  useWebSocket: () => ({
    send: mocks.send,
    onEvent: mocks.onEvent,
  }),
}));

vi.mock("../lib/api", () => ({
  request: mocks.request,
}));

function emit(event: unknown) {
  act(() => {
    mocks.handlers.forEach((h) => h(event));
  });
}

/** 渲染 hook 并等待历史加载完成，避免异步 setState 落在 act 外 */
async function renderStream() {
  const utils = renderHook(() => useAgentStream({ sessionId: "s1" }));
  await waitFor(() => expect(mocks.request).toHaveBeenCalled());
  await act(async () => {});
  return utils;
}

beforeEach(() => {
  mocks.handlers.length = 0;
  mocks.send.mockReset();
  mocks.request.mockReset();
  mocks.request.mockResolvedValue({ messages: [], hasMore: false });
});

describe("useAgentStream", () => {
  it("加载历史消息", async () => {
    mocks.request.mockResolvedValue({
      messages: [{ id: "m1", message: { role: "user", content: "hi" } }],
      hasMore: false,
    });

    const { result } = await renderStream();

    expect(result.current.messages).toEqual([
      { id: "m1", role: "user", content: "hi" },
    ]);
  });

  it("message_start(assistant) 追加空 assistant", async () => {
    const { result } = await renderStream();

    emit({ type: "message_start", message: { id: "x", role: "assistant" } });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].role).toBe("assistant");
    expect(result.current.messages[0].content).toBe("");
  });

  it("工具内嵌到 streaming 消息 toolCalls，而非平铺", async () => {
    const { result } = await renderStream();

    emit({ type: "message_start", message: { id: "x", role: "assistant" } });
    emit({
      type: "tool_execution_start",
      toolCallId: "t1",
      toolName: "Read",
      args: { filePath: "a.txt" },
    });
    emit({
      type: "tool_execution_end",
      toolCallId: "t1",
      toolName: "Read",
      result: "ok",
      isError: false,
    });

    const msg = result.current.messages[0];
    expect(msg.toolCalls).toEqual([
      {
        toolCallId: "t1",
        toolName: "Read",
        status: "done",
        args: { filePath: "a.txt" },
        result: "ok",
      },
    ]);
  });

  it("sendMessage 乐观追加 user 并发送", async () => {
    const { result } = await renderStream();

    act(() => result.current.sendMessage("hello"));

    expect(
      result.current.messages.some(
        (m) => m.role === "user" && m.content === "hello",
      ),
    ).toBe(true);
    expect(mocks.send).toHaveBeenCalledWith({
      type: "message",
      content: "hello",
    });
  });

  it("stopAgent 发送 stop", async () => {
    const { result } = await renderStream();

    act(() => result.current.stopAgent());

    expect(mocks.send).toHaveBeenCalledWith({ type: "stop" });
  });

  it("agent_end willRetry=false 时 isRunning=false", async () => {
    const { result } = await renderStream();

    act(() => result.current.sendMessage("x"));
    expect(result.current.isRunning).toBe(true);

    emit({ type: "agent_end", messages: [], willRetry: false });

    expect(result.current.isRunning).toBe(false);
  });
});
