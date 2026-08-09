import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createFindTool } from "../../core/tools/find.js";

describe("find", () => {
  const cwd = join(tmpdir(), "mimi-test-find");

  beforeEach(() => {
    mkdirSync(cwd, { recursive: true });
    mkdirSync(join(cwd, "sub"), { recursive: true });
    writeFileSync(join(cwd, "a.ts"), "");
    writeFileSync(join(cwd, "b.js"), "");
    writeFileSync(join(cwd, "sub", "c.ts"), "");
  });

  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it("按 pattern 查找文件", async () => {
    const tool = createFindTool(cwd);
    const result = await tool.execute("c1", { pattern: "*.ts" });
    const text = result.content[0];
    if (text.type === "text") {
      expect(text.text).toContain("a.ts");
      expect(text.text).toContain("c.ts");
    }
  });
});
