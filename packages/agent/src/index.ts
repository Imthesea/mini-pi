/**
 * @mimi/agent —— Agent 运行时层。
 *
 * 当前仅导出共用类型,后续 Task 逐步补充:
 * - agent-loop: 核心 LLM → tool → repeat 循环
 * - harness: AgentHarness 主类、会话、钩子、压缩、Skills、Templates
 *
 * 使用方式:
 *   import type { AgentTool, AgentContext, QueueMode } from "@mimi/agent";
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
  Context,
  Message,
  Model,
  TextContent,
  ThinkingContent,
  Tool,
  ToolResultMessage,
  UserMessage,
} from "@mimi/ai";
