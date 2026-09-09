import { describe, it, expect } from "vitest";
import { groupSessionsByCwd, workspaceLabel } from "./group-sessions";
import type { SessionInfo } from "./types";

function makeSession(id: string, cwd: string): SessionInfo {
  return { id, title: "", messageCount: 0, firstMessage: "", cwd };
}

describe("groupSessionsByCwd", () => {
  it("按 cwd 分组，保持组内顺序", () => {
    const groups = groupSessionsByCwd([
      makeSession("a", "/projA"),
      makeSession("b", "/projB"),
      makeSession("c", "/projA"),
    ]);
    expect(groups).toHaveLength(2);
    const byCwd = Object.fromEntries(
      groups.map((g) => [g.cwd, g.sessions.map((s) => s.id)]),
    );
    expect(byCwd["/projA"]).toEqual(["a", "c"]);
    expect(byCwd["/projB"]).toEqual(["b"]);
  });

  it("cwd 为空归入空字符串组", () => {
    const groups = groupSessionsByCwd([makeSession("a", "")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].cwd).toBe("");
  });

  it("空列表返回空数组", () => {
    expect(groupSessionsByCwd([])).toEqual([]);
  });
});

describe("workspaceLabel", () => {
  it("取最后一段路径（兼容 / 与 \\）", () => {
    expect(workspaceLabel("/a/b/proj")).toBe("proj");
    expect(workspaceLabel("C:\\Users\\x\\proj")).toBe("proj");
  });

  it("空 cwd 返回占位文案", () => {
    expect(workspaceLabel("")).toBe("(未知目录)");
  });
});
