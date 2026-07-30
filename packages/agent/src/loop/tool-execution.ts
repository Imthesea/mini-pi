/**
 * 工具执行路由入口。
 *
 * 根据 `config.toolExecution` + 任一 tool 的 `executionMode` 决定走 sequential 还是 parallel。
 */

import type {
  AgentContext,
  AgentLoopConfig,
  AgentToolCall,
} from "../types.js";
import type { AssistantMessage } from "@mimi/ai";
import type { AgentEventSink } from "./helpers.js";
import type { ExecutedToolCallBatch } from "./tool-execution/types.js";
import { executeToolCallsSequential } from "./tool-execution/sequential.js";
import { executeToolCallsParallel } from "./tool-execution/parallel.js";

/** 路由:sequential / parallel 二选一 */
export function routeToolExecution(args: {
  context: AgentContext;
  assistantMessage: AssistantMessage;
  toolCalls: AgentToolCall[];
  config: AgentLoopConfig;
  signal: AbortSignal | undefined;
  emit: AgentEventSink;
}): Promise<ExecutedToolCallBatch> {
  const { context, config } = args;

  // 任一 tool 设了 sequential,或全局是 sequential → 走串行
  const hasSequentialToolCall = args.toolCalls.some(
    (tc) => context.tools?.find((t) => t.name === tc.name)?.executionMode === "sequential",
  );

  if (config.toolExecution === "sequential" || hasSequentialToolCall) {
    return executeToolCallsSequential(args);
  }
  return executeToolCallsParallel(args);
}
