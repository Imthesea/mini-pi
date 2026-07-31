/**
 * NodeExecutionEnv 测试。
 *
 * 覆盖:
 * - readFile 成功 + 失败
 * - writeFile 成功 + 失败
 * - stat(file/dir)
 * - readdir
 * - mkdir
 * - exec 简单命令
 * - exec 超时
 * - exec 输出截断
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NodeExecutionEnv } from "../../../src/harness/env/nodejs.js";
import { FileError } from "../../../src/harness/env/types.js";
import { ExecutionError } from "../../../src/harness/env/types.js";

// ── 测试用临时目录 ──

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("NodeExecutionEnv", () => {
  let tmpDir: string;
  let env: NodeExecutionEnv;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "nodejs-env-test-"));
    env = new NodeExecutionEnv();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── readFile ──

  describe("readFile", () => {
    it("读存在的文件返回 ok(content)", async () => {
      const file = join(tmpDir, "hello.txt");
      const writeRes = await env.writeFile(file, "hello world");
      expect(writeRes.ok).toBe(true);

      const readRes = await env.readFile(file);
      expect(readRes.ok).toBe(true);
      if (readRes.ok) expect(readRes.value).toBe("hello world");
    });

    it("读不存在的文件返回 Err(not_found)", async () => {
      const res = await env.readFile(join(tmpDir, "missing.txt"));
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBeInstanceOf(FileError);
        expect(res.error.code).toBe("not_found");
      }
    });
  });

  // ── writeFile ──

  describe("writeFile", () => {
    it("写文件成功,可再次读出", async () => {
      const file = join(tmpDir, "out.txt");
      const res = await env.writeFile(file, "content");
      expect(res.ok).toBe(true);

      const readRes = await env.readFile(file);
      expect(readRes.ok).toBe(true);
      if (readRes.ok) expect(readRes.value).toBe("content");
    });

    it("写文件覆盖原内容", async () => {
      const file = join(tmpDir, "overwrite.txt");
      await env.writeFile(file, "first");
      await env.writeFile(file, "second");
      const readRes = await env.readFile(file);
      expect(readRes.ok).toBe(true);
      if (readRes.ok) expect(readRes.value).toBe("second");
    });
  });

  // ── stat ──

  describe("stat", () => {
    it("返回文件类型(file)", async () => {
      const file = join(tmpDir, "f.txt");
      await env.writeFile(file, "x");
      const res = await env.stat(file);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.kind).toBe("file");
        expect(res.value.name).toBe("f.txt");
        expect(res.value.size).toBeGreaterThanOrEqual(0);
      }
    });

    it("返回目录类型(directory)", async () => {
      const res = await env.stat(tmpDir);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.kind).toBe("directory");
      }
    });

    it("stat 不存在的路径返回 Err(not_found)", async () => {
      const res = await env.stat(join(tmpDir, "nope"));
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe("not_found");
      }
    });
  });

  // ── readdir ──

  describe("readdir", () => {
    it("列出目录内容", async () => {
      await env.writeFile(join(tmpDir, "a.txt"), "a");
      await env.writeFile(join(tmpDir, "b.txt"), "b");
      const res = await env.readdir(tmpDir);
      expect(res.ok).toBe(true);
      if (res.ok) {
        const names = res.value.map((e) => e.name).sort();
        expect(names).toEqual(["a.txt", "b.txt"]);
        for (const entry of res.value) {
          expect(entry.kind).toBe("file");
        }
      }
    });

    it("readdir 不存在的目录返回 Err(not_found)", async () => {
      const res = await env.readdir(join(tmpDir, "missing"));
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe("not_found");
      }
    });
  });

  // ── mkdir ──

  describe("mkdir", () => {
    it("创建目录(默认 recursive:true),可 stat 出来", async () => {
      const dir = join(tmpDir, "new", "nested");
      const res = await env.mkdir(dir);
      expect(res.ok).toBe(true);

      const statRes = await env.stat(dir);
      expect(statRes.ok).toBe(true);
      if (statRes.ok) expect(statRes.value.kind).toBe("directory");
    });

    it("mkdir 已存在的目录(recursive:true)不报错", async () => {
      const res = await env.mkdir(tmpDir);
      expect(res.ok).toBe(true);
    });
  });

  // ── exec ──

  describe("exec", () => {
    it("执行简单命令(用 node console.log 代替 echo 跨平台),返回 stdout", async () => {
      // 用 node -e "console.log('hello')" 跨平台(Windows 上 echo 是 cmd 内置命令)
      const res = await env.exec(process.execPath, ["-e", "console.log('hello')"]);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.stdout).toBe("hello\n");
        expect(res.value.exitCode).toBe(0);
      }
    });

    it("执行列出目录的命令(用 node 列目录代替 ls 跨平台)", async () => {
      await env.writeFile(join(tmpDir, "x.txt"), "x");
      // 用 node 列目录:跨平台,Windows 上没有 ls
      const res = await env.exec(process.execPath, [
        "-e",
        `require('fs').readdirSync(${JSON.stringify(tmpDir)}).forEach(f => console.log(f))`,
      ]);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.stdout).toContain("x.txt");
      }
    });

    it("失败命令(非 0 退出码)返回 Result,exitCode 不为 0", async () => {
      // 用 node 显式 exit 1,跨平台(Windows 没有 false 命令)
      const res = await env.exec(process.execPath, ["-e", "process.exit(1)"]);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.exitCode).not.toBe(0);
      }
    });

    it("不存在的命令返回 Err(spawn_error)", async () => {
      const res = await env.exec("this-command-does-not-exist-xyz");
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBeInstanceOf(ExecutionError);
        // spawn 失败:Windows 上是 spawn_error,Linux/Mac 也类似
        expect(["spawn_error", "shell_unavailable"]).toContain(res.error.code);
      }
    });

    it("超时返回 Err(timeout),不挂死", async () => {
      // 用 sleep 类命令:Windows 没有 sleep,用 node -e 等待;在所有平台有 node
      const res = await env.exec(process.execPath, ["-e", "setTimeout(() => {}, 5000)"], {
        timeout: 100,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBeInstanceOf(ExecutionError);
        expect(res.error.code).toBe("timeout");
      }
    });

    it("输出截断(maxOutputBytes)", async () => {
      const res = await env.exec(process.execPath, [
        "-e",
        "process.stdout.write('x'.repeat(2000)); process.stdout.write('\\n')",
      ], { maxOutputBytes: 100 });
      expect(res.ok).toBe(true);
      if (res.ok) {
        // stdout 应被截断到 ~100 字节 + 截断标记
        expect(res.value.stdout.length).toBeLessThan(2000);
        expect(res.value.stdout).toMatch(/truncated/i);
      }
    });
  });
});
