import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useWebSocket } from "./useWebSocket";
import { FakeWebSocket } from "../test/fake-websocket";

vi.mock("../lib/api", () => ({
  authenticate: vi.fn().mockResolvedValue(undefined),
}));

import { authenticate } from "../lib/api";

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.mocked(authenticate).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useWebSocket", () => {
  it("认证后建立连接", async () => {
    renderHook(() => useWebSocket({ sessionId: "s1" }));

    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    expect(FakeWebSocket.instances[0].url).toContain("session=s1");
  });

  it("sessionId 变化时关闭旧连接并建立新连接", async () => {
    const { rerender } = renderHook(
      ({ sessionId }: { sessionId: string }) => useWebSocket({ sessionId }),
      { initialProps: { sessionId: "s1" } },
    );

    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));

    rerender({ sessionId: "s2" });
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2));

    expect(FakeWebSocket.instances[0].closed).toBe(true);
    expect(FakeWebSocket.instances[1].url).toContain("session=s2");
  });

  it("卸载时关闭连接", async () => {
    const { unmount } = renderHook(() => useWebSocket({ sessionId: "s1" }));

    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));

    unmount();
    expect(FakeWebSocket.instances[0].closed).toBe(true);
  });
});
