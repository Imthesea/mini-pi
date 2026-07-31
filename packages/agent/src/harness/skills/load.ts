/**
 * skills 模块加载工具。
 *
 * 职责:
 * - parseSkillContent:解析 SKILL.md 的 YAML frontmatter + body
 * - loadSkillFromFile:通过 ExecutionEnv 读取文件 + 调 parseSkillContent
 *
 * 设计:
 * - 接受 env 作为第一参数(env-first),便于测试 mock
 *   这与 plan 写的 loadSkillFromFile(path) 略有偏离,但 env 注入是
 *   harness 的核心模式,且不依赖模块级全局状态
 * - 不引入 yaml 库:SKILL.md frontmatter 仅为 flat key-value,自写解析足够;
 *   如未来需要复杂 YAML 再引入
 */

import { getResultOrThrow } from "../env/index.js";
import type { ExecutionEnv } from "../env/index.js";
import type { ParsedSkill, Skill } from "./types.js";
import { SkillParseError } from "./errors.js";

// ── parseSkillContent(纯函数) ──

/**
 * 解析 SKILL.md 文本,返回 frontmatter + body。
 *
 * 格式约定:
 * ```
 * ---
 * name: skill-name
 * description: 一句话描述
 * ---
 * (Markdown body)
 * ```
 *
 * 抛错情况:
 * - 不以 --- 开头 → SkillParseError "missing_frontmatter"
 * - 闭合 --- 缺失 → SkillParseError "unclosed_frontmatter"
 * - name / description 字段缺失 → SkillParseError "missing_field"
 */
export function parseSkillContent(content: string): ParsedSkill {
  // 1. 检查开头 ---
  if (!content.startsWith("---")) {
    throw new SkillParseError(
      "missing_frontmatter",
      "SKILL.md 必须以 --- 开头(YAML frontmatter)",
    );
  }

  // 2. 找闭合 ---
  // 从第 4 字符后开始找下一个 --- 开头行
  const lines = content.split("\n");
  // 第一个 --- 已在 startsWith 验证,跳过
  let closeIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      closeIndex = i;
      break;
    }
  }
  if (closeIndex === -1) {
    throw new SkillParseError(
      "unclosed_frontmatter",
      "SKILL.md frontmatter 缺少闭合 ---",
    );
  }

  // 3. 解析 frontmatter 行(name: / description:)
  const frontmatterLines = lines.slice(1, closeIndex);
  const fm: Record<string, string> = {};
  for (const line of frontmatterLines) {
    const m = line.match(/^([a-zA-Z][a-zA-Z0-9_-]*):\s*(.*)$/);
    if (m) {
      fm[m[1]!] = m[2]!.trim();
    }
  }

  if (!fm.name) {
    throw new SkillParseError(
      "missing_field",
      "SKILL.md frontmatter 缺少 name 字段",
    );
  }
  if (!fm.description) {
    throw new SkillParseError(
      "missing_field",
      "SKILL.md frontmatter 缺少 description 字段",
    );
  }

  // 4. body:闭合 --- 之后的所有行,重新 join 并补尾部换行
  const bodyLines = lines.slice(closeIndex + 1);
  // 去掉开头的空行,但保留 body 内部空行
  while (bodyLines.length > 0 && bodyLines[0] === "") {
    bodyLines.shift();
  }
  const body = bodyLines.join("\n");

  return {
    name: fm.name,
    description: fm.description,
    content: body,
  };
}

// ── loadSkillFromFile(env-first) ──

/**
 * 通过 ExecutionEnv 读取文件 + 解析 frontmatter,返回 Skill。
 *
 * 抛错:
 * - 文件不存在 / 读失败 → FileError(env.readFile 返回 Err)
 * - 内容解析失败 → SkillParseError
 *
 * @param env   ExecutionEnv(由 harness 注入)
 * @param path  SKILL.md 路径(绝对或相对 env.cwd)
 * @returns     解析后的 Skill
 */
export async function loadSkillFromFile(
  env: ExecutionEnv,
  path: string,
): Promise<Skill> {
  const readResult = await env.readFile(path);
  const content = getResultOrThrow(readResult, `loadSkillFromFile 读文件失败`);
  return parseSkillContent(content);
}
