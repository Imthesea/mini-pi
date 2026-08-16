/**
 * discoverAndLoadExtensions / loadExtensionFromFactory 的单元测试。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { discoverAndLoadExtensions, loadExtensionFromFactory } from "../../core/extensions/loader.js";
import type { ExtensionFactory } from "../../core/extensions/types.js";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mimi-ext-test-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("discoverAndLoadExtensions", () => {
  it("项目级扩展目录被发现并加载（单文件）", async () => {
    const extDir = path.join(tmpDir, "case1", ".mimi", "extensions");
    fs.mkdirSync(extDir, { recursive: true });
    fs.writeFileSync(
      path.join(extDir, "hello.ts"),
      `export default function (api: any) {
        api.registerTool({
          name: "hello",
          label: "Hello",
          description: "Says hello",
          parameters: { type: "object", properties: {} },
          execute: async () => ({ content: [], details: {} }),
        });
      }`,
    );

    const result = await discoverAndLoadExtensions([], path.join(tmpDir, "case1"), path.join(tmpDir, "no-global"));

    expect(result.errors).toEqual([]);
    expect(result.extensions).toHaveLength(1);
    expect(result.extensions[0].tools.has("hello")).toBe(true);
  });

  it("子目录的 index.ts 被发现", async () => {
    const extDir = path.join(tmpDir, "case2", ".mimi", "extensions", "sub");
    fs.mkdirSync(extDir, { recursive: true });
    fs.writeFileSync(
      path.join(extDir, "index.ts"),
      `export default function (api: any) {
        api.registerTool({
          name: "sub-tool",
          label: "Sub",
          description: "Sub tool",
          parameters: { type: "object", properties: {} },
          execute: async () => ({ content: [], details: {} }),
        });
      }`,
    );

    const result = await discoverAndLoadExtensions([], path.join(tmpDir, "case2"), path.join(tmpDir, "no-global"));

    expect(result.errors).toEqual([]);
    expect(result.extensions).toHaveLength(1);
    expect(result.extensions[0].tools.has("sub-tool")).toBe(true);
  });

  it("非函数默认导出报错", async () => {
    const extDir = path.join(tmpDir, "case3", ".mimi", "extensions");
    fs.mkdirSync(extDir, { recursive: true });
    fs.writeFileSync(path.join(extDir, "bad.ts"), "export default 42;");

    const result = await discoverAndLoadExtensions([], path.join(tmpDir, "case3"), path.join(tmpDir, "no-global"));

    expect(result.extensions).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toContain("does not export a valid factory function");
  });

  it("显式配置路径指向目录时发现其中的扩展", async () => {
    const extDir = path.join(tmpDir, "case4", "custom-exts");
    fs.mkdirSync(extDir, { recursive: true });
    fs.writeFileSync(
      path.join(extDir, "explicit.ts"),
      `export default function (api: any) {
        api.registerTool({
          name: "explicit",
          label: "Explicit",
          description: "Explicit tool",
          parameters: { type: "object", properties: {} },
          execute: async () => ({ content: [], details: {} }),
        });
      }`,
    );

    const result = await discoverAndLoadExtensions([extDir], path.join(tmpDir, "case4-empty"), path.join(tmpDir, "no-global"));

    expect(result.errors).toEqual([]);
    expect(result.extensions).toHaveLength(1);
    expect(result.extensions[0].tools.has("explicit")).toBe(true);
  });

  it("同一路径去重（项目级与显式配置重复）", async () => {
    const root = path.join(tmpDir, "case5");
    const extDir = path.join(root, ".mimi", "extensions");
    fs.mkdirSync(extDir, { recursive: true });
    fs.writeFileSync(
      path.join(extDir, "dup.ts"),
      `export default function (api: any) {
        api.registerTool({
          name: "dup",
          label: "Dup",
          description: "Dup tool",
          parameters: { type: "object", properties: {} },
          execute: async () => ({ content: [], details: {} }),
        });
      }`,
    );

    const result = await discoverAndLoadExtensions([extDir], root, path.join(tmpDir, "no-global"));

    expect(result.errors).toEqual([]);
    expect(result.extensions).toHaveLength(1);
  });
});

describe("loadExtensionFromFactory", () => {
  it("内联工厂注册工具", async () => {
    const factory: ExtensionFactory = (api) => {
      api.registerTool({
        name: "inline",
        label: "Inline",
        description: "Inline tool",
        parameters: { type: "object", properties: {} },
        execute: async () => ({ content: [], details: {} }),
      });
    };

    const extension = await loadExtensionFromFactory(factory, tmpDir);

    expect(extension.path).toBe("<inline>");
    expect(extension.tools.has("inline")).toBe(true);
  });
});
