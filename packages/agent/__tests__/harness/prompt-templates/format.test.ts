/**
 * prompt-templates/format.ts 测试。
 *
 * 覆盖:
 * - formatPromptTemplateInvocation:
 *   - 替换 {{name}} 占位符
 *   - 占位符名支持字母/数字/下划线/短横线
 *   - 多占位符全部替换
 *   - 未提供的占位符保留原样(警告)
 *   - 占位符重复出现 → 全部替换
 *   - args 中可含特殊字符,不需转义
 *   - 必填 args:缺少必填项时保留原样(不抛错)
 */

import { describe, expect, it } from "vitest";
import { formatPromptTemplateInvocation } from "../../../src/harness/prompt-templates/format.js";
import type { PromptTemplate } from "../../../src/harness/prompt-templates/types.js";

const TPL_REVIEW: PromptTemplate = {
  name: "code-review",
  content: `请审查 PR {{prUrl}},特别关注:
- 类型安全
- 测试覆盖
- 错误处理

分支:{{branch}}
作者:{{author}}`,
};

describe("formatPromptTemplateInvocation — 占位符替换", () => {
  it("替换所有 {{key}} 占位符", () => {
    const result = formatPromptTemplateInvocation(TPL_REVIEW, {
      prUrl: "https://github.com/foo/bar/pull/123",
      branch: "feat/login",
      author: "alice",
    });
    expect(result).toContain(
      "https://github.com/foo/bar/pull/123",
    );
    expect(result).toContain("feat/login");
    expect(result).toContain("alice");
    expect(result).not.toContain("{{prUrl}}");
    expect(result).not.toContain("{{branch}}");
    expect(result).not.toContain("{{author}}");
  });

  it("占位符名支持字母/数字/下划线/短横线", () => {
    const tpl: PromptTemplate = {
      name: "t",
      content: "{{a-b_c1}} {{simple}} {{x9}}",
    };
    const result = formatPromptTemplateInvocation(tpl, {
      "a-b_c1": "X",
      simple: "Y",
      x9: "Z",
    });
    expect(result).toBe("X Y Z");
  });

  it("未提供的占位符保留原样", () => {
    const result = formatPromptTemplateInvocation(TPL_REVIEW, {
      prUrl: "url",
      // branch / author 缺失
    });
    expect(result).toContain("url");
    expect(result).toContain("{{branch}}");
    expect(result).toContain("{{author}}");
  });

  it("占位符重复出现 → 全部替换", () => {
    const tpl: PromptTemplate = {
      name: "t",
      content: "{{name}} 看到 {{name}} 了",
    };
    const result = formatPromptTemplateInvocation(tpl, { name: "小明" });
    expect(result).toBe("小明 看到 小明 了");
  });

  it("args 中含特殊字符(< > &),不转义(content 是文本)", () => {
    const tpl: PromptTemplate = {
      name: "t",
      content: "运行:{{cmd}}",
    };
    const result = formatPromptTemplateInvocation(tpl, {
      cmd: "echo <hello> & bye",
    });
    expect(result).toBe("运行:echo <hello> & bye");
  });

  it("占位符周围可有空格 {{ name }} 也匹配", () => {
    const tpl: PromptTemplate = {
      name: "t",
      content: "Hello {{  name  }}!",
    };
    const result = formatPromptTemplateInvocation(tpl, { name: "World" });
    expect(result).toBe("Hello World!");
  });

  it("空 content → 空字符串", () => {
    const tpl: PromptTemplate = { name: "empty", content: "" };
    expect(formatPromptTemplateInvocation(tpl, { any: "x" })).toBe("");
  });

  it("无占位符的 content 原样返回", () => {
    const tpl: PromptTemplate = {
      name: "static",
      content: "这是一段静态 prompt,没有占位符。",
    };
    const result = formatPromptTemplateInvocation(tpl, { unused: "x" });
    expect(result).toBe("这是一段静态 prompt,没有占位符。");
  });
});
