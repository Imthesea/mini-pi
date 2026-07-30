/**
 * 工具执行管线的内部类型。
 *
 * 这些类型描述了"准备→执行→finalize"三阶段的中间状态,
 * 不暴露到公共 API（agent-loop.ts 不再 re-export 它们）。
 */

import type {
  AgentContext,
  AgentTool,
  AgentToolCall,
  AgentToolResult,
} from "../../types.js";
import type { AssistantMessage } from "@mimi/ai";

/** prepare 阶段的"已就绪"结果：可以直接 execute */
export interface PreparedToolCall {
  kind: "prepared";
  toolCall: AgentToolCall;
  tool: AgentTool<any>;
  args: unknown;
}

/** prepare 阶段的"立即终结"结果：跳过 execute,直接生成 toolResult
 *  场景：工具未找到 / 参数校验失败 / beforeToolCall block / signal 已 abort */
export interface ImmediateToolCallOutcome {
  kind: "immediate";
  result: AgentToolResult<any>;
  isError: boolean;
}

/** prepare 阶段返回的两种可能 */
export type PrepareResult = PreparedToolCall | ImmediateToolCallOutcome;

/** execute 阶段的结果：工具已执行完,但 before/after 钩子未跑 */
export interface ExecutedToolCallOutcome {
  result: AgentToolResult<any>;
  isError: boolean;
}

/** finalize 阶段的结果：before/after 钩子已应用,可以直接 emit toolResult 消息 */
export interface FinalizedToolCallOutcome {
  toolCall: AgentToolCall;
  result: AgentToolResult<any>;
  isError: boolean;
}

/** 一个批次执行后的结果(sequential / parallel 通用) */
export interface ExecutedToolCallBatch {
  messages: import("@mimi/ai").ToolResultMessage[];
  /** 当批次内所有 finalized tool result 的 terminate 都为 true 时,loop 应停止 */
  terminate: boolean;
}

/** sequential 模式的累加器项：prepared 立即派发 / prepared 加入待执行队列 */
export type FinalizedToolCallEntry =
  | FinalizedToolCallOutcome
  | (() => Promise<FinalizedToolCallOutcome>);

/** prepare 阶段需要的入参 */
export interface PrepareInput {
  context: AgentContext;
  assistantMessage: AssistantMessage;
  toolCall: AgentToolCall;
  config: import("../../types.js").AgentLoopConfig;
  signal: AbortSignal | undefined;
}
