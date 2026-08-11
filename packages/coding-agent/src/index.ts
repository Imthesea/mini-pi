/**
 * @mimi/coding-agent —— mimi CLI 产品层。
 *
 * 严格对齐 pi 项目架构。
 */

// 公共 API 随各 Task 逐步补全
export { APP_NAME, APP_TITLE, VERSION, getAgentDir, getPackageDir } from "./config.js";
export { DEFAULT_MODEL, DEFAULT_THINKING_LEVEL } from "./defaults.js";
export {
  SessionManager,
  type SessionInfo,
  type SessionEntry,
  AgentSession,
  type AgentSessionEvent,
  type AgentSessionConfig,
  type PromptOptions,
  type SessionStats,
  type AgentSessionEventListener,
} from "./core/index.js";
export { ModelRegistry, ModelRuntime, resolveModel } from "./core/index.js";
export {
  createAgentSessionFromServices,
  type AgentSessionServices,
} from "./core/index.js";
export { SettingsManager } from "./core/index.js";
export { type ServeOptions } from "./server-entry.js";
