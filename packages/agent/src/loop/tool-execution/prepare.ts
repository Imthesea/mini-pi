/**
 * 工具调用的"准备"阶段。
 *
 * 职责：
 * 1. 查找工具定义（找不到 → immediate error）
 * 2. 校验参数 TypeBox schema（失败 → immediate error）
 * 3. 调用 `beforeToolCall` 钩子（block → immediate error / abort → immediate error）
 * 4. 返回 prepared(可执行)或 immediate(直接终结)
 *
 * 不做：实际执行、emit 事件
 */

import { validateToolArguments } from "../tool-validation.js";
import { createErrorToolResult } from "../helpers.js";
import type { PrepareInput, PrepareResult } from "./types.js";

/** 准备一个工具调用,返回 prepared(可执行)或 immediate(跳过执行) */
export async function prepareToolCall(input: PrepareInput): Promise<PrepareResult> {
  const { context, assistantMessage, toolCall, config, signal } = input;
  const tool = context.tools?.find((t) => t.name === toolCall.name);

  if (!tool) {
    return {
      kind: "immediate",
      result: createErrorToolResult(`Tool ${toolCall.name} not found`),
      isError: true,
    };
  }

  try {
    const validatedArgs = validateToolArguments(tool, toolCall);

    if (config.beforeToolCall) {
      const beforeResult = await config.beforeToolCall(
        { assistantMessage, toolCall, args: validatedArgs, context },
        signal,
      );
      if (signal?.aborted) {
        return {
          kind: "immediate",
          result: createErrorToolResult("Operation aborted"),
          isError: true,
        };
      }
      if (beforeResult?.block) {
        return {
          kind: "immediate",
          result: createErrorToolResult(beforeResult.reason || "Tool execution was blocked"),
          isError: true,
        };
      }
    }

    if (signal?.aborted) {
      return {
        kind: "immediate",
        result: createErrorToolResult("Operation aborted"),
        isError: true,
      };
    }

    return { kind: "prepared", toolCall, tool, args: validatedArgs };
  } catch (error) {
    return {
      kind: "immediate",
      result: createErrorToolResult(error instanceof Error ? error.message : String(error)),
      isError: true,
    };
  }
}
