/**
 * prompt-templates 模块类型。
 *
 * 职责:
 * - 重新导出 PromptTemplate(定义在 types/harness.ts)
 * - 定义 PromptTemplateArgs(占位符参数)
 *
 * 为什么 PromptTemplate 定义在 types/harness.ts 而不是这里:
 * - 同 Skill 一样,PromptTemplate 是 harness 层公共词汇
 * - 集中放 types/harness.ts 避免循环依赖
 */

import type { PromptTemplate } from "../types/harness.js";

export type { PromptTemplate };

/** formatPromptTemplateInvocation 的占位符参数 */
export type PromptTemplateArgs = Record<string, string>;
