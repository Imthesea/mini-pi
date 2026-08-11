/**
 * @mimi/server 入口。导出 startServer() 供 @mimi/coding-agent 调用。
 */
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { createAuth } from "./auth.js";
import { createApp } from "./app.js";

export interface ServeOptions {
  port: number;
  cwd: string;
  // Phase 3+ 会替换为具体类型
  settingsManager: unknown;
  sessionManager: unknown;
}

export async function startServer(options: ServeOptions): Promise<void> {
  const { port } = options;
  const auth = createAuth();
  const app = createApp({ auth });

  const httpServer = createServer(
    (req: IncomingMessage, res: ServerResponse) => {
      app.handleRequest(req, res);
    },
  );

  // 启动服务
  httpServer.listen(port, "127.0.0.1", () => {
    console.log(`\n  WebUI → http://127.0.0.1:${port}\n`);
  });

  // 保持进程存活
  await new Promise(() => {});
}
