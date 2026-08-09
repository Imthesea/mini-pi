import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createReadTool } from "../../core/tools/read.js";

describe("read_file", () => {
  const cwd = join(tmpdir(), "mimi-test-read");
  const testFile = join(cwd, "hello.txt");

  beforeEach(() => {
    mkdirSync(cwd, { recursive: true });
    writeFileSync(testFile, "line1\nline2\nline3\nline4\nline5\n");
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("读 cwd 下文件成功", async () => {
    const tool = createReadTool(cwd);
    const result = await tool.execute("c1", { path: "hello.txt" });
    const text = result.content[0];
    expect(text.type).toBe("text");
    if (text.type === "text") expect(text.text).toContain("line1");
  });

  it("路径越界返回错误", async () => {
    const tool = createReadTool(cwd);
    const result = await tool.execute("c1", { path: "/etc/hostname" });
    expect(result.details.isError).toBe(true);
  });

  it("带 offset 和 limit 读部分内容", async () => {
    const tool = createReadTool(cwd);
    const result = await tool.execute("c1", {
      path: "hello.txt",
      offset: 2,
      limit: 2,
    });
    const text = result.content[0];
    if (text.type === "text") {
      expect(text.text).toContain("line2");
      expect(text.text).toContain("line3");
    }
  });

  it("文件不存在返回错误", async () => {
    const tool = createReadTool(cwd);
    const result = await tool.execute("c1", { path: "nonexistent.txt" });
    expect(result.details.isError).toBe(true);
  });
});
