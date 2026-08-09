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
  SettingsManager,
  FileSettingsStorage,
  InMemorySettingsStorage,
  type Settings,
  type SettingsStorage,
  type SettingsError,
  type SettingsScope,
  type SettingsManagerCreateOptions,
  type CompactionSettings,
  type RetrySettings,
  type TerminalSettings,
  type ImageSettings,
  type ThinkingBudgetsSettings,
  type DefaultProjectTrust,
} from "./settings-manager.js";
export {
  createAgentSession,
  type CreateAgentSessionOptions,
  type CreateAgentSessionResult,
} from "./sdk.js";
// Task 7
export { buildSystemPrompt, type BuildSystemPromptOptions } from "./system-prompt.js";
export { convertToLlm } from "./messages.js";
export { executeBashWithOperations, type BashExecutorOptions, type BashResult } from "./bash-executor.js";
export {
  compact,
  prepareCompaction,
  generateSummary,
  estimateTokens,
  estimateContextTokens,
  calculateContextTokens,
  findCutPoint,
  findTurnStartIndex,
  getLastAssistantUsage,
  shouldCompact,
  DEFAULT_COMPACTION_SETTINGS,
  type CompactionResult,
  type CompactionPreparation,
  type CutPointResult,
  type ContextUsageEstimate,
} from "./compaction/index.js";
export { serializeConversation, SUMMARIZATION_SYSTEM_PROMPT } from "./compaction/utils.js";
export {
  COMPACTION_SUMMARY_PREFIX,
  COMPACTION_SUMMARY_SUFFIX,
  type CompactionSummaryMessage,
  type BranchSummaryMessage,
} from "./messages.js";
