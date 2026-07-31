/**
 * harness 模块公共 API 入口。
 *
 * 导出 AgentHarness 主类 + 相关类型 + 钩子接口占位。
 * 具体的 getXxx / setXxx / prompt 等方法通过 prototype 注入,
 * 用户只需 import { AgentHarness } 即可使用全部公共 API。
 */

// ── 主类(包含 config / prompt / subscribe 等全部方法) ──
export { AgentHarness } from "./agent-harness/agent-harness.js";
export { isAgentHarness } from "./agent-harness/is-agent-harness.js";
export type { Subscription } from "./agent-harness/event-bus.js";

// ── Phase ──
export {
  type AgentHarnessPhase,
  PHASE_TRANSITIONS,
  canTransition,
  assertPhase,
} from "./phase.js";

// ── 错误 ──
export { AgentHarnessError, PhaseError, HarnessConfigError } from "./errors.js";

// ── Session(Task 5 新增) ──
//
// Session 主类 + 树形 entry 类型 + Storage 接口 + 双后端 repo。
// 用户使用 `JsonlSessionRepo` 持久化,`InMemorySessionRepo` 测试用。
export {
  Session,
  buildContextEntries,
  buildSessionContext,
  defaultContextEntryTransform,
  sessionEntryToContextMessages,
  type ContextEntryTransform,
  type CustomEntryContextMessageProjector,
  type SessionContextBuildOptions,
} from "./session/session.js";
export {
  type SessionStorage,
  type SessionRepo,
  type SessionCreateOptions,
  type SessionForkOptions,
  // JSONL 后端专用
  type JsonlSessionRepoApi,
  type JsonlSessionCreateOptions,
  type JsonlSessionListOptions,
  buildLeafEntry,
} from "./session/storage.js";
export {
  type SessionTreeEntry,
  type MessageEntry,
  type ThinkingLevelChangeEntry,
  type ModelChangeEntry,
  type ActiveToolsChangeEntry,
  type CompactionEntry,
  type BranchSummaryEntry,
  type CustomEntry,
  type CustomMessageEntry,
  type LabelEntry,
  type SessionInfoEntry,
  type LeafEntry,
  type SessionMetadata,
  type JsonlSessionMetadata,
  type SessionContext,
  type SessionErrorCode,
  SessionError,
} from "./session/types.js";
export { InMemorySessionStorage } from "./session/repos/memory-storage.js";
export { InMemorySessionRepo } from "./session/repos/memory-repo.js";
export { JsonlSessionStorage } from "./session/repos/jsonl-storage.js";
export { JsonlSessionRepo } from "./session/repos/jsonl-repo.js";

// ── env(Task 5 新增) ──
//
// ExecutionEnv 接口 + NodeExecutionEnv 实现 + 错误类型。
export {
  type ExecutionEnv,
  type ExecOptions,
  type ExecResult,
  type FileInfo,
  type FileKind,
  type FileErrorCode,
  type ExecutionErrorCode,
  type Result,
  type ToFileSystemErrorOptions,
  NodeExecutionEnv,
  FileError,
  ExecutionError,
  ok,
  err,
  toFileSystemError,
  toExecutionError,
  getResultOrThrow,
} from "./env/index.js";

// ── 类型 ──
export type {
  Skill,
  PromptTemplate,
  HookEvent,
  HookHandler,
  HookObserver,
} from "./types/harness.js";

export type { AgentHarnessEvent } from "./types/events.js";

export type {
  AgentHarnessOptions,
  AgentHarnessResources,
  AgentHarnessStreamOptions,
  SystemPromptContext,
  HarnessStreamFn,
  QueueMode,
} from "./types/options.js";

// ── 消息工具 ──
export { convertToLlm } from "./messages/convert.js";
export { buildAssistantMessage } from "./messages/assistant.js";
export {
  getDefaultCustomProjector,
  mapCustomToUserMessages,
  type CustomProjector,
} from "./messages/custom.js";

// ── System Prompt ──
export {
  buildSystemPrompt,
  formatSkillsBlock,
  joinParts,
  type SystemPromptInput,
} from "./system-prompt/index.js";

// ── 钩子系统(Task 4 新增) ──
//
// 完整 API 见 ./hooks/index.ts。本文件 re-export 是为用户方便
// (用户从 @mimi/agent 顶层 import 时不必关心子目录)。
export {
  DefaultAgentHarnessHooks,
  type DefaultAgentHarnessHooksOptions,
  // 8 核心事件类型
  type ContextHookEvent,
  type BeforeAgentStartHookEvent,
  type ToolCallHookEvent,
  type ToolResultHookEvent,
  type MessageEndHookEvent,
  type SessionBeforeCompactHookEvent,
  type ModelUpdateHookEvent,
  type AbortHookEvent,
  // 9 预声明事件类型
  type BeforeProviderRequestHookEvent,
  type BeforeProviderPayloadHookEvent,
  type AfterProviderResponseHookEvent,
  type SessionCompactHookEvent,
  type SessionBeforeTreeHookEvent,
  type SessionTreeHookEvent,
  type ThinkingLevelUpdateHookEvent,
  type ResourcesUpdateHookEvent,
  type ToolsUpdateHookEvent,
  type QueueUpdateHookEvent,
  type SavePointHookEvent,
  type SettledHookEvent,
  // 公共联合类型
  type AgentHarnessHookEvent,
  type AgentHarnessHookName,
  type AgentHarnessHookContext,
  type AgentHarnessHookContextFacade,
  type ResultOf,
  type SessionFacade,
  type ModelFacade,
} from "./hooks/index.js";

// ── 压缩(Task 6 新增) ──
//
// compact / branch-summarization / estimate / prepare + settings 全部公共 API。
// 用户从 @mimi/agent 顶层 import 时不必关心子目录。
export {
  // 主入口
  compact,
  generateBranchSummary,
  collectEntriesForBranchSummary,
  // 工具
  estimateTokens,
  prepareCompaction,
  extractFileOpsFromMessage,
  // 设置
  DEFAULT_COMPACTION_SETTINGS,
  shouldCompact,
  // 类型
  type CompactionSettings,
  type CompactOptions,
  type CompactionPreparation,
  type CompactionResult,
  type CompactionDetails,
  type BranchSummaryOptions,
  type BranchSummaryResult,
  type BranchSummaryDetails,
  type TokenEstimationInput,
  type KeptEntries,
} from "./compaction/index.js";

// ── Skills(Task 7 新增) ──
//
// format / parse / load + Skill / SkillArgs 类型。
// harness.skill(name, args) 走 prompt,见 agent-harness.ts。
export {
  // 格式
  formatSkillsForSystemPrompt,
  formatSkillInvocation,
  // 解析 + 加载
  parseSkillContent,
  loadSkillFromFile,
  // 错误
  SkillParseError,
  // 类型
  type SkillFrontmatter,
  type ParsedSkill,
  type SkillArgs,
} from "./skills/index.js";

// ── Prompt Templates(Task 7 新增) ──
//
// formatPromptTemplateInvocation + PromptTemplate 类型。
// harness.promptFromTemplate(name, args) 走 prompt,见 agent-harness.ts。
export {
  formatPromptTemplateInvocation,
  type PromptTemplateArgs,
} from "./prompt-templates/index.js";
