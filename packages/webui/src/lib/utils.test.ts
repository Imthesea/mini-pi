import { describe, it, expect } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("合并多个字符串 class", () => {
    expect(cn("a", "b", "c")).toBe("a b c");
  });

  it("按条件对象过滤 class", () => {
    expect(cn("base", { active: true, disabled: false })).toBe("base active");
  });

  it("过滤 falsy 值", () => {
    expect(cn("a", null, undefined, false, "b")).toBe("a b");
  });

  it("冲突 class 后值覆盖前值（tailwind-merge）", () => {
    expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
  });
});
