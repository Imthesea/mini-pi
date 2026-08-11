/**
 * HTTP 应用：路由分发。
 */
import type { IncomingMessage, ServerResponse } from "http";
import type { createAuth } from "./auth.js";
import type { createWsServer } from "./ws-server.js";
import type { createAgentBridge } from "./agent-bridge.js";
import type { SessionManager } from "@mimi/coding-agent";
import { handleAuth } from "./routes/auth.js";
import { handleSessions } from "./routes/sessions.js";
import { handleSetup } from "./routes/setup.js";
import { handleStatic } from "./static-handler.js";

export interface AppDeps {
  auth: ReturnType<typeof createAuth>;
  wsServer: ReturnType<typeof createWsServer>;
  agentBridge: ReturnType<typeof createAgentBridge>;
  sessionManager: SessionManager;
  cwd: string;
}

export function createApp(deps: AppDeps) {
  function handleRequest(req: IncomingMessage, res: ServerResponse): void {
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, DELETE, OPTIONS",
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization",
    );

    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }

    const url = req.url ?? "/";

    // API 路由
    if (url === "/api/auth" && req.method === "POST") {
      handleAuth(req, res, () => deps.auth.issueToken());
      return;
    }

    if (url.startsWith("/api/sessions")) {
      handleSessions(req, res, url, deps.cwd).catch(() => {
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Internal Server Error" }));
        }
      });
      return;
    }

    if (url.startsWith("/api/setup")) {
      handleSetup(req, res, url, deps.cwd).catch(() => {
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Internal Server Error" }));
        }
      });
      return;
    }

    // 静态文件
    if (!url.startsWith("/api/")) {
      handleStatic(req, res, url);
      return;
    }

    // 未知 API 路由
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not Found" }));
  }

  return { handleRequest };
}
