/**
 * @mimi/agent —— Agent 运行时层。
 *
 * 当前已实现:
 * - 共用类型(AgentMessage / AgentEvent / AgentLoopConfig 等)
 * - agent-loop:核心 LLM → tool → repeat 循环(TODO 后)
 *
 * 使用方式:
 *   import { runAgentLoop, type AgentTool } from "@mimi/agent";
 */

// 公共类型
export type {
  AgentContext,
  AgentEvent,
  AgentLoopConfig,
  AgentLoopTurnUpdate,
  AgentMessage,
  AgentTool,
  AgentToolCall,
  AgentToolResult,
  AgentToolUpdateCallback,
  AfterToolCallContext,
  AfterToolCallResult,
  BeforeToolCallContext,
  BeforeToolCallResult,
  CustomAgentMessages,
  PrepareNextTurnContext,
  QueueMode,
  ShouldStopAfterTurnContext,
  StreamFn,
  ThinkingLevel,
  ToolExecutionMode,
} from "./types.js";

// 复用 AI 层的常用类型,避免上层再 import 一遍 @mimi/ai
export type {
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  Context,
  Message,
  Model,
  TextContent,
  ThinkingContent,
  Tool,
  ToolResultMessage,
  UserMessage,
} from "@mimi/ai";

// agent-loop 公共 API
// 注意:不再有 agentLoopContinue / runAgentLoopContinue。
// "继续" 通过传空数组 prompts = [] 表达(详见 agent-loop.ts 顶部注释)。
export {
  agentLoop,
  runAgentLoop,
  type AgentEventSink,
} from "./agent-loop.js";

// ── Harness 公共 API(Task 3 新增) ──
export {
  AgentHarness,
  isAgentHarness,
  type Subscription,
  // Phase
  type AgentHarnessPhase,
  PHASE_TRANSITIONS,
  canTransition,
  assertPhase,
  // 错误
  AgentHarnessError,
  PhaseError,
  HarnessConfigError,
  // 消息工具
  convertToLlm,
  buildAssistantMessage,
  getDefaultCustomProjector,
  mapCustomToUserMessages,
  type CustomProjector,
  // System Prompt
  buildSystemPrompt,
  formatSkillsBlock,
  joinParts,
  type SystemPromptInput,
  // 类型
  type Skill,
  type PromptTemplate,
  type HookEvent,
  type HookHandler,
  type HookObserver,
  type AgentHarnessEvent,
  type AgentHarnessOptions,
  type AgentHarnessResources,
  type AgentHarnessStreamOptions,
  type SystemPromptContext,
  type HarnessStreamFn,
  // 钩子系统(Task 4 新增)
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
  // 钩子公共联合类型
  type AgentHarnessHookEvent,
  type AgentHarnessHookName,
  type AgentHarnessHookContext,
  type AgentHarnessHookContextFacade,
  type ResultOf,
  type SessionFacade,
  type ModelFacade,
  // Session(Task 5 新增)
  Session,
  buildContextEntries,
  buildSessionContext,
  defaultContextEntryTransform,
  sessionEntryToContextMessages,
  type ContextEntryTransform,
  type CustomEntryContextMessageProjector,
  type SessionContextBuildOptions,
  type SessionStorage,
  type SessionRepo,
  type SessionCreateOptions,
  type SessionForkOptions,
  // JSONL 后端专用
  type JsonlSessionRepoApi,
  type JsonlSessionCreateOptions,
  type JsonlSessionListOptions,
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
  InMemorySessionStorage,
  InMemorySessionRepo,
  JsonlSessionStorage,
  JsonlSessionRepo,
  // env(Task 5 新增)
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
} from "./harness/index.js";
