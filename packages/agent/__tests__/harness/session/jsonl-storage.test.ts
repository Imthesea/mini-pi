/**
 * JSONL session storage 测试。
 *
 * 覆盖:
 * - create:写 header
 * - open:读已有文件,重建 leaf
 * - appendEntry / setLeafId:同步追加到文件
 * - close → open:恢复所有 entries
 * - 解析异常:header 损坏 / entry 损坏
 * - loadJsonlSessionMetadata 只读 header
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  JsonlSessionStorage,
  loadJsonlSessionMetadata,
} from "../../../src/harness/session/repos/jsonl-storage.js";
import { MockFs } from "./_helpers/mock-fs.js";
import type { UserMessage } from "../../../src/harness/session/types.js";
import { SessionError } from "../../../src/harness/session/types.js";

function userMsg(text: string, timestamp = Date.now()): UserMessage {
  return { role: "user", content: text, timestamp };
}

describe("JsonlSessionStorage — create / open", () => {
  let fs: MockFs;
  beforeEach(() => {
    fs = new MockFs("/");
  });

  it("create 写 header(version=3 + id + cwd + timestamp)", async () => {
    const filePath = "/sessions/--root--/test.jsonl";
    const storage = await JsonlSessionStorage.create(fs, filePath, {
      cwd: "/root",
      sessionId: "s1",
    });
    const meta = await storage.getMetadata();
    expect(meta.id).toBe("s1");
    expect(meta.cwd).toBe("/root");
    expect(meta.path).toBe(filePath);
    expect(meta.createdAt).toBeTruthy();
    expect(await storage.getLeafId()).toBeNull();
  });

  it("open 读 header 重建 leaf", async () => {
    const filePath = "/sessions/--root--/test.jsonl";
    // 先 create,再 append entries
    const storage = await JsonlSessionStorage.create(fs, filePath, {
      cwd: "/root",
      sessionId: "s1",
    });
    const msgId = await storage.createEntryId();
    await storage.appendEntry({
      type: "message",
      id: msgId,
      parentId: null,
      timestamp: new Date().toISOString(),
      message: userMsg("hi"),
    });

    // 重新 open
    const reopened = await JsonlSessionStorage.open(fs, filePath);
    expect((await reopened.getLeafId())).toBe(msgId);
    expect((await reopened.getEntries())).toHaveLength(1);
  });

  it("open 文件不存在抛 not_found(SessionError)", async () => {
    await expect(
      JsonlSessionStorage.open(fs, "/nonexistent.jsonl"),
    ).rejects.toThrow(SessionError);
  });

  it("open header 损坏抛 invalid_session", async () => {
    const filePath = "/bad.jsonl";
    await fs.writeFile(filePath, "not json\n");
    await expect(JsonlSessionStorage.open(fs, filePath)).rejects.toThrow(
      SessionError,
    );
  });

  it("open header 缺少 id 抛 invalid_session", async () => {
    const filePath = "/bad.jsonl";
    await fs.writeFile(
      filePath,
      `${JSON.stringify({ type: "session", version: 3, timestamp: "now", cwd: "/" })}\n`,
    );
    await expect(JsonlSessionStorage.open(fs, filePath)).rejects.toThrow(
      SessionError,
    );
  });

  it("open 错误 version 抛 invalid_session", async () => {
    const filePath = "/bad.jsonl";
    await fs.writeFile(
      filePath,
      `${JSON.stringify({ type: "session", version: 2, id: "x", timestamp: "now", cwd: "/" })}\n`,
    );
    await expect(JsonlSessionStorage.open(fs, filePath)).rejects.toThrow(
      SessionError,
    );
  });

  it("open entry 行损坏抛 invalid_entry(含行号)", async () => {
    const filePath = "/bad.jsonl";
    const header = {
      type: "session",
      version: 3,
      id: "x",
      timestamp: "now",
      cwd: "/",
    };
    await fs.writeFile(
      filePath,
      `${JSON.stringify(header)}\nthis is not json\n`,
    );
    try {
      await JsonlSessionStorage.open(fs, filePath);
      expect.fail("应该抛错");
    } catch (e) {
      expect(e).toBeInstanceOf(SessionError);
      if (e instanceof SessionError) {
        expect(e.code).toBe("invalid_entry");
        expect(e.message).toContain("line 2");
      }
    }
  });
});

describe("JsonlSessionStorage — appendEntry / setLeafId", () => {
  let fs: MockFs;
  beforeEach(() => {
    fs = new MockFs("/");
  });

  it("appendEntry 追加一行到文件", async () => {
    const filePath = "/test.jsonl";
    const storage = await JsonlSessionStorage.create(fs, filePath, {
      cwd: "/",
      sessionId: "s1",
    });
    await storage.appendEntry({
      type: "message",
      id: "m1",
      parentId: null,
      timestamp: "2026-01-01T00:00:00Z",
      message: userMsg("hi"),
    });
    const raw = await fs._readRaw(filePath);
    expect(raw).toBeTruthy();
    // header + entry
    const lines = raw!.split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
    // 验证 entry 是合法 JSON
    const entry = JSON.parse(lines[1]!);
    expect(entry.id).toBe("m1");
    expect(entry.type).toBe("message");
  });

  it("setLeafId 追加一条 leaf entry", async () => {
    const filePath = "/test.jsonl";
    const storage = await JsonlSessionStorage.create(fs, filePath, {
      cwd: "/",
      sessionId: "s1",
    });
    await storage.appendEntry({
      type: "message",
      id: "m1",
      parentId: null,
      timestamp: "2026-01-01T00:00:00Z",
      message: userMsg("hi"),
    });
    await storage.setLeafId("m1");
    expect(await storage.getLeafId()).toBe("m1");
    const raw = await fs._readRaw(filePath);
    const lines = raw!.split("\n").filter(Boolean);
    expect(lines).toHaveLength(3);
    const leaf = JSON.parse(lines[2]!);
    expect(leaf.type).toBe("leaf");
    expect(leaf.targetId).toBe("m1");
  });

  it("appendEntry 后 close + open 能恢复", async () => {
    const filePath = "/test.jsonl";
    let storage = await JsonlSessionStorage.create(fs, filePath, {
      cwd: "/",
      sessionId: "s1",
    });
    await storage.appendEntry({
      type: "message",
      id: "m1",
      parentId: null,
      timestamp: "2026-01-01T00:00:00Z",
      message: userMsg("hi"),
    });
    await storage.appendEntry({
      type: "message",
      id: "m2",
      parentId: "m1",
      timestamp: "2026-01-01T00:00:01Z",
      message: userMsg("world"),
    });
    // 重新打开
    storage = await JsonlSessionStorage.open(fs, filePath);
    const entries = await storage.getEntries();
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.id)).toEqual(["m1", "m2"]);
    expect(await storage.getLeafId()).toBe("m2");
  });

  it("setLeafId 指向不存在 entry 抛 not_found", async () => {
    const filePath = "/test.jsonl";
    const storage = await JsonlSessionStorage.create(fs, filePath, {
      cwd: "/",
      sessionId: "s1",
    });
    await expect(storage.setLeafId("missing")).rejects.toThrow(SessionError);
  });
});

describe("loadJsonlSessionMetadata", () => {
  it("只读 header 不加载 entries", async () => {
    const fs = new MockFs("/");
    const filePath = "/test.jsonl";
    const storage = await JsonlSessionStorage.create(fs, filePath, {
      cwd: "/",
      sessionId: "s1",
    });
    // 追加一些 entries(让文件有内容)
    for (let i = 0; i < 5; i++) {
      await storage.appendEntry({
        type: "message",
        id: `m${i}`,
        parentId: i === 0 ? null : `m${i - 1}`,
        timestamp: new Date().toISOString(),
        message: userMsg(`msg-${i}`),
      });
    }
    // 直接读 header
    const meta = await loadJsonlSessionMetadata(fs, filePath);
    expect(meta.id).toBe("s1");
    expect(meta.cwd).toBe("/");
  });

  it("文件为空抛 invalid_session", async () => {
    const fs = new MockFs("/");
    await fs.writeFile("/empty.jsonl", "");
    await expect(loadJsonlSessionMetadata(fs, "/empty.jsonl")).rejects.toThrow(
      SessionError,
    );
  });
});
