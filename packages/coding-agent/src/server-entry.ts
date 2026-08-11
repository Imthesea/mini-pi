/**
 * Web 服务启动入口。由 main.ts 在 --serve 模式下调用。
 */
import type { SettingsManager } from "./core/settings-manager.js";
import type { SessionManager } from "./core/session-manager.js";
import type { AgentSessionServices } from "./core/agent-session-services.js";

export interface ServeOptions {
  port: number;
  cwd: string;
  settingsManager: SettingsManager;
  sessionManager: SessionManager;
  services: AgentSessionServices;
}

export async function startServe(options: ServeOptions): Promise<void> {
  // 动态导入 server 包，用变量绕过 TS 静态模块解析以打破循环依赖
  const serverModuleId = "@mimi/server";
  const mod = (await import(serverModuleId)) as {
    startServer: (opts: ServeOptions) => Promise<void>;
  };
  await mod.startServer(options);
}
