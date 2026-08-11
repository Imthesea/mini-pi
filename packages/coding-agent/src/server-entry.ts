/**
 * Web 服务启动入口。由 main.ts 在 --serve 模式下调用。
 */
import type { SettingsManager } from "./core/settings-manager.js";
import type { SessionManager } from "./core/session-manager.js";

export interface ServeOptions {
  port: number;
  cwd: string;
  settingsManager: SettingsManager;
  sessionManager: SessionManager;
}

export async function startServe(options: ServeOptions): Promise<void> {
  // 动态导入 server 包（避免非 serve 模式下的依赖）
  const { startServer } = await import("@mimi/server");
  await startServer(options);
}
