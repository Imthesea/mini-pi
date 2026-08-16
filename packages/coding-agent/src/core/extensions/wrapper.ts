/**
 * Tool wrappers for extension-registered tools.
 *
 * 对齐 pi 项目 extensions/wrapper.ts + tools/tool-definition-wrapper.ts（V1 最小化）。
 * 删减说明：pi 的 wrapRegisteredTool 还有 activeTools 追踪（addedToolNames 注入），
 * 依赖 ExtensionRuntime，V1 无动态启停工具，不需要。
 */

import type { AgentTool } from "@mimi/agent";
import type { ExtensionContext, ToolDefinition } from "./types.js";

/**
 * Wrap a ToolDefinition into an AgentTool for the core runtime.
 * 注入 ExtensionContext（V1：cwd），桥接 5 参 execute -> 4 参 execute。
 */
export function wrapExtensionTool(tool: ToolDefinition, cwd: string): AgentTool {
  const ctx: ExtensionContext = { cwd };
  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
    executionMode: tool.executionMode,
    execute: (toolCallId, params, signal, onUpdate) =>
      tool.execute(toolCallId, params, signal, onUpdate, ctx),
  };
}

/** Wrap multiple ToolDefinitions into AgentTools. */
export function wrapExtensionTools(tools: ToolDefinition[], cwd: string): AgentTool[] {
  return tools.map((tool) => wrapExtensionTool(tool, cwd));
}
