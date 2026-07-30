/**
 * system-prompt 各部分拼装工具。
 *
 * Task 3 阶段:
 * - formatSkillsBlock: 拼装 agentskills.io 风格的 XML 块
 * - joinParts: 把多个部分按双换行拼接
 *
 * 后续 Task 可增量:
 * - formatToolsBlock(工具描述块)
 * - formatPromptTemplateBlock(模板提示块)
 */

import type { Skill } from "../types/harness.js";

/**
 * 拼装 skills 块(agentskills.io 规范)。
 *
 * 输出示例:
 * ```
 * <available_skills>
 * <skill>
 *   <name>git-commit</name>
 *   <description>提交代码到 git</description>
 * </skill>
 * <skill>
 *   <name>lint</name>
 *   <description>运行 lint</description>
 * </skill>
 * </available_skills>
 * ```
 *
 * @param skills skill 列表
 * @returns XML 字符串;空数组返回空字符串
 */
export function formatSkillsBlock(skills: readonly Skill[]): string {
  if (skills.length === 0) return "";

  const entries = skills.map(formatSkillEntry).join("\n");
  return `<available_skills>\n${entries}\n</available_skills>`;
}

/** 拼装单个 skill 块 */
function formatSkillEntry(skill: Skill): string {
  return `<skill>\n  <name>${escapeXml(skill.name)}</name>\n  <description>${escapeXml(skill.description)}</description>\n</skill>`;
}

/** 简单 XML 转义(避免 name / description 含特殊字符破坏格式) */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 把多个部分按"双换行"顺序拼接,跳过空字符串。
 *
 * @param parts 各部分字符串
 * @returns 拼好的字符串
 */
export function joinParts(parts: readonly string[]): string {
  return parts.filter((p) => p.length > 0).join("\n\n");
}
