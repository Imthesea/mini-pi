/**
 * skills 模块类型。
 *
 * 职责:
 * - 重新导出 Skill(Skill 定义在 types/harness.ts 的"公用词汇表"中)
 * - 定义 Skill 模块专属类型:SkillFrontmatter / ParsedSkill / SkillArgs
 *
 * 为什么 Skill 定义在 types/harness.ts 而不是这里:
 * - Skill 是 harness 层的"公共词汇",被 system-prompt / format / load / agent-harness
 *   共同消费
 * - 集中放 types/harness.ts 避免循环依赖
 * - 本文件只承载"skills 模块内部"专属类型
 *
 * 文件拆分理由:
 * - plan 显式列出 skills/types.ts(~100 行),所以独立文件而非合并到 format.ts
 * - 即使现在内容很少,后续 Task 扩展(技能分类、版本等)有空间
 */

import type { Skill } from "../types/harness.js";

// ── 重新导出公用 Skill 类型 ──

export type { Skill };

// ── skills 模块专属类型 ──

/**
 * SKILL.md frontmatter 解析结果。
 *
 * 来源:YAML frontmatter 中的 `name` + `description` 字段。
 */
export interface SkillFrontmatter {
  /** 唯一名,小写字母+短横线,如 "git-commit" */
  name: string;
  /** 一句话描述,用于 system prompt 中的 XML 块 */
  description: string;
}

/**
 * parseSkillContent 完整返回:frontmatter + body。
 *
 * body 是 SKILL.md 去掉 frontmatter 后的 Markdown 内容。
 */
export interface ParsedSkill extends SkillFrontmatter {
  /** Markdown body(去掉 frontmatter) */
  content: string;
}

/**
 * formatSkillInvocation / harness.skill 的占位符参数。
 *
 * 简单字符串映射,不做类型校验(用户自行保证 key 存在)。
 */
export type SkillArgs = Record<string, string>;
