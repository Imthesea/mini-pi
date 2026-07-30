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
