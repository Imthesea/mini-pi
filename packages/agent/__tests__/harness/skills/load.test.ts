/**
 * skills/load.ts 测试。
 *
 * 覆盖:
 * - parseSkillContent:
 *   - 正常 frontmatter 解析
 *   - body 包含多行 markdown
 *   - frontmatter 缺失 → 抛错
 *   - frontmatter 字段缺失 → 抛错
 *   - 不在开头的 frontmatter(误识别)→ 抛错
 * - loadSkillFromFile:
 *   - 真实读取 + 解析文件(走 mock ExecutionEnv)
 *   - 文件不存在 → 抛错/返回 Err
 *
 * 设计:
 * - loadSkillFromFile 接受 ExecutionEnv(env-first),便于测试 mock
 *   这与 plan 写 "loadSkillFromFile(path)" 略有偏离,但 env 注入是 harness 的核心模式
 */

import { describe, expect, it } from "vitest";
import {
  loadSkillFromFile,
  parseSkillContent,
} from "../../../src/harness/skills/load.js";
import { SkillParseError } from "../../../src/harness/skills/errors.js";
import { FileError } from "../../../src/harness/env/index.js";

// ── parseSkillContent 测试 ──

describe("parseSkillContent — frontmatter 解析", () => {
  it("正常 frontmatter 解析:name + description + body", () => {
    const content = `---
name: git-commit
description: 提交代码到 git
---

# git-commit

按以下步骤提交代码:
1. git status
2. git add -A
`;
    const result = parseSkillContent(content);
    expect(result).toEqual({
      name: "git-commit",
      description: "提交代码到 git",
      content: "# git-commit\n\n按以下步骤提交代码:\n1. git status\n2. git add -A\n",
    });
  });

  it("body 是空时:content 是空字符串", () => {
    const content = `---
name: empty-skill
description: 空 skill
---
`;
    const result = parseSkillContent(content);
    expect(result.name).toBe("empty-skill");
    expect(result.description).toBe("空 skill");
    expect(result.content).toBe("");
  });

  it("body 含多行 markdown,完整保留", () => {
    const content = `---
name: doc
description: 文档
---
# Title

## Section 1
Para 1.

## Section 2
Para 2.
`;
    const result = parseSkillContent(content);
    expect(result.content).toContain("## Section 1");
    expect(result.content).toContain("## Section 2");
  });

  it("frontmatter 缺失(不以 --- 开头)→ 抛 SkillParseError", () => {
    const content = `# Just markdown\nNo frontmatter here.`;
    expect(() => parseSkillContent(content)).toThrow(SkillParseError);
  });

  it("frontmatter 缺少 name 字段 → 抛错", () => {
    const content = `---
description: 没有 name
---
body`;
    expect(() => parseSkillContent(content)).toThrow(SkillParseError);
  });

  it("frontmatter 缺少 description 字段 → 抛错", () => {
    const content = `---
name: no-desc
---
body`;
    expect(() => parseSkillContent(content)).toThrow(SkillParseError);
  });

  it("frontmatter 闭合 --- 缺失 → 抛错", () => {
    const content = `---
name: unfinished
description: 缺闭合
# 没有 ---
body`;
    expect(() => parseSkillContent(content)).toThrow(SkillParseError);
  });
});

// ── loadSkillFromFile 测试(用 mock ExecutionEnv) ──

import { ok, err, type Result } from "../../../src/harness/env/index.js";
import type { ExecutionEnv, FileInfo, FileError as FileErrorT } from "../../../src/harness/env/index.js";

/** 简单 mock env:内存中预置文件内容 */
function makeMockEnv(files: Record<string, string>): ExecutionEnv {
  return {
    cwd: "/test",
    readFile: async (path: string): Promise<Result<string, FileErrorT>> => {
      if (path in files) return ok(files[path]!);
      return err(new FileError("not_found", `not found: ${path}`, path));
    },
    readBinaryFile: async () => err(new FileError("not_found", "n/a", "")),
    writeFile: async () => ok(undefined),
    appendFile: async () => ok(undefined),
    stat: async (path: string): Promise<Result<FileInfo, FileErrorT>> => {
      if (path in files) {
        return ok({
          name: path.split("/").pop() ?? path,
          path,
          kind: "file",
          size: files[path]!.length,
          mtime: 0,
          mtimeMs: 0,
        });
      }
      return err(new FileError("not_found", `not found: ${path}`, path));
    },
    exists: async (path: string) =>
      ok(path in files),
    readdir: async () => ok([]),
    mkdir: async () => ok(undefined),
    remove: async () => ok(undefined),
    absolutePath: async (p: string) => ok(p),
    joinPath: async (parts: string[]) => ok(parts.join("/")),
    exec: async () =>
      ok({ stdout: "", stderr: "", exitCode: 0, truncated: false }),
  };
}

describe("loadSkillFromFile — 通过 ExecutionEnv 读取 + 解析", () => {
  it("读取并解析 SKILL.md", async () => {
    const env = makeMockEnv({
      "/skills/git-commit/SKILL.md": `---
name: git-commit
description: 提交代码
---
# git-commit
按步骤提交。`,
    });
    const skill = await loadSkillFromFile(env, "/skills/git-commit/SKILL.md");
    expect(skill.name).toBe("git-commit");
    expect(skill.description).toBe("提交代码");
    expect(skill.content).toContain("# git-commit");
  });

  it("文件不存在 → 抛错(FileError)", async () => {
    const env = makeMockEnv({}); // 空
    await expect(
      loadSkillFromFile(env, "/skills/missing/SKILL.md"),
    ).rejects.toThrow();
  });
});
