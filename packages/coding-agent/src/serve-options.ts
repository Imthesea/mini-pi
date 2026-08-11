/**
 * Web 服务启动选项类型定义。
 * 由 @mimi/server 使用，定义在 coding-agent 中以避免循环 workspace 依赖。
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
