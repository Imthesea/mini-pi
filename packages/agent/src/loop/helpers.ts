/**
 * agent-loop 内部共用辅助函数。
 *
 * 包含：
 * - createErrorToolResult：构造错误状态下的 toolResult
 * - emitToolExecutionEnd / emitToolResultMessage：把 finalized 结果转为事件
 * - shouldTerminateToolBatch：判断批次是否该终止
 */

import type { AgentEvent, AgentToolResult } from "../types.js";
import type { ToolResultMessage } from "@mimi/ai";
import type { FinalizedToolCallOutcome } from "./tool-execution/types.js";

/** 事件 sink：可同步或异步 */
export type AgentEventSink = (event: AgentEvent) => Promise<void> | void;

/** 构造一个 isError=true 的 toolResult(用于校验失败 / block / abort 等场景) */
export function createErrorToolResult(message: string): AgentToolResult<any> {
  return {
    content: [{ type: "text", text: message }],
    details: {},
  };
}

/** 派发 `tool_execution_end` 事件 */
export async function emitToolExecutionEnd(
  finalized: FinalizedToolCallOutcome,
  emit: AgentEventSink,
): Promise<void> {
  await emit({
    type: "tool_execution_end",
    toolCallId: finalized.toolCall.id,
    toolName: finalized.toolCall.name,
    result: finalized.result,
    isError: finalized.isError,
  });
}

/** 派发 toolResult 消息的 start / end 事件 */
export async function emitToolResultMessage(
  toolResultMessage: ToolResultMessage,
  emit: AgentEventSink,
): Promise<void> {
  await emit({ type: "message_start", message: toolResultMessage });
  await emit({ type: "message_end", message: toolResultMessage });
}

/** 把 finalized 结果转为 ToolResultMessage 消息 */
export function createToolResultMessage(finalized: FinalizedToolCallOutcome): ToolResultMessage {
  // details / addedToolNames 是 AgentToolResult 的字段,AI 层 ToolResultMessage 不包含;
  // agent 层把它们透传到 ToolResultMessage 上,harness 层(未来 Task)会用到。
  // 用中间对象规避 tsc 对 excess property 的检查,最后用 cast 收口。
  const extra: { details?: unknown; addedToolNames?: string[] } = {
    details: finalized.result.details,
  };
  if (finalized.result.addedToolNames?.length) {
    extra.addedToolNames = finalized.result.addedToolNames;
  }
  return {
    role: "toolResult",
    toolCallId: finalized.toolCall.id,
    toolName: finalized.toolCall.name,
    content: finalized.result.content ?? [],
    ...extra,
    isError: finalized.isError,
    timestamp: Date.now(),
  } as ToolResultMessage;
}

/** 批次是否应终止:批次非空,且所有 finalized result 都设 terminate=true */
export function shouldTerminateToolBatch(
  finalizedCalls: FinalizedToolCallOutcome[],
): boolean {
  return (
    finalizedCalls.length > 0 &&
    finalizedCalls.every((f) => f.result.terminate === true)
  );
}
