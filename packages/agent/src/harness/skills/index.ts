/**
 * skills 模块公共 API。
 *
 * 导出:
 * - 类型:Skill / SkillFrontmatter / ParsedSkill / SkillArgs
 * - 错误:SkillParseError
 * - format:formatSkillsForSystemPrompt / formatSkillInvocation
 * - load:parseSkillContent / loadSkillFromFile
 *
 * 设计:
 * - 本文件是"导出入口",只 re-export,不做逻辑
 * - 用户从 @mimi/agent 顶层 import 时不必关心子目录
 */

export type { Skill, SkillFrontmatter, ParsedSkill, SkillArgs } from "./types.js";
export { SkillParseError } from "./errors.js";
export {
  formatSkillsForSystemPrompt,
  formatSkillInvocation,
} from "./format.js";
export { parseSkillContent, loadSkillFromFile } from "./load.js";
