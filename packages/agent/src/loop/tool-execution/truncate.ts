/**
 * 处理"输出 token 耗尽"导致的截断工具调用。
 *
 * 当 assistant message 因为 `stopReason === "length"` 被截断时,
 * 它可能携带了"看起来有效但实际不完整"的 tool call 参数（TypeBox coerce 会修复语法错误但不修复语义截断），
 * 任何一个都不应被执行,直接转为 isError=true 的 tool result。
 */

import {
  createErrorToolResult,
  createToolResultMessage,
  emitToolExecutionEnd,
  emitToolResultMessage,
  type AgentEventSink,
} from "../helpers.js";
import type { AgentToolCall } from "../../types.js";
import type { ExecutedToolCallBatch, FinalizedToolCallOutcome } from "./types.js";
import type { ToolResultMessage } from "@mimi/ai";

/**
 * 把所有截断产生的 tool call 标记为错误,不执行实际工具。
 *
 * @returns 含 messages + terminate=false 的批次
 *          （截断应让模型重发,不该终止 loop）
 */
export async function failToolCallsFromTruncatedMessage(
  toolCalls: AgentToolCall[],
  emit: AgentEventSink,
): Promise<ExecutedToolCallBatch> {
  const messages: ToolResultMessage[] = [];

  for (const toolCall of toolCalls) {
    await emit({
      type: "tool_execution_start",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      args: toolCall.arguments,
    });

    const finalized: FinalizedToolCallOutcome = {
      toolCall,
      result: createErrorToolResult(
        `Tool call "${toolCall.name}" was not executed: the response hit the output token limit, so its arguments may be truncated. Re-issue the tool call with complete arguments.`,
      ),
      isError: true,
    };

    await emitToolExecutionEnd(finalized, emit);
    const toolResultMessage = createToolResultMessage(finalized);
    await emitToolResultMessage(toolResultMessage, emit);
    messages.push(toolResultMessage);
  }

  return { messages, terminate: false };
}
