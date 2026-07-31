/**
 * 内存 SessionStorage 测试。
 *
 * 覆盖:
 * - 构造:空 / 带 entries / 重建 leafId
 * - appendEntry:byId 索引 / labelsById / leafId 联动
 * - setLeafId:必须追加 LeafEntry,不只改变量
 * - findEntries:按 type 字面量 narrow
 * - getPathToRoot:从 leaf 沿 parentId 链回溯
 * - 异常:not_found / invalid_session
 */

import { beforeEach, describe, expect, it } from "vitest";
import { InMemorySessionStorage } from "../../../src/harness/session/repos/memory-storage.js";
import type { SessionTreeEntry } from "../../../src/harness/session/types.js";
import { SessionError } from "../../../src/harness/session/types.js";

// 工厂:造一个简单的 user message entry
function userMsg(id: string, parentId: string | null, text: string): SessionTreeEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp: new Date().toISOString(),
    message: { role: "user", content: text, timestamp: Date.now() },
  };
}

describe("InMemorySessionStorage — 构造", () => {
  it("空构造:无 entries,leafId=null,metadata 有 id/createdAt", async () => {
    const s = new InMemorySessionStorage();
    const meta = await s.getMetadata();
    expect(meta.id).toBeTruthy();
    expect(meta.createdAt).toBeTruthy();
    expect(await s.getLeafId()).toBeNull();
    expect(await s.getEntries()).toEqual([]);
  });

  it("带 entries 构造:重建 leafId 为最后一条 entry 的 id", async () => {
    const e1 = userMsg("e1", null, "hi");
    const e2 = userMsg("e2", "e1", "world");
    const s = new InMemorySessionStorage({ entries: [e1, e2] });
    expect(await s.getLeafId()).toBe("e2");
  });

  it("带 entries 构造:有 label entry,labelsById 正确建立", async () => {
    const e1 = userMsg("e1", null, "hi");
    const label: SessionTreeEntry = {
      type: "label",
      id: "l1",
      parentId: null,
      timestamp: new Date().toISOString(),
      targetId: "e1",
      label: "first",
    };
    const s = new InMemorySessionStorage({ entries: [e1, label] });
    expect(await s.getLabel("e1")).toBe("first");
  });

  it("带 entries 构造:末尾是 leaf entry,leafId 指向其 targetId", async () => {
    const e1 = userMsg("e1", null, "hi");
    const leaf: SessionTreeEntry = {
      type: "leaf",
      id: "lf1",
      parentId: null,
      timestamp: new Date().toISOString(),
      targetId: "e1",
    };
    const s = new InMemorySessionStorage({ entries: [e1, leaf] });
    expect(await s.getLeafId()).toBe("e1");
  });

  it("构造时若 leafId 指向不存在的 entry,抛 invalid_session", () => {
    const leaf: SessionTreeEntry = {
      type: "leaf",
      id: "lf1",
      parentId: null,
      timestamp: new Date().toISOString(),
      targetId: "missing",
    };
    expect(() => new InMemorySessionStorage({ entries: [leaf] })).toThrow(
      SessionError,
    );
  });

  it("自定义 metadata 应该被采用", async () => {
    const s = new InMemorySessionStorage({
      metadata: { id: "custom-id", createdAt: "2026-01-01" },
    });
    const m = await s.getMetadata();
    expect(m.id).toBe("custom-id");
    expect(m.createdAt).toBe("2026-01-01");
  });
});

describe("InMemorySessionStorage — appendEntry", () => {
  let s: InMemorySessionStorage;
  beforeEach(() => {
    s = new InMemorySessionStorage();
  });

  it("追加 entry 后 byId 索引能找到", async () => {
    const e1 = userMsg("e1", null, "hi");
    await s.appendEntry(e1);
    expect(await s.getEntry("e1")).toEqual(e1);
  });

  it("追加 entry 后 leafId 自动更新到新 entry id", async () => {
    const e1 = userMsg("e1", null, "hi");
    await s.appendEntry(e1);
    expect(await s.getLeafId()).toBe("e1");
  });

  it("追加 label entry 后 labelsById 更新", async () => {
    const e1 = userMsg("e1", null, "hi");
    const label: SessionTreeEntry = {
      type: "label",
      id: "l1",
      parentId: "e1",
      timestamp: new Date().toISOString(),
      targetId: "e1",
      label: "greeting",
    };
    await s.appendEntry(e1);
    await s.appendEntry(label);
    expect(await s.getLabel("e1")).toBe("greeting");
  });

  it("追加 label entry with empty label 会删除缓存项", async () => {
    const e1 = userMsg("e1", null, "hi");
    const label1: SessionTreeEntry = {
      type: "label",
      id: "l1",
      parentId: "e1",
      timestamp: new Date().toISOString(),
      targetId: "e1",
      label: "first",
    };
    const label2: SessionTreeEntry = {
      type: "label",
      id: "l2",
      parentId: "e1",
      timestamp: new Date().toISOString(),
      targetId: "e1",
      label: "",
    };
    await s.appendEntry(e1);
    await s.appendEntry(label1);
    expect(await s.getLabel("e1")).toBe("first");
    await s.appendEntry(label2);
    expect(await s.getLabel("e1")).toBeUndefined();
  });

  it("parentId 指向不存在的 entry 时抛 invalid_session", async () => {
    const e1: SessionTreeEntry = {
      type: "message",
      id: "e1",
      parentId: "missing",
      timestamp: new Date().toISOString(),
      message: { role: "user", content: "hi", timestamp: Date.now() },
    };
    await expect(s.appendEntry(e1)).rejects.toThrow(SessionError);
  });

  it("getEntries 返回拷贝(修改不影响内部)", async () => {
    const e1 = userMsg("e1", null, "hi");
    await s.appendEntry(e1);
    const arr = await s.getEntries();
    arr.pop();
    expect(await s.getEntries()).toHaveLength(1);
  });
});

describe("InMemorySessionStorage — setLeafId", () => {
  let s: InMemorySessionStorage;
  beforeEach(async () => {
    s = new InMemorySessionStorage();
    await s.appendEntry(userMsg("e1", null, "hi"));
  });

  it("setLeafId 必须追加一条 LeafEntry,不只改变量", async () => {
    await s.setLeafId("e1");
    const entries = await s.getEntries();
    expect(entries).toHaveLength(2);
    expect(entries[1]?.type).toBe("leaf");
    expect(entries[1]?.parentId).toBe("e1");
  });

  it("setLeafId 后 getLeafId 返回新值", async () => {
    await s.setLeafId("e1");
    expect(await s.getLeafId()).toBe("e1");
  });

  it("setLeafId(null) 允许指向空", async () => {
    await s.setLeafId("e1");
    await s.setLeafId(null);
    expect(await s.getLeafId()).toBeNull();
  });

  it("setLeafId 指向不存在的 entry 抛 not_found", async () => {
    await expect(s.setLeafId("missing")).rejects.toThrow(SessionError);
  });
});

describe("InMemorySessionStorage — findEntries", () => {
  it("按 type 字面量 narrow 返回", async () => {
    const s = new InMemorySessionStorage();
    await s.appendEntry(userMsg("e1", null, "hi"));
    await s.appendEntry(userMsg("e2", "e1", "world"));
    const msgs = await s.findEntries("message");
    expect(msgs).toHaveLength(2);
    // 类型已经在编译期 narrow,这里只验证运行时
    expect(msgs.every((m) => m.type === "message")).toBe(true);
  });

  it("无匹配返回空数组", async () => {
    const s = new InMemorySessionStorage();
    const labels = await s.findEntries("label");
    expect(labels).toEqual([]);
  });
});

describe("InMemorySessionStorage — getPathToRoot", () => {
  it("空 session 返回 []", async () => {
    const s = new InMemorySessionStorage();
    expect(await s.getPathToRoot(null)).toEqual([]);
  });

  it("从 leaf 沿 parentId 链回溯,顺序为 root → ... → leaf", async () => {
    const s = new InMemorySessionStorage();
    await s.appendEntry(userMsg("e1", null, "a"));
    await s.appendEntry(userMsg("e2", "e1", "b"));
    await s.appendEntry(userMsg("e3", "e2", "c"));
    const path = await s.getPathToRoot("e3");
    expect(path.map((e) => e.id)).toEqual(["e1", "e2", "e3"]);
  });

  it("leafId 指向不存在的 entry 抛 not_found", async () => {
    const s = new InMemorySessionStorage();
    await expect(s.getPathToRoot("missing")).rejects.toThrow(SessionError);
  });

  it("链路断裂(父引用不存在)抛 invalid_session", async () => {
    const e1: SessionTreeEntry = {
      type: "message",
      id: "e1",
      parentId: "ghost",
      timestamp: new Date().toISOString(),
      message: { role: "user", content: "x", timestamp: Date.now() },
    };
    // 手动构造时绕过 appendEntry 的 parentId 校验
    const s = new InMemorySessionStorage({ entries: [e1] });
    await expect(s.getPathToRoot("e1")).rejects.toThrow(SessionError);
  });
});

describe("InMemorySessionStorage — createEntryId", () => {
  it("生成的 id 不与已有 id 冲突", async () => {
    const s = new InMemorySessionStorage();
    await s.appendEntry(userMsg("e1", null, "hi"));
    const id = await s.createEntryId();
    expect(id).toBeTruthy();
    expect(id).not.toBe("e1");
  });
});
