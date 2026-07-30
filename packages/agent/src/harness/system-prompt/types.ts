/**
 * system-prompt 模块内部类型。
 *
 * 集中放本模块用到的输入/输出类型,
 * 避免在 build.ts / parts.ts 之间循环依赖。
 */

import type { SystemPromptContext } from "../types/options.js";

/** buildSystemPrompt 的输入 */
export type SystemPromptInput =
  | string
  | ((ctx: SystemPromptContext) => string | Promise<string>)
  | undefined;
