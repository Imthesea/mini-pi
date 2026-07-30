/**
 * harness/system-prompt/parts.ts 的单元测试。
 *
 * parts.ts 提供 system prompt 各部分的拼装:
 * - formatSkillsBlock: 把 skills 列表拼成 agentskills.io 风格的 XML 块
 * - formatToolsBlock: 工具列表的描述(可选,Task 4 后启用)
 * - joinParts: 把多个部分按顺序拼成最终字符串
 *
 * Task 3 阶段:仅实现 formatSkillsBlock + joinParts。
 */

import { describe, expect, it } from "vitest";
import {
  formatSkillsBlock,
  joinParts,
} from "../../../src/harness/system-prompt/parts.js";
import type { Skill } from "../../../src/harness/types/harness.js";

describe("harness/system-prompt/parts", () => {
  describe("formatSkillsBlock", () => {
    it("空数组 → 空字符串", () => {
      expect(formatSkillsBlock([])).toBe("");
    });

    it("一个 skill → XML 块含 name + description", () => {
      const block = formatSkillsBlock([
        { name: "git-commit", description: "提交代码到 git", content: "..." },
      ]);
      expect(block).toContain("<available_skills>");
      expect(block).toContain("git-commit");
      expect(block).toContain("提交代码到 git");
      expect(block).toContain("</available_skills>");
    });

    it("多个 skill:每个 skill 单独一段", () => {
      const block = formatSkillsBlock([
        { name: "s1", description: "d1", content: "c1" },
        { name: "s2", description: "d2", content: "c2" },
      ]);
      expect(block).toContain("s1");
      expect(block).toContain("d1");
      expect(block).toContain("s2");
      expect(block).toContain("d2");
    });
  });

  describe("joinParts", () => {
    it("空数组 → 空字符串", () => {
      expect(joinParts([])).toBe("");
    });

    it("全部为空 → 空字符串(不引入空行)", () => {
      expect(joinParts(["", "", ""])).toBe("");
    });

    it("只跳过空字符串,保留非空内容", () => {
      const out = joinParts(["a", "", "b", "c"]);
      expect(out).toBe("a\n\nb\n\nc");
    });

    it("两个非空部分用双换行分隔", () => {
      expect(joinParts(["first", "second"])).toBe("first\n\nsecond");
    });
  });
});
