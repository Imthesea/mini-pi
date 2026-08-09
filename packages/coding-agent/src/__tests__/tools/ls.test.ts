import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createLsTool } from "../../core/tools/ls.js";

describe("ls", () => {
  const cwd = join(tmpdir(), "mimi-test-ls");

  beforeEach(() => {
    mkdirSync(cwd, { recursive: true });
    mkdirSync(join(cwd, "dir1"), { recursive: true });
    writeFileSync(join(cwd, "file1.txt"), "x");
  });

  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it("列出目录内容", async () => {
    const tool = createLsTool(cwd);
    const result = await tool.execute("c1", { path: "." });
    const text = result.content[0];
    if (text.type === "text") {
      expect(text.text).toContain("dir1");
      expect(text.text).toContain("file1.txt");
    }
  });

  it("不加 path 默认列 cwd", async () => {
    const tool = createLsTool(cwd);
    const result = await tool.execute("c1", {});
    const text = result.content[0];
    if (text.type === "text") {
      expect(text.text).toContain("file1.txt");
    }
  });
});
