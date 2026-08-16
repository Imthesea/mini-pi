import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createWsClient } from "./client";

class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];

  readyState = 0;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 0;
  }
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("createWsClient", () => {
  it("connect 创建 WebSocket 实例", () => {
    const client = createWsClient();
    client.connect("ws://localhost/ws?session=1");

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].url).toBe("ws://localhost/ws?session=1");
  });

  it("onmessage 解析 JSON 并分发给所有 handler", () => {
    const client = createWsClient();
    const handler = vi.fn();
    client.onEvent(handler);
    client.connect("ws://x");

    const ws = FakeWebSocket.instances[0];
    ws.onmessage!({ data: JSON.stringify({ type: "hello" }) });

    expect(handler).toHaveBeenCalledWith({ type: "hello" });
  });

  it("onmessage 忽略非 JSON 消息", () => {
    const client = createWsClient();
    const handler = vi.fn();
    client.onEvent(handler);
    client.connect("ws://x");

    const ws = FakeWebSocket.instances[0];
    ws.onmessage!({ data: "not json" });

    expect(handler).not.toHaveBeenCalled();
  });

  it("send 在 OPEN 状态发送 JSON", () => {
    const client = createWsClient();
    client.connect("ws://x");

    const ws = FakeWebSocket.instances[0];
    ws.readyState = FakeWebSocket.OPEN;
    client.send({ type: "message", content: "hi" });

    expect(ws.sent).toEqual([JSON.stringify({ type: "message", content: "hi" })]);
  });

  it("send 在非 OPEN 状态不发送", () => {
    const client = createWsClient();
    client.connect("ws://x");

    const ws = FakeWebSocket.instances[0];
    client.send({ type: "message", content: "hi" });

    expect(ws.sent).toEqual([]);
  });

  it("close 后不自动重连", () => {
    vi.useFakeTimers();
    const client = createWsClient();
    client.connect("ws://x");
    client.close();

    vi.advanceTimersByTime(5000);

    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("onclose 自动重连", () => {
    vi.useFakeTimers();
    const client = createWsClient();
    client.connect("ws://x");

    const ws = FakeWebSocket.instances[0];
    ws.onclose!();
    vi.advanceTimersByTime(2000);

    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("onEvent 返回取消订阅函数", () => {
    const client = createWsClient();
    const handler = vi.fn();
    const unsubscribe = client.onEvent(handler);

    unsubscribe();
    client.connect("ws://x");
    const ws = FakeWebSocket.instances[0];
    ws.onmessage!({ data: JSON.stringify({ type: "hello" }) });

    expect(handler).not.toHaveBeenCalled();
  });
});
