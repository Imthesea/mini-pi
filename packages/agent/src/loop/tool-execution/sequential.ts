/**
 * 串行执行一组 tool call。
 *
 * 一个一个执行:每个 tool 完整跑完 prepare → execute → finalize → emit,
 * 再开始下一个。任一阶段 signal.aborted 时立即退出(已完成的部分保留)。
 */

import {
  createToolResultMessage,
  emitToolExecutionEnd,
  emitToolResultMessage,
  shouldTerminateToolBatch,
  type AgentEventSink,
} from "../helpers.js";
import type {
  ExecutedToolCallBatch,
  FinalizedToolCallOutcome,
} from "./types.js";
import type { AgentContext, AgentLoopConfig, AgentToolCall } from "../../types.js";
import type { AssistantMessage } from "@mimi/ai";
import { prepareToolCall } from "./prepare.js";
import { executePreparedToolCall } from "./execute.js";
import { finalizeExecutedToolCall } from "./finalize.js";

export interface SequentialInput {
  context: AgentContext;
  assistantMessage: AssistantMessage;
  toolCalls: AgentToolCall[];
  config: AgentLoopConfig;
  signal: AbortSignal | undefined;
  emit: AgentEventSink;
}

/** 串行执行 tool calls */
export async function executeToolCallsSequential(
  input: SequentialInput,
): Promise<ExecutedToolCallBatch> {
  const { context, assistantMessage, toolCalls, config, signal, emit } = input;
  const finalizedCalls: FinalizedToolCallOutcome[] = [];
  const messages: import("@mimi/ai").ToolResultMessage[] = [];

  for (const toolCall of toolCalls) {
    await emit({
      type: "tool_execution_start",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      args: toolCall.arguments,
    });

    const preparation = await prepareToolCall({
      context,
      assistantMessage,
      toolCall,
      config,
      signal,
    });

    let finalized: FinalizedToolCallOutcome;
    if (preparation.kind === "immediate") {
      finalized = {
        toolCall,
        result: preparation.result,
        isError: preparation.isError,
      };
    } else {
      const executed = await executePreparedToolCall(preparation, signal, emit);
      finalized = await finalizeExecutedToolCall({
        context,
        assistantMessage,
        prepared: preparation,
        executed,
        config,
        signal,
      });
    }

    await emitToolExecutionEnd(finalized, emit);
    const toolResultMessage = createToolResultMessage(finalized);
    await emitToolResultMessage(toolResultMessage, emit);
    finalizedCalls.push(finalized);
    messages.push(toolResultMessage);

    if (signal?.aborted) break;
  }

  return { messages, terminate: shouldTerminateToolBatch(finalizedCalls) };
}
