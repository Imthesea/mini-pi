import { describe, it, expect } from "vitest";
import { summarizeToolArgs } from "./tool-args";

describe("summarizeToolArgs", () => {
  it("read 带 filePath 时返回文件名", () => {
    expect(
      summarizeToolArgs("Read", { filePath: "src/a.txt" }),
    ).toBe("Read a.txt");
  });

  it("bash 带 command 时返回命令", () => {
    expect(summarizeToolArgs("Bash", { command: "echo hi" })).toBe(
      "Bash echo hi",
    );
  });

  it("write/edit 带 path 时返回路径", () => {
    expect(summarizeToolArgs("Write", { path: "docs/notes.md" })).toBe(
      "Write notes.md",
    );
    expect(summarizeToolArgs("Edit", { file: "a/b.ts" })).toBe("Edit b.ts");
  });

  it("无 args 时只返回工具名", () => {
    expect(summarizeToolArgs("Read")).toBe("Read");
  });

  it("args 里无已知字段时返回工具名兜底", () => {
    expect(summarizeToolArgs("Read", { foo: 1 })).toBe("Read");
  });
});
