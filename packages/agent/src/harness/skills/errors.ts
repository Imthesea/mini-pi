/**
 * skills 模块错误类型。
 *
 * SkillParseError:解析 frontmatter 失败(无 frontmatter / 缺字段 / 缺闭合等)
 *
 * 为什么不复用 HarnessError / parse 错误:
 * - 解析 SKILL.md 是"输入数据"级别的错误,不是 harness 运行时错误
 * - 独立错误类便于上层 catch 区分(用户拿到的是文件问题,不是 harness bug)
 */

export class SkillParseError extends Error {
  /** 错误码,便于上层 switch */
  readonly code:
    | "missing_frontmatter"
    | "unclosed_frontmatter"
    | "missing_field"
    | "invalid_format";

  constructor(
    code: SkillParseError["code"],
    message: string,
  ) {
    super(message);
    this.name = "SkillParseError";
    this.code = code;
  }
}
