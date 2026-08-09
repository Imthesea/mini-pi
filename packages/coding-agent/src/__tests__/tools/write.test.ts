import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWriteTool } from "../../core/tools/write.js";

describe("write_file", () => {
  const cwd = join(tmpdir(), "mimi-test-write");

  beforeEach(() => { mkdirSync(cwd, { recursive: true }); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it("写文件成功", async () => {
    const tool = createWriteTool(cwd);
    const result = await tool.execute("c1", { path: "out.txt", content: "hello" });
    expect(existsSync(join(cwd, "out.txt"))).toBe(true);
    expect(readFileSync(join(cwd, "out.txt"), "utf-8")).toBe("hello");
  });

  it("自动创建父目录", async () => {
    const tool = createWriteTool(cwd);
    await tool.execute("c1", { path: "a/b/c.txt", content: "deep" });
    expect(existsSync(join(cwd, "a/b/c.txt"))).toBe(true);
  });

  it("路径越界返回错误", async () => {
    const tool = createWriteTool(cwd);
    const result = await tool.execute("c1", { path: "/etc/hostname", content: "x" });
    expect(result.details.isError).toBe(true);
  });
});
