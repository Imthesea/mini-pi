import { describe, it, expect, vi } from "vitest";
import { createWsServer } from "../ws-server.js";

describe("createWsServer", () => {
  it("send 序列化事件为 JSON", () => {
    const server = createWsServer({
      onMessage: vi.fn(),
      onClose: vi.fn(),
    });
    let received = "";
    const mockWs = {
      OPEN: 1,
      readyState: 1,
      send(data: string) {
        received = data;
      },
      on(_e: string, _cb: () => void) {},
    };
    server.send(mockWs as any, { type: "delta", text: "hello" });
    expect(JSON.parse(received)).toEqual({ type: "delta", text: "hello" });
  });

  it("send 忽略非 OPEN 状态的连接", () => {
    const server = createWsServer({
      onMessage: vi.fn(),
      onClose: vi.fn(),
    });
    let called = false;
    const mockWs = {
      OPEN: 1,
      readyState: 2, // CLOSING
      send() {
        called = true;
      },
      on(_e: string, _cb: () => void) {},
    };
    server.send(mockWs as any, { type: "delta" });
    expect(called).toBe(false);
  });
});
