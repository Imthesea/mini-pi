/**
 * 并行执行一组 tool call。
 *
 * 两阶段：
 * 1. **准备阶段（顺序）**：逐个 prepare 工具
 *    - "immediate" 立即终结 → 直接入 finalized 队列
 *    - "prepared" 准备就绪 → 入待执行队列
 *    - 任一 prepared 阶段 signal.aborted 时立即退出
 * 2. **执行阶段（并发）**：所有 prepared 工具并发 execute → finalize → emit
 *    - 完成后按 assistant 消息的 source 顺序生成 tool result messages
 *
 * 注：`tool_execution_end` 事件按完成顺序派发；tool_result 消息按 source 顺序派发。
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
  FinalizedToolCallEntry,
  FinalizedToolCallOutcome,
} from "./types.js";
import type { AgentContext, AgentLoopConfig, AgentToolCall } from "../../types.js";
import type { AssistantMessage } from "@mimi/ai";
import { prepareToolCall } from "./prepare.js";
import { executePreparedToolCall } from "./execute.js";
import { finalizeExecutedToolCall } from "./finalize.js";

export interface ParallelInput {
  context: AgentContext;
  assistantMessage: AssistantMessage;
  toolCalls: AgentToolCall[];
  config: AgentLoopConfig;
  signal: AbortSignal | undefined;
  emit: AgentEventSink;
}

/** 并行执行 tool calls */
export async function executeToolCallsParallel(
  input: ParallelInput,
): Promise<ExecutedToolCallBatch> {
  const { context, assistantMessage, toolCalls, config, signal, emit } = input;
  const finalizedCalls: FinalizedToolCallEntry[] = [];

  // 第一阶段:顺序准备
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

    if (preparation.kind === "immediate") {
      const finalized: FinalizedToolCallOutcome = {
        toolCall,
        result: preparation.result,
        isError: preparation.isError,
      };
      await emitToolExecutionEnd(finalized, emit);
      finalizedCalls.push(finalized);
      if (signal?.aborted) break;
      continue;
    }

    finalizedCalls.push(async () => {
      const executed = await executePreparedToolCall(preparation, signal, emit);
      const finalized = await finalizeExecutedToolCall({
        context,
        assistantMessage,
        prepared: preparation,
        executed,
        config,
        signal,
      });
      await emitToolExecutionEnd(finalized, emit);
      return finalized;
    });
    if (signal?.aborted) break;
  }

  // 第二阶段:并发执行(已是 finalized 的直接 resolve)
  const orderedFinalizedCalls = await Promise.all(
    finalizedCalls.map((entry) =>
      typeof entry === "function" ? entry() : Promise.resolve(entry),
    ),
  );

  // 按 source 顺序派发 tool_result message
  const messages: import("@mimi/ai").ToolResultMessage[] = [];
  for (const finalized of orderedFinalizedCalls) {
    const toolResultMessage = createToolResultMessage(finalized);
    await emitToolResultMessage(toolResultMessage, emit);
    messages.push(toolResultMessage);
  }

  return { messages, terminate: shouldTerminateToolBatch(orderedFinalizedCalls) };
}
