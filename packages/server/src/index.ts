/**
 * @mimi/server 入口。导出 startServer() 供 @mimi/coding-agent 调用。
 */
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { WebSocketServer } from "ws";
import {
  SessionManager,
  createAgentSessionFromServices,
  type AgentSessionServices,
  type ServeOptions,
} from "@mimi/coding-agent";
import { createAuth } from "./auth.js";
import { createApp } from "./app.js";
import { createWsServer } from "./ws-server.js";
import { createAgentBridge } from "./agent-bridge.js";
import { URL } from "url";

export async function startServer(options: ServeOptions): Promise<void> {
  const { port, cwd, services, settingsManager } = options;
  const auth = createAuth();

  // 从全局设置获取默认 model / thinkingLevel
  const defaultModel = settingsManager.getDefaultModel() ?? "";
  const defaultThinkingLevel =
    settingsManager.getDefaultThinkingLevel() ?? "none";

  // WebSocket 消息处理
  const wsServer = createWsServer({
    async onMessage(ws, msg) {
      const agentSession = agentBridge.getSession(ws);
      if (!agentSession) return;

      if (msg.type === "message") {
        await agentSession.prompt(msg.content);
      } else if (msg.type === "stop") {
        agentSession.abort();
      }
    },
    onClose(ws) {
      const session = agentBridge.getSession(ws);
      if (session) {
        agentBridge.unbindSession(ws);
      }
    },
  });

  const agentBridge = createAgentBridge(wsServer);

  const app = createApp({
    auth,
    wsServer,
    agentBridge,
    sessionManager: options.sessionManager,
    cwd,
  });

  const httpServer = createServer(
    (req: IncomingMessage, res: ServerResponse) => {
      app.handleRequest(req, res);
    },
  );

  // WebSocket 升级处理
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    const url = req.url ?? "";
    if (!url.startsWith("/ws")) {
      socket.destroy();
      return;
    }

    // 解析 query: /ws?session=xxx
    const parsed = new URL(url, "http://localhost");
    const sessionId = parsed.searchParams.get("session");

    if (!sessionId) {
      socket.destroy();
      return;
    }

    // 通过 list 找到 sessionId 对应的文件路径
    SessionManager.list(cwd)
      .then((sessions) => {
        const info = sessions.find((s) => s.id === sessionId);
        if (!info) {
          socket.destroy();
          return;
        }

        wss.handleUpgrade(req, socket, head, (ws) => {
          try {
            // 打开持久化 session
            const sessionManager = SessionManager.open(info.path);
            // 创建 AgentSession（加载历史消息 + 绑定 agent 循环）
            const agentSession = createAgentSessionFromServices({
              services: { ...services, sessionManager },
              sessionManager,
              model: defaultModel,
              thinkingLevel: defaultThinkingLevel,
            });
            agentBridge.bindSession(ws, agentSession);
            wss.emit("connection", ws, req);
            wsServer.handleConnection(ws, req);
          } catch {
            ws.close(4000, "Session not found");
          }
        });
      })
      .catch(() => {
        socket.destroy();
      });
  });

  // 启动服务
  httpServer.listen(port, "127.0.0.1", () => {
    console.log(`\n  WebUI → http://127.0.0.1:${port}\n`);
  });

  // 保持进程存活
  await new Promise(() => {});
}
