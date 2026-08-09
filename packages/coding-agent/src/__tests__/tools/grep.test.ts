import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createGrepTool } from "../../core/tools/grep.js";

describe("grep", () => {
  const cwd = join(tmpdir(), "mimi-test-grep");

  beforeEach(() => {
    mkdirSync(cwd, { recursive: true });
    writeFileSync(join(cwd, "a.txt"), "hello world\nfoo bar\n");
    writeFileSync(join(cwd, "b.txt"), "goodbye\nhello again\n");
  });

  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it("搜索文件内容", async () => {
    const tool = createGrepTool(cwd);
    const result = await tool.execute("c1", { pattern: "hello" });
    const text = result.content[0];
    if (text.type === "text") {
      expect(text.text).toContain("a.txt");
      expect(text.text).toContain("b.txt");
    }
  });
});
