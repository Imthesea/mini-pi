/**
 * skills 模块格式工具。
 *
 * 职责:
 * - formatSkillsForSystemPrompt:把 skill 列表拼成 agentskills.io 风格的 XML 块
 *   (供 system prompt 注入用)
 * - formatSkillInvocation:把单个 skill 的 content 调起,支持 {{key}} 占位符替换
 *   (供 harness.skill(name, args) 用)
 *
 * 设计要点:
 * - formatSkillInvocation 不做 args 校验(用户保证 key 存在),找不到的占位符保留原样
 * - 占位符语法: {{key}},key 允许字母/数字/下划线/短横线
 * - content 替换时不转义(markdown 而非 XML)
 */

import type { Skill, SkillArgs } from "./types.js";

// ── formatSkillsForSystemPrompt ──

/**
 * 把 skill 列表拼成 system prompt 中可注入的 XML 块。
 *
 * 格式(遵循 agentskills.io):
 * ```
 * <available_skills>
 * <skill>
 *   <name>git-commit</name>
 *   <description>提交代码到 git</description>
 * </skill>
 * </available_skills>
 * ```
 *
 * @param skills  skill 列表
 * @returns       XML 字符串;空数组返回 ""
 */
export function formatSkillsForSystemPrompt(
  skills: readonly Skill[],
): string {
  if (skills.length === 0) return "";

  const entries = skills.map(formatSkillEntry).join("\n");
  return `<available_skills>\n${entries}\n</available_skills>`;
}

/** 拼装单个 skill 块(供 formatSkillsForSystemPrompt 调用) */
function formatSkillEntry(skill: Skill): string {
  return `<skill>\n  <name>${escapeXml(skill.name)}</name>\n  <description>${escapeXml(skill.description)}</description>\n</skill>`;
}

/** 简单 XML 转义(name / description 含特殊字符时保护 XML 完整性) */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── formatSkillInvocation ──

/**
 * 把 skill 调起,可选地替换 content 中的 {{key}} 占位符。
 *
 * 行为:
 * - 无 args / args 为空:返回 skill.content 原样
 * - 有 args:遍历 args,用 str.replace 替换所有 {{key}} 出现位置
 * - 未提供的占位符:保留原样(不抛错,避免破坏 markdown)
 *
 * @param skill  目标 skill
 * @param args   可选占位符参数
 * @returns      调起文本(通常是 markdown body)
 */
export function formatSkillInvocation(
  skill: Skill,
  args?: SkillArgs,
): string {
  if (!args) return skill.content;

  // 对每个 arg 做 str.replace,替换所有 {{key}}
  // 用 /g 全局 + escapeRegExp 防 key 含特殊字符
  let result = skill.content;
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
