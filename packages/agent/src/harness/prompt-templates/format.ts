/**
 * prompt-templates 模块格式工具。
 *
 * 职责:
 * - formatPromptTemplateInvocation:替换模板中的 {{key}} 占位符
 *   (供 harness.promptFromTemplate(name, args) 用)
 *
 * 设计要点:
 * - 简单字符串替换,不做表达式求值(plan § 4.6 明确)
 * - 占位符语法:{{key}},key 允许字母/数字/下划线/短横线
 * - 占位符周围允许空格 {{ name }} 也匹配
 * - 未提供的占位符保留原样(不抛错,避免破坏用户模板)
 * - args 中可含特殊字符,不转义(content 是文本/markdown,不是 XML)
 */

import type { PromptTemplate, PromptTemplateArgs } from "./types.js";

/**
 * 替换模板中的 {{key}} 占位符,返回最终 prompt 文本。
 *
 * @param template  模板(含 {{key}} 占位符)
 * @param args      占位符参数(key → value)
 * @returns         替换后的文本
 */
export function formatPromptTemplateInvocation(
  template: PromptTemplate,
  args: PromptTemplateArgs,
): string {
  let result = template.content;
  for (const [key, value] of Object.entries(args)) {
    const re = new RegExp(`\\{\\{\\s*${escapeRegExp(key)}\\s*\\}\\}`, "g");
    result = result.replace(re, value);
  }
  return result;
}

/** 转义正则特殊字符(用于 key 拼到正则时) */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
