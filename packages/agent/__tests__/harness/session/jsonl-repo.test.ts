/**
 * JSONL session repo 测试。
 *
 * 覆盖:
 * - create:写新 session 文件
 * - open:从 metadata 打开
 * - list:扫描目录,返回 metadata 列表
 * - delete:删除文件
 * - fork:从 source 派生新文件
 * - cwd 编码
 */

import { beforeEach, describe, expect, it } from "vitest";
import { JsonlSessionRepo } from "../../../src/harness/session/repos/jsonl-repo.js";
import { MockFs } from "./_helpers/mock-fs.js";
import { SessionError } from "../../../src/harness/session/types.js";

describe("JsonlSessionRepo — create", () => {
  let fs: MockFs;
  let repo: JsonlSessionRepo;
  beforeEach(() => {
    fs = new MockFs("/");
    repo = new JsonlSessionRepo({ fs, sessionsRoot: "/sessions" });
  });

  it("create 写新文件,header 包含 id / cwd / timestamp", async () => {
    const session = await repo.create({ cwd: "/home" });
    const meta = await session.getMetadata();
    expect(meta.id).toBeTruthy();
    expect(meta.cwd).toBe("/home");
    // meta.path 是文件路径,cwd 已被编码为目录段("--home--")
    expect(meta.path).toContain("--home--");
  });

  it("create 多个 session 互不影响", async () => {
    const a = await repo.create({ cwd: "/home" });
    const b = await repo.create({ cwd: "/home" });
    expect((await a.getMetadata()).id).not.toBe((await b.getMetadata()).id);
  });

  it("create 可指定 id", async () => {
    const session = await repo.create({ cwd: "/home", id: "my-id" });
    expect((await session.getMetadata()).id).toBe("my-id");
  });

  it("create 后 Session.appendMessage 立即落盘", async () => {
    const session = await repo.create({ cwd: "/home" });
    await session.appendMessage({
      role: "user",
      content: "hi",
      timestamp: Date.now(),
    });
    const file = fs._allFiles().find((p) => p.endsWith(".jsonl"));
    expect(file).toBeTruthy();
    const raw = await fs._readRaw(file!);
    // header + 1 entry(appendMessage 只写 entry,不写 leaf——leaf 在 setLeafId 时才写)
    expect(raw!.split("\n").filter(Boolean)).toHaveLength(2);
  });

  it("setLeafId 后追加一条 leaf entry(共 3 行)", async () => {
    const session = await repo.create({ cwd: "/home" });
    const messageId = await session.appendMessage({
      role: "user",
      content: "hi",
      timestamp: Date.now(),
    });
    await session.setLeafId(messageId);
    const file = fs._allFiles().find((p) => p.endsWith(".jsonl"));
    expect(file).toBeTruthy();
    const raw = await fs._readRaw(file!);
    // header + entry + leaf
    expect(raw!.split("\n").filter(Boolean)).toHaveLength(3);
  });
});

describe("JsonlSessionRepo — open", () => {
  it("open 已存在的 session 返回可用的 Session", async () => {
    const fs = new MockFs("/");
    const repo = new JsonlSessionRepo({ fs, sessionsRoot: "/sessions" });
    const created = await repo.create({ cwd: "/home", id: "s1" });
    await created.appendMessage({
      role: "user",
      content: "hi",
      timestamp: Date.now(),
    });

    const opened = await repo.open(await created.getMetadata());
    expect((await opened.getMetadata()).id).toBe("s1");
    expect((await opened.getEntries()).length).toBeGreaterThan(0);
  });

  it("open 不存在的 session 抛 not_found", async () => {
    const fs = new MockFs("/");
    const repo = new JsonlSessionRepo({ fs, sessionsRoot: "/sessions" });
    await expect(
      repo.open({
        id: "x",
        createdAt: "now",
        cwd: "/",
        path: "/missing.jsonl",
      }),
    ).rejects.toThrow(SessionError);
  });
});

describe("JsonlSessionRepo — list", () => {
  it("list 返回所有 session metadata,按 createdAt 倒序", async () => {
    const fs = new MockFs("/");
    const repo = new JsonlSessionRepo({ fs, sessionsRoot: "/sessions" });
    await repo.create({ cwd: "/home", id: "a" });
    // 给 b 一些时间差
    await new Promise((r) => setTimeout(r, 10));
    await repo.create({ cwd: "/home", id: "b" });
    const list = await repo.list();
    expect(list.map((m) => m.id)).toEqual(["b", "a"]);
  });

  it("list 按 cwd 过滤", async () => {
    const fs = new MockFs("/");
    const repo = new JsonlSessionRepo({ fs, sessionsRoot: "/sessions" });
    await repo.create({ cwd: "/home", id: "h1" });
    await repo.create({ cwd: "/work", id: "w1" });
    const homeList = await repo.list({ cwd: "/home" });
    expect(homeList.map((m) => m.id)).toEqual(["h1"]);
  });

  it("list 忽略 header 损坏的文件(不抛错)", async () => {
    const fs = new MockFs("/");
    const repo = new JsonlSessionRepo({ fs, sessionsRoot: "/sessions" });
    await repo.create({ cwd: "/home", id: "good" });
    // 写一个 header 损坏的文件
    await fs.writeFile("/sessions/--home--/bad.jsonl", "garbage\n");
    const list = await repo.list();
    expect(list.map((m) => m.id)).toEqual(["good"]);
  });

  it("list 不存在的 sessionsRoot 返回 []", async () => {
    const fs = new MockFs("/");
    const repo = new JsonlSessionRepo({ fs, sessionsRoot: "/nonexistent" });
    expect(await repo.list()).toEqual([]);
  });
});

describe("JsonlSessionRepo — delete", () => {
  it("delete 移除 session 文件", async () => {
    const fs = new MockFs("/");
    const repo = new JsonlSessionRepo({ fs, sessionsRoot: "/sessions" });
    const session = await repo.create({ cwd: "/home", id: "x" });
    const meta = await session.getMetadata();
    await repo.delete(meta);
    await expect(repo.open(meta)).rejects.toThrow(SessionError);
  });
});

describe("JsonlSessionRepo — fork", () => {
  it("fork 派生新 session,parentSessionPath 指向源", async () => {
    const fs = new MockFs("/");
    const repo = new JsonlSessionRepo({ fs, sessionsRoot: "/sessions" });
    const source = await repo.create({ cwd: "/home", id: "src" });
    await source.appendMessage({
      role: "user",
      content: "hi",
      timestamp: Date.now(),
    });
    const forked = await repo.fork(await source.getMetadata(), {
      cwd: "/home",
    });
    const meta = await forked.getMetadata();
    expect(meta.parentSessionPath).toBe((await source.getMetadata()).path);
  });

  it("fork 后 fork 与 source 互相独立", async () => {
    const fs = new MockFs("/");
    const repo = new JsonlSessionRepo({ fs, sessionsRoot: "/sessions" });
    const source = await repo.create({ cwd: "/home", id: "src" });
    await source.appendMessage({
      role: "user",
      content: "from-source",
      timestamp: Date.now(),
    });
    const forked = await repo.fork(await source.getMetadata(), {
      cwd: "/home",
    });
    await forked.appendMessage({
      role: "user",
      content: "from-fork",
      timestamp: Date.now(),
    });
    const sourceEntries = (await source.getEntries()).filter(
      (e: any) => e.type === "message",
    );
    const forkEntries = (await forked.getEntries()).filter(
      (e: any) => e.type === "message",
    );
    expect(sourceEntries).toHaveLength(1);
    expect(forkEntries).toHaveLength(2);
  });
});

describe("JsonlSessionRepo — cwd 编码", () => {
  it("cwd 含 / 和冒号被编码为目录名", async () => {
    const fs = new MockFs("/");
    const repo = new JsonlSessionRepo({ fs, sessionsRoot: "/sessions" });
    await repo.create({ cwd: "C:/Users/foo", id: "x" });
    // 目录名应是 --C-Users-foo--
    const files = fs._allFiles();
    expect(files.some((p) => p.includes("--C-Users-foo--"))).toBe(true);
  });

  it("unix 路径被编码", async () => {
    const fs = new MockFs("/");
    const repo = new JsonlSessionRepo({ fs, sessionsRoot: "/sessions" });
    await repo.create({ cwd: "/home/user", id: "x" });
    expect(fs._allFiles().some((p) => p.includes("--home-user--"))).toBe(true);
  });
});
