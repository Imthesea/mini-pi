/**
 * 会话 REST API：列表、创建、删除、历史消息分页。
 */
import type { IncomingMessage, ServerResponse } from "http";
import { SessionManager } from "@mimi/coding-agent";

/** 解析 URL query 参数 */
function getQuery(url: string): URLSearchParams {
  const idx = url.indexOf("?");
  return new URLSearchParams(idx >= 0 ? url.slice(idx + 1) : "");
}

export async function handleSessions(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  cwd: string,
): Promise<void> {
  // POST /api/sessions - 创建新会话
  if (url === "/api/sessions" && req.method === "POST") {
    const sm = SessionManager.create(cwd);
    const id = sm.getSessionId();
    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id }));
    return;
  }

  // GET /api/sessions - 会话列表
  if (url === "/api/sessions" && req.method === "GET") {
    const sessions = await SessionManager.list(cwd);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify(
        sessions.map((s) => ({
          id: s.id,
          path: s.path,
          cwd: s.cwd,
          messageCount: s.messageCount,
          firstMessage: s.firstMessage,
        })),
      ),
    );
    return;
  }

  // /api/sessions/:id...
  const match = url.match(/^\/api\/sessions\/([^/?]+)(.*)$/);
  if (!match) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not Found" }));
    return;
  }

  const sessionId = match[1];
  const rest = match[2];

  // GET /api/sessions/:id/messages - 历史消息分页
  if (rest === "/messages" && req.method === "GET") {
    const sessions = await SessionManager.list(cwd);
    const info = sessions.find((s) => s.id === sessionId);
    if (!info) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Session not found" }));
      return;
    }

    const sm = SessionManager.open(info.path);
    const entries = sm.getEntries();

    // 只取 message 类型的条目
    const messages = entries.filter((e) => e.type === "message");

    const query = getQuery(url);
    const limit = Math.min(parseInt(query.get("limit") ?? "50", 10) || 50, 200);
    const beforeId = query.get("before");

    // cursor 分页
    let result: typeof messages;
    let hasMore = false;

    if (beforeId) {
      const idx = messages.findIndex((m) => m.id === beforeId);
      if (idx <= 0) {
        result = [];
      } else {
        const start = Math.max(0, idx - limit);
        hasMore = start > 0;
        result = messages.slice(start, idx);
      }
    } else {
      // 默认返回最新 N 条
      const start = Math.max(0, messages.length - limit);
      hasMore = start > 0;
      result = messages.slice(start);
    }

    const oldestId = result.length > 0 ? result[0].id : null;

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        messages: result,
        hasMore,
        oldestId,
      }),
    );
    return;
  }

  // DELETE /api/sessions/:id - 删除会话
  if (rest === "" && req.method === "DELETE") {
    const sessions = await SessionManager.list(cwd);
    const info = sessions.find((s) => s.id === sessionId);
    if (!info) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Session not found" }));
      return;
    }

    try {
      const fs = await import("fs");
      fs.unlinkSync(info.path);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to delete session" }));
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not Found" }));
}
