/**
 * harness 模块公共 API 入口。
 *
 * 导出 AgentHarness 主类 + 相关类型 + 钩子接口占位。
 * 具体的 getXxx / setXxx / prompt 等方法通过 prototype 注入,
 * 用户只需 import { AgentHarness } 即可使用全部公共 API。
 */

// ── 主类(包含 config / prompt / subscribe 等全部方法) ──
export { AgentHarness, isAgentHarness } from "./agent-harness/agent-harness.js";
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
