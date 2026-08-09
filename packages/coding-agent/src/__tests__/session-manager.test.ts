/**
 * SessionManager 单元测试 —— TDD Step 1: 测试先写。
 *
 * 覆盖：
 * - create 新建 session 目录和文件
 * - open 打开已有 session 文件
 * - continueRecent 无/有 24h 内 session 续接
 * - inMemory 不创建文件
 * - appendEntry 写 JSONL
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { readFile } from "node:fs/promises";
import { SessionManager } from "../core/session-manager.js";

describe("SessionManager", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mimi-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("create 新建 session 目录和文件", () => {
    const sm = SessionManager.create(tmpDir, join(tmpDir, "sessions"), {
      id: "test-1",
    });
    expect(sm.id).toBe("test-1");
    expect(sm.path).toContain("test-1.jsonl");
    sm.close();
  });

  it("open 打开已有 session 文件", () => {
    const sm1 = SessionManager.create(tmpDir, join(tmpDir, "sessions"), {
      id: "test-2",
    });
    sm1.close();

    const sm2 = SessionManager.open(sm1.path!, join(tmpDir, "sessions"));
    expect(sm2.id).toBe("test-2");
    sm2.close();
  });

  it("continueRecent 空目录 → 新建", () => {
    const sm = SessionManager.continueRecent(
      tmpDir,
      join(tmpDir, "sessions"),
    );
    expect(sm.id).toBeDefined();
    expect(sm.id.length).toBeGreaterThan(0);
    sm.close();
  });

  it("continueRecent 有 24h 内 session → 续接", () => {
    const sm1 = SessionManager.create(tmpDir, join(tmpDir, "sessions"), {
      id: "recent-test",
    });
    sm1.close();

    const sm2 = SessionManager.continueRecent(
      tmpDir,
      join(tmpDir, "sessions"),
    );
    expect(sm2.id).toBe("recent-test");
    sm2.close();
  });

  it("inMemory 不创建文件", () => {
    const sm = SessionManager.inMemory(tmpDir, { id: "mem-1" });
    expect(sm.id).toBe("mem-1");
    expect(sm.path).toBeUndefined();
    sm.close();
  });

  it("appendEntry 写 JSONL 行到文件", async () => {
    const sm = SessionManager.create(tmpDir, join(tmpDir, "sessions"));
    await sm.appendEntry({
      type: "message",
      role: "user",
      content: "hello world",
      timestamp: Date.now(),
    });
    sm.close();

    const content = await readFile(sm.path!, "utf-8");
    const parsed = JSON.parse(content.trim());
    expect(parsed.content).toBe("hello world");
  });

  it("list 列出 cwd 下所有 session", () => {
    const dir = join(tmpDir, "sessions");
    SessionManager.create(tmpDir, dir, { id: "aaa" }).close();
    SessionManager.create(tmpDir, dir, { id: "bbb" }).close();

    const sessions = SessionManager.list(tmpDir, dir);
    expect(sessions.length).toBe(2);
    expect(sessions.some((s) => s.id === "aaa")).toBe(true);
    expect(sessions.some((s) => s.id === "bbb")).toBe(true);
  });
});
