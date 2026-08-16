/**
 * StringEnum helper 的单元测试。
 */
import { describe, it, expect } from "vitest";
import { type Static } from "typebox";
import { StringEnum } from "../utils/typebox-helpers.js";

describe("StringEnum", () => {
  it("生成 JSON Schema 原生 enum 数组形式", () => {
    const schema = StringEnum(["user", "project", "both"]);
    expect(schema).toEqual({ type: "string", enum: ["user", "project", "both"] });
  });

  it("不包含 anyOf / const（兼容不支持它们的 provider）", () => {
    const schema = StringEnum(["a", "b"] as const);
    expect(schema).not.toHaveProperty("anyOf");
    expect(schema).not.toHaveProperty("const");
  });

  it("支持 description 选项", () => {
    const schema = StringEnum(["user", "project"], {
      description: "Agent scope",
    });
    expect(schema).toEqual({
      type: "string",
      enum: ["user", "project"],
      description: "Agent scope",
    });
  });

  it("支持 default 选项", () => {
    const schema = StringEnum(["user", "project"], { default: "user" });
    expect(schema).toEqual({
      type: "string",
      enum: ["user", "project"],
      default: "user",
    });
  });

  it("Static 类型收窄为字面量联合", () => {
    const schema = StringEnum(["user", "project", "both"] as const);
    type Scope = Static<typeof schema>;
    // 编译期断言：Scope 是三个字面量的联合
    const a: Scope = "user";
    const b: Scope = "project";
    const c: Scope = "both";
    expect([a, b, c]).toEqual(["user", "project", "both"]);
  });
});
