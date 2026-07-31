/**
 * repo-utils 共享工具测试。
 *
 * 覆盖:
 * - createSessionId / createTimestamp
 * - toSession
 * - getEntriesToFork
 * - getFileSystemResultOrThrow
 */

import { describe, expect, it } from "vitest";
import {
  createSessionId,
  createTimestamp,
  getEntriesToFork,
  getFileSystemResultOrThrow,
  toSession,
} from "../../../src/harness/session/repo-utils.js";
import { InMemorySessionStorage } from "../../../src/harness/session/repos/memory-storage.js";
import { ok, err, SessionError, FileError } from "../../../src/harness/session/types.js";
import type { UserMessage } from "../../../src/harness/session/types.js";

function userMsg(id: string, parentId: string | null, text: string) {
  return {
    type: "message" as const,
    id,
    parentId,
    timestamp: new Date().toISOString(),
    message: { role: "user", content: text, timestamp: Date.now() } as UserMessage,
  };
}

describe("createSessionId", () => {
  it("生成非空字符串", () => {
    expect(createSessionId()).toBeTruthy();
  });

  it("多次调用结果不同", () => {
    const a = createSessionId();
    const b = createSessionId();
    expect(a).not.toBe(b);
  });
});

describe("createTimestamp", () => {
  it("是 ISO 8601 格式", () => {
    const ts = createTimestamp();
    expect(new Date(ts).toISOString()).toBe(ts);
  });
});

describe("toSession", () => {
  it("把 storage 包装成 Session", () => {
    const storage = new InMemorySessionStorage();
    const session = toSession(storage);
    expect(session.getStorage()).toBe(storage);
  });
});

describe("getEntriesToFork", () => {
  it("无 entryId:返回全部 entries", async () => {
    const s = new InMemorySessionStorage();
    await s.appendEntry(userMsg("a", null, "1"));
    await s.appendEntry(userMsg("b", "a", "2"));
    const entries = await getEntriesToFork(s, {});
    expect(entries).toHaveLength(2);
  });

  it("entryId + position='at':包含 targetId 路径", async () => {
    const s = new InMemorySessionStorage();
    await s.appendEntry(userMsg("a", null, "1"));
    await s.appendEntry(userMsg("b", "a", "2"));
    const entries = await getEntriesToFork(s, {
      entryId: "b",
      position: "at",
    });
    expect(entries.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("entryId + position='before'(默认):只到父节点(targetId 必须是 user message)", async () => {
    const s = new InMemorySessionStorage();
    await s.appendEntry(userMsg("a", null, "1"));
    await s.appendEntry(userMsg("b", "a", "2"));
    const entries = await getEntriesToFork(s, { entryId: "b" });
    expect(entries.map((e) => e.id)).toEqual(["a"]);
  });

  it("targetId 不是 user message 抛 invalid_fork_target", async () => {
    const s = new InMemorySessionStorage();
    await s.appendEntry(userMsg("a", null, "1"));
    await s.appendEntry({
      type: "label",
      id: "l",
      parentId: "a",
      timestamp: new Date().toISOString(),
      targetId: "a",
      label: "first",
    });
    await expect(
      getEntriesToFork(s, { entryId: "l", position: "before" }),
    ).rejects.toThrow(SessionError);
  });

  it("targetId 不存在抛 invalid_fork_target", async () => {
    const s = new InMemorySessionStorage();
    await expect(
      getEntriesToFork(s, { entryId: "missing" }),
    ).rejects.toThrow(SessionError);
  });
});

describe("getFileSystemResultOrThrow", () => {
  it("成功 Result 返回 value", () => {
    const result = getFileSystemResultOrThrow(ok(42), "test");
    expect(result).toBe(42);
  });

  it("失败 Result 抛 SessionError", () => {
    const fileError = new FileError("not_found", "missing");
    expect(() =>
      getFileSystemResultOrThrow(err(fileError), "test message"),
    ).toThrow(SessionError);
  });

  it("失败 not_found 映射为 SessionError not_found", () => {
    const fileError = new FileError("not_found", "missing");
    try {
      getFileSystemResultOrThrow(err(fileError), "test");
    } catch (e) {
      expect(e).toBeInstanceOf(SessionError);
      if (e instanceof SessionError) {
        expect(e.code).toBe("not_found");
      }
    }
  });

  it("失败其他 code 映射为 storage", () => {
    const fileError = new FileError("permission_denied", "denied");
    try {
      getFileSystemResultOrThrow(err(fileError), "test");
    } catch (e) {
      if (e instanceof SessionError) {
        expect(e.code).toBe("storage");
      }
    }
  });
});
