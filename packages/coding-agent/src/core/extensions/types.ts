/**
 * Extensions 类型定义。
 *
 * 对齐 pi 项目 extensions/types.ts（V1 最小化：仅 registerTool 相关类型）。
 * 删减说明（均为 V1 范围外）：pi 的 ToolDefinition 还有 promptSnippet / promptGuidelines /
 * prepareArguments / renderCall / renderResult / renderShell / TState；
 * ExtensionContext 还有 UI 交互（hasUI / ui.confirm 等）。
 */

import type { AgentToolResult, AgentToolUpdateCallback } from "@mimi/agent";
import type { Static, TSchema } from "typebox";

/** 扩展工具执行时拿到的上下文（V1 最小：cwd + signal） */
export interface ExtensionContext {
  /** 工具执行的工作目录 */
  cwd: string;
  /** 中止信号 */
  signal?: AbortSignal;
}

/** 扩展工具定义。execute 比 AgentTool 多一个 ctx 参数 */
export interface ToolDefinition<TParams extends TSchema = TSchema, TDetails = unknown> {
  /** 工具名（LLM 工具调用时使用） */
  name: string;
  /** UI 显示用的人类可读标签 */
  label: string;
  /** 给 LLM 的描述 */
  description: string;
  /** 参数 schema（TypeBox） */
  parameters: TParams;
  /** 执行模式覆盖（sequential / parallel） */
  executionMode?: "sequential" | "parallel";
  /** 执行工具。失败请 throw，不要把错误编码到 content 中 */
  execute(
    toolCallId: string,
    params: Static<TParams>,
    signal: AbortSignal | undefined,
    onUpdate: AgentToolUpdateCallback<TDetails> | undefined,
    ctx: ExtensionContext,
  ): Promise<AgentToolResult<TDetails>>;
}

/** 扩展 API（V1 最小：仅 registerTool） */
export interface ExtensionAPI {
  registerTool<TParams extends TSchema = TSchema, TDetails = unknown>(
    tool: ToolDefinition<TParams, TDetails>,
  ): void;
}

/** 扩展工厂函数（扩展模块的默认导出） */
export type ExtensionFactory = (api: ExtensionAPI) => void | Promise<void>;

/** 已加载扩展 */
export interface Extension {
  /** 原始路径（未 resolve） */
  path: string;
  /** resolve 后的绝对路径 */
  resolvedPath: string;
  /** 该扩展注册的工具（name -> definition） */
  tools: Map<string, ToolDefinition>;
}

/** 扩展加载结果 */
export interface LoadExtensionsResult {
  extensions: Extension[];
  errors: Array<{ path: string; error: string }>;
}

type AnyToolDefinition = ToolDefinition<any, any>;

/**
 * 保留独立工具定义的参数推断。
 *
 * 当把工具赋值给变量或通过数组（如 customTools）传递时使用，
 * 避免上下文类型推断把 params 拓宽为 unknown。
 */
export function defineTool<TParams extends TSchema, TDetails = unknown>(
  tool: ToolDefinition<TParams, TDetails>,
): ToolDefinition<TParams, TDetails> & AnyToolDefinition {
  return tool as ToolDefinition<TParams, TDetails> & AnyToolDefinition;
}
