import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createBashTool } from "../../core/tools/bash.js";

describe("bash", () => {
  const cwd = join(tmpdir(), "mimi-test-bash");

  beforeEach(() => { mkdirSync(cwd, { recursive: true }); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it("简单命令 echo", async () => {
    process.env.MIMI_CWD = cwd;
    const tool = createBashTool(cwd);
    const result = await tool.execute("c1", { command: "echo hello" });
    const text = result.content[0];
    if (text.type === "text") expect(text.text).toContain("hello");
  });

  it("命令错误时返回 isError", async () => {
    process.env.MIMI_CWD = cwd;
    const tool = createBashTool(cwd);
    const result = await tool.execute("c1", { command: "nonexistent_command_xyz" });
    expect(result.details.isError).toBe(true);
  });
});
