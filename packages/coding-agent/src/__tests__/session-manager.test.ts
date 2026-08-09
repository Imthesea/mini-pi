/**
 * SessionManager 单元测试。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionManager } from "../core/session-manager.js";

// Pi 的 session-manager 采用延迟写：_persist() 只在第一条 assistant 消息后才写入文件。
// 因此测试中需要在 create/open 后 append 一条 assistant 消息触发持久化。

const ASSISTANT_MSG = {
  role: "assistant" as const,
  content: [{ type: "text" as const, text: "hello" }],
  api: "openai-completions" as const,
  provider: "deepseek" as const,
  model: "deepseek-chat",
  usage: { input: 1, output: 1, totalTokens: 2, cost: { input: 0, output: 0, total: 0 } },
  stopReason: "stop" as const,
  timestamp: Date.now(),
};

describe("SessionManager", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), "mimi-test-")); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("create 新建 session，append assistant 后文件生成", () => {
    const sm = SessionManager.create(tmpDir, join(tmpDir, "sessions"), { id: "test-1" });
    sm.appendMessage(ASSISTANT_MSG);
    expect(sm.getSessionId()).toBe("test-1");
    expect(existsSync(sm.getSessionFile()!)).toBe(true);
  });

  it("open 打开已有 session 文件", () => {
    const sm1 = SessionManager.create(tmpDir, join(tmpDir, "sessions"), { id: "test-2" });
    sm1.appendMessage(ASSISTANT_MSG); // 触发持久化
    const sm2 = SessionManager.open(sm1.getSessionFile()!, join(tmpDir, "sessions"));
    expect(sm2.getSessionId()).toBe("test-2");
  });

  it("continueRecent 空目录 → 新建", () => {
    const sm = SessionManager.continueRecent(tmpDir, join(tmpDir, "sessions"));
    expect(sm.getSessionId()).toBeDefined();
  });

  it("continueRecent 有 session → 续接", () => {
    const sm1 = SessionManager.create(tmpDir, join(tmpDir, "sessions"), { id: "recent-test" });
    sm1.appendMessage(ASSISTANT_MSG);
    const sm2 = SessionManager.continueRecent(tmpDir, join(tmpDir, "sessions"));
    expect(sm2.getSessionId()).toBe("recent-test");
  });

  it("inMemory 不创建文件", () => {
    const sm = SessionManager.inMemory(tmpDir, { id: "mem-1" });
    expect(sm.getSessionId()).toBe("mem-1");
    expect(sm.getSessionFile()).toBeUndefined();
  });

  it("appendMessage 后文件存在", () => {
    const sm = SessionManager.create(tmpDir, join(tmpDir, "sessions"));
    sm.appendMessage(ASSISTANT_MSG);
    expect(existsSync(sm.getSessionFile()!)).toBe(true);
  });

  it("list 列出 session", async () => {
    const dir = join(tmpDir, "sessions");
    const s1 = SessionManager.create(tmpDir, dir, { id: "aaa" });
    s1.appendMessage(ASSISTANT_MSG);
    const s2 = SessionManager.create(tmpDir, dir, { id: "bbb" });
    s2.appendMessage(ASSISTANT_MSG);
    const sessions = await SessionManager.list(tmpDir, dir);
    expect(sessions.length).toBe(2);
  });

  it("getEntries / buildSessionContext", () => {
    const sm = SessionManager.inMemory(tmpDir);
    sm.appendMessage({ role: "user", content: "hi", timestamp: Date.now() } as any);
    sm.appendMessage(ASSISTANT_MSG);
    expect(sm.getEntries().length).toBe(2);
    const ctx = sm.buildSessionContext();
    expect(ctx.messages.length).toBe(2);
  });
});
