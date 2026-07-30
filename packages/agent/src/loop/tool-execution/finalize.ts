/**
 * 工具调用的"finalize"阶段。
 *
 * 职责：
 * 1. 调 `afterToolCall` 钩子（content / details / isError / terminate 增量覆盖）
 * 2. 钩子抛错时,转 isError=true + 错误 toolResult
 * 3. 返回 FinalizedToolCallOutcome
 *
 * 不做：emit 终态事件（由调用方负责）
 */

import { createErrorToolResult } from "../helpers.js";
import type {
  ExecutedToolCallOutcome,
  FinalizedToolCallOutcome,
  PreparedToolCall,
} from "./types.js";
import type { AgentContext, AgentLoopConfig } from "../../types.js";
import type { AssistantMessage } from "@mimi/ai";

/** finalize 阶段入参 */
export interface FinalizeInput {
  context: AgentContext;
  assistantMessage: AssistantMessage;
  prepared: PreparedToolCall;
  executed: ExecutedToolCallOutcome;
  config: AgentLoopConfig;
  signal: AbortSignal | undefined;
}

/** 应用 afterToolCall 钩子,返回 finalized 结果 */
export async function finalizeExecutedToolCall(
  input: FinalizeInput,
): Promise<FinalizedToolCallOutcome> {
  const { context, assistantMessage, prepared, executed, config, signal } = input;

  let result = executed.result;
  let isError = executed.isError;

  if (config.afterToolCall) {
    try {
      const afterResult = await config.afterToolCall(
        {
          assistantMessage,
          toolCall: prepared.toolCall,
          args: prepared.args,
          result,
          isError,
          context,
        },
        signal,
      );
      if (afterResult) {
        result = {
          ...result,
          content: afterResult.content ?? result.content,
          details: afterResult.details ?? result.details,
          terminate: afterResult.terminate ?? result.terminate,
        };
        isError = afterResult.isError ?? isError;
      }
    } catch (error) {
      result = createErrorToolResult(error instanceof Error ? error.message : String(error));
      isError = true;
    }
  }

  return { toolCall: prepared.toolCall, result, isError };
}
