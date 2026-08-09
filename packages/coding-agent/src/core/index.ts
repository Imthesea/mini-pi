/**
 * core 模块导出入口。
 * 随各 Task 逐步补全。
 */

export {
  SessionManager,
  type SessionInfo,
  type SessionEntry,
} from "./session-manager.js";
export { ModelRegistry } from "./model-registry.js";
export {
  ModelRuntime,
  type ModelRuntimeAuthOverrides,
} from "./model-runtime.js";
export {
  resolveModel,
  findExactModelReferenceMatch,
  defaultModelPerProvider,
} from "./model-resolver.js";
export {
  AgentSession,
  type AgentSessionConfig,
  type PromptOptions,
  type SessionStats,
  type AgentSessionEventListener,
} from "./agent-session.js";
export {
  AgentSessionRuntime,
  type AgentSessionRuntimeDiagnostic,
} from "./agent-session-runtime.js";
export type { AgentSessionServices } from "./agent-session-services.js";
export {
  createAgentSession,
  type CreateAgentSessionOptions,
  type CreateAgentSessionResult,
} from "./sdk.js";
