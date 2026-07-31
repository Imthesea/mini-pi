/**
 * 内存 SessionRepo 测试。
 *
 * 覆盖:
 * - create:产生新 session,记录到内部 map
 * - open:从 metadata 找到已有 session
 * - list:返回所有 session 的 metadata
 * - delete:从 map 移除
 * - fork:从 source 派生新 session,可选 entryId / position
 */

import { describe, expect, it } from "vitest";
import { InMemorySessionRepo } from "../../../src/harness/session/repos/memory-repo.js";
import type { Session } from "../../../src/harness/session/session.js";
import { SessionError } from "../../../src/harness/session/types.js";
import type { SessionMetadata, UserMessage } from "../../../src/harness/session/types.js";

function userMsg(text: string, timestamp = Date.now()): UserMessage {
  return { role: "user", content: text, timestamp };
}

describe("InMemorySessionRepo — create", () => {
  it("create 默认 id 自动生成", async () => {
    const repo = new InMemorySessionRepo();
    const session = await repo.create();
    const meta = await session.getMetadata();
    expect(meta.id).toBeTruthy();
    expect(meta.createdAt).toBeTruthy();
  });

  it("create 可指定 id", async () => {
    const repo = new InMemorySessionRepo();
    const session = await repo.create({ id: "my-session" });
    const meta = await session.getMetadata();
    expect(meta.id).toBe("my-session");
  });

  it("create 多个 session 互不干扰", async () => {
    const repo = new InMemorySessionRepo();
    const a = await repo.create({ id: "a" });
    const b = await repo.create({ id: "b" });
    expect((await a.getMetadata()).id).toBe("a");
    expect((await b.getMetadata()).id).toBe("b");
  });
});

describe("InMemorySessionRepo — open", () => {
  it("open 已有 session 返回同一实例", async () => {
    const repo = new InMemorySessionRepo();
    const a = await repo.create({ id: "s1" });
    const b = await repo.open({ id: "s1", createdAt: "now" });
    expect(b).toBe(a);
  });

  it("open 不存在的 session 抛 not_found", async () => {
    const repo = new InMemorySessionRepo();
    const metadata: SessionMetadata = { id: "missing", createdAt: "now" };
    await expect(repo.open(metadata)).rejects.toThrow(SessionError);
  });
});

describe("InMemorySessionRepo — list", () => {
  it("list 返回所有 session 的 metadata", async () => {
    const repo = new InMemorySessionRepo();
    await repo.create({ id: "a" });
    await repo.create({ id: "b" });
    const list = await repo.list();
    expect(list).toHaveLength(2);
    expect(list.map((m) => m.id).sort()).toEqual(["a", "b"]);
  });

  it("空 repo list 返回 []", async () => {
    const repo = new InMemorySessionRepo();
    expect(await repo.list()).toEqual([]);
  });
});

describe("InMemorySessionRepo — delete", () => {
  it("delete 移除 session,open 抛 not_found", async () => {
    const repo = new InMemorySessionRepo();
    await repo.create({ id: "x" });
    const meta: SessionMetadata = { id: "x", createdAt: "now" };
    await repo.delete(meta);
    await expect(repo.open(meta)).rejects.toThrow(SessionError);
  });

  it("delete 不存在的 session 不报错", async () => {
    const repo = new InMemorySessionRepo();
    const meta: SessionMetadata = { id: "nope", createdAt: "now" };
    await expect(repo.delete(meta)).resolves.toBeUndefined();
  });
});

describe("InMemorySessionRepo — fork", () => {
  it("fork 无 entryId:新 session 包含全部 entries", async () => {
    const repo = new InMemorySessionRepo();
    const source = await repo.create({ id: "src" });
    await source.appendMessage(userMsg("hi"));
    await source.appendMessage(userMsg("world"));

    const forked = await repo.fork(
      await source.getMetadata(),
      {},
    );
    expect(forked).not.toBe(source);
    const entries = await forked.getEntries();
    // 包含 2 条 message + 1 条 leaf(setLeafId 追加的)
    expect(entries.length).toBeGreaterThanOrEqual(2);
    expect((await forked.getMetadata()).id).not.toBe("src");
  });

  it("fork position='at':从指定 entry 开始复制(包含 targetId)", async () => {
    const repo = new InMemorySessionRepo();
    const source = await repo.create({ id: "src" });
    const id1 = await source.appendMessage(userMsg("a"));
    const id2 = await source.appendMessage(userMsg("b"));
    const id3 = await source.appendMessage(userMsg("c"));

    const forked = await repo.fork(
      await source.getMetadata(),
      { entryId: id2, position: "at" },
    );
    const path = await forked.getBranch(id2);
    // path 应包含 [id1, id2] 两条(id1 是 id2 的父)
    expect(path.map((e: any) => e.id)).toEqual([id1, id2]);
  });

  it("fork position='before':复制到 targetId 父节点(targetId 必须为 user message)", async () => {
    const repo = new InMemorySessionRepo();
    const source = await repo.create({ id: "src" });
    const id1 = await source.appendMessage(userMsg("a"));
    const id2 = await source.appendMessage(userMsg("b"));
    await source.appendMessage(userMsg("c"));

    const forked = await repo.fork(
      await source.getMetadata(),
      { entryId: id2, position: "before" },
    );
    const path = await forked.getBranch(id1);
    expect(path.map((e: any) => e.id)).toEqual([id1]);
  });

  it("fork 指向非 user message 抛 invalid_fork_target", async () => {
    const repo = new InMemorySessionRepo();
    const source = await repo.create({ id: "src" });
    await source.appendMessage(userMsg("a"));
    // 假设存在一个非 message 的 entry
    const sid = await source.appendModelChange("anthropic", "claude-3-5-sonnet");
    await expect(
      repo.fork(await source.getMetadata(), { entryId: sid, position: "before" }),
    ).rejects.toThrow(SessionError);
  });

  it("fork 可指定新 session id", async () => {
    const repo = new InMemorySessionRepo();
    const source = await repo.create({ id: "src" });
    await source.appendMessage(userMsg("hi"));
    const forked = await repo.fork(await source.getMetadata(), { id: "new-id" });
    expect((await forked.getMetadata()).id).toBe("new-id");
  });

  it("fork 源与目标互不影响:向 forked append 不影响 source", async () => {
    const repo = new InMemorySessionRepo();
    const source: Session = await repo.create({ id: "src" });
    await source.appendMessage(userMsg("a"));
    const forked = await repo.fork(await source.getMetadata(), {});
    await forked.appendMessage(userMsg("only-in-fork"));
    const sourceMsgs = (await source.getEntries()).filter((e: any) => e.type === "message");
    const forkMsgs = (await forked.getEntries()).filter((e: any) => e.type === "message");
    expect(sourceMsgs).toHaveLength(1);
    expect(forkMsgs.length).toBeGreaterThan(1);
  });
});
