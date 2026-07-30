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
