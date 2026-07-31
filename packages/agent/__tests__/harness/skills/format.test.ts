/**
 * skills/format.ts 测试。
 *
 * 覆盖:
 * - formatSkillsForSystemPrompt:
 *   - 输出符合 agentskills.io XML 规范
 *   - 多 skill 顺序拼接
 *   - 空数组返回空字符串
 *   - 转义 XML 特殊字符(< > & ")
 * - formatSkillInvocation:
 *   - 无 args:返回 content
 *   - 有 args:替换 {{key}} 占位符
 *   - 找不到的占位符:保留原样(警告注释可加)
 *   - args 中的特殊字符不需转义(content 是 markdown,不是 XML)
 */

import { describe, expect, it } from "vitest";
import {
  formatSkillInvocation,
  formatSkillsForSystemPrompt,
} from "../../../src/harness/skills/format.js";
import type { Skill } from "../../../src/harness/skills/types.js";

// ── 测试 fixtures ──

const SKILL_COMMIT: Skill = {
  name: "git-commit",
  description: "提交代码到 git,生成符合 conventional commits 的消息",
  content: "# git-commit\n\n按以下步骤提交代码:\n1. git status\n2. git add -A",
};

const SKILL_LINT: Skill = {
  name: "lint",
  description: "运行 lint 修复问题",
  content: "# lint\n\n运行 pnpm lint --fix。",
};

describe("formatSkillsForSystemPrompt — system prompt XML 块", () => {
  it("输出符合 agentskills.io 规范的 XML 块", () => {
    const result = formatSkillsForSystemPrompt([SKILL_COMMIT]);
    expect(result).toBe(
      [
        "<available_skills>",
        "<skill>",
        "  <name>git-commit</name>",
        "  <description>提交代码到 git,生成符合 conventional commits 的消息</description>",
        "</skill>",
        "</available_skills>",
      ].join("\n"),
    );
  });

  it("多 skill 按输入顺序拼接", () => {
    const result = formatSkillsForSystemPrompt([SKILL_COMMIT, SKILL_LINT]);
    expect(result).toContain("<name>git-commit</name>");
    expect(result).toContain("<name>lint</name>");
    // 顺序:git-commit 在 lint 前面
    expect(result.indexOf("git-commit")).toBeLessThan(
      result.indexOf("lint"),
    );
  });

  it("空数组返回空字符串", () => {
    expect(formatSkillsForSystemPrompt([])).toBe("");
  });

  it("转义 XML 特殊字符(< > & \")", () => {
    const tricky: Skill = {
      name: "x<y",
      description: 'A & B "quoted"',
      content: "unused",
    };
    const result = formatSkillsForSystemPrompt([tricky]);
    expect(result).toContain("x&lt;y");
    expect(result).toContain("A &amp; B &quot;quoted&quot;");
    // 不应出现未转义的 < / > / & / "
    expect(result).not.toContain("x<y>");
    expect(result).not.toContain('A & B "quoted"');
  });
});

describe("formatSkillInvocation — 调起 skill", () => {
  it("无 args:返回原 content", () => {
    expect(formatSkillInvocation(SKILL_COMMIT)).toBe(SKILL_COMMIT.content);
  });

  it("有 args:替换 content 中的 {{key}} 占位符", () => {
    const skill: Skill = {
      name: "greet",
      description: "问候",
      content: "你好,{{name}}!欢迎使用 {{product}}。",
    };
    const result = formatSkillInvocation(skill, {
      name: "小明",
      product: "Mimi",
    });
    expect(result).toBe("你好,小明!欢迎使用 Mimi。");
  });

  it("未提供的占位符保留原样", () => {
    const skill: Skill = {
      name: "greet",
      description: "问候",
      content: "你好,{{name}}!今天是 {{day}}。",
    };
    const result = formatSkillInvocation(skill, { name: "小明" });
    expect(result).toBe("你好,小明!今天是 {{day}}。");
  });

  it("空 args 对象:等同无 args", () => {
    expect(formatSkillInvocation(SKILL_COMMIT, {})).toBe(SKILL_COMMIT.content);
  });

  it("args 中可含特殊字符(< > &),不需要 XML 转义(content 是 markdown)", () => {
    const skill: Skill = {
      name: "shell",
      description: "执行 shell",
      content: "运行:{{cmd}}",
    };
    const result = formatSkillInvocation(skill, { cmd: "echo <hello> & bye" });
    // 不转义,直接替换
    expect(result).toBe("运行:echo <hello> & bye");
  });

  it("空 content:返回空字符串", () => {
    const skill: Skill = { name: "empty", description: "空 skill", content: "" };
    expect(formatSkillInvocation(skill)).toBe("");
    expect(formatSkillInvocation(skill, { any: "value" })).toBe("");
  });

  it("占位符名支持字母/数字/下划线/短横线", () => {
    const skill: Skill = {
      name: "x",
      description: "y",
      content: "{{a-b_c1}} {{simple}}",
    };
    const result = formatSkillInvocation(skill, {
      "a-b_c1": "X",
      simple: "Y",
    });
    expect(result).toBe("X Y");
  });
});
