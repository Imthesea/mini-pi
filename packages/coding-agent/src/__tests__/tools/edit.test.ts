import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createEditTool } from "../../core/tools/edit.js";

describe("edit", () => {
  const cwd = join(tmpdir(), "mimi-test-edit");

  beforeEach(() => { mkdirSync(cwd, { recursive: true }); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it("精确替换文本", async () => {
    writeFileSync(join(cwd, "f.txt"), "hello world");
    const tool = createEditTool(cwd);
    await tool.execute("c1", {
      path: "f.txt",
      old_string: "hello",
      new_string: "hi",
    });
    expect(readFileSync(join(cwd, "f.txt"), "utf-8")).toBe("hi world");
  });

  it("replace_all 替换全部", async () => {
    writeFileSync(join(cwd, "f.txt"), "a a a");
    const tool = createEditTool(cwd);
    await tool.execute("c1", {
      path: "f.txt",
      old_string: "a",
      new_string: "b",
      replace_all: true,
    });
    expect(readFileSync(join(cwd, "f.txt"), "utf-8")).toBe("b b b");
  });
});
