/**
 * system-prompt 拼装入口。
 *
 * buildSystemPrompt 是 harness 拼装"系统提示词"的统一入口:
 * - 静态字符串:直接返回
 * - 动态 provider:每次 turn 调用一次,接收 SystemPromptContext
 * - 附加 skills 块(从 resources.skills 读)
 *
 * Task 3 阶段只拼 skills 块;tools / prompt-template 块留到 Task 4/7。
 */

import type { SystemPromptContext } from "../types/options.js";
import type { SystemPromptInput } from "./types.js";
import { formatSkillsBlock, joinParts } from "./parts.js";

/**
 * 拼装最终 system prompt。
 *
 * @param input 静态字符串 / 动态 provider / undefined
 * @param ctx 拼装上下文
 * @returns 最终 system prompt 字符串(可能为空)
 *          若 provider 是异步,返回 Promise<string>(由调用方 await)
 */
export function buildSystemPrompt(
  input: SystemPromptInput,
  ctx: SystemPromptContext,
): string | Promise<string> {
  // 处理 input:字符串直接用,函数/异步函数调用
  const main = resolveMainPrompt(input, ctx);

  // 拼装 skills 块
  const skillsBlock = formatSkillsBlock(ctx.resources?.skills ?? []);

  if (typeof main === "string") {
    return joinParts([main, skillsBlock]);
  }
  // 异步 main → 链式拼装
  return main.then((m) => joinParts([m, skillsBlock]));
}

/** 解析 main prompt(支持同步 / 异步 provider) */
function resolveMainPrompt(
  input: SystemPromptInput,
  ctx: SystemPromptContext,
): string | Promise<string> {
  if (input === undefined) return "";
  if (typeof input === "string") return input;
  return input(ctx);
}
