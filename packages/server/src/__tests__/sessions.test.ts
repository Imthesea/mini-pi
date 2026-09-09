/**
 * handleSessions 单元测试：验证会话路由用 listAll 支持跨 cwd。
 */
import type { IncomingMessage, ServerResponse } from "http";
import { describe, it, expect, vi, afterEach } from "vitest";
import { SessionManager } from "@mimi/coding-agent";
import { handleSessions } from "../routes/sessions.js";

type MockRes = {
  writeHead: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
};

function mockRes(): MockRes {
  return { writeHead: vi.fn(), end: vi.fn() };
}

function mockReq(method: string): IncomingMessage {
  return { method } as unknown as IncomingMessage;
}

const SESSION_A = {
  path: "/a/1.jsonl",
  id: "s1",
  cwd: "/projA",
  messageCount: 1,
  firstMessage: "hi",
};

const SESSION_B = {
  path: "/b/2.jsonl",
  id: "s2",
  cwd: "/projB",
  messageCount: 1,
  firstMessage: "yo",
};

describe("handleSessions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("GET /api/sessions 用 listAll 返回跨 cwd 会话", async () => {
    const listAllSpy = vi
      .spyOn(SessionManager, "listAll")
      .mockResolvedValue([SESSION_A, SESSION_B]);

    const res = mockRes();
    await handleSessions(
      mockReq("GET"),
      res as unknown as ServerResponse,
      "/api/sessions",
      "/projA",
    );

    expect(listAllSpy).toHaveBeenCalled();
    const body = JSON.parse(res.end.mock.calls[0][0] as string);
    expect(body).toHaveLength(2);
    expect(body.map((s: { cwd: string }) => s.cwd)).toEqual([
      "/projA",
      "/projB",
    ]);
  });

  it("GET /api/sessions/:id/messages 通过 listAll 找到跨 cwd 会话", async () => {
    vi.spyOn(SessionManager, "listAll").mockResolvedValue([SESSION_B]);
    const openSpy = vi.spyOn(SessionManager, "open").mockReturnValue({
      getEntries: () => [
        {
          type: "message",
          id: "m1",
          message: { role: "user", content: "hi", timestamp: 1 },
        },
      ],
    } as never);

    const res = mockRes();
    await handleSessions(
      mockReq("GET"),
      res as unknown as ServerResponse,
      "/api/sessions/s2/messages",
      "/projA",
    );

    // 跨 cwd 会话（cwd=/projB）能被打开，无需当前 cwd
    expect(openSpy).toHaveBeenCalledWith("/b/2.jsonl");
    const body = JSON.parse(res.end.mock.calls[0][0] as string);
    expect(body.messages).toHaveLength(1);
  });
});
