/**
 * normalizeProviderError 的单元测试。
 */
import { describe, it, expect } from "vitest";
import { normalizeProviderError } from "../utils/error-body.js";

describe("normalizeProviderError", () => {
  it("处理 OpenAI 格式错误（有 status 字段）", () => {
    const err = { status: 429, message: "Rate limit exceeded", error: { code: "rate_limit" } };
    expect(normalizeProviderError(err)).toEqual({
      status: 429,
      message: "Rate limit exceeded",
      body: { code: "rate_limit" },
    });
  });

  it("处理 Anthropic 格式错误（有 status_code 字段）", () => {
    const err = { status_code: 500, message: "Internal server error" };
    expect(normalizeProviderError(err)).toEqual({
      status: 500,
      message: "Internal server error",
      body: err,
    });
  });

  it("处理标准 Error", () => {
    expect(normalizeProviderError(new Error("something broke"))).toEqual({
      message: "something broke",
    });
  });

  it("处理字符串错误", () => {
    expect(normalizeProviderError("plain string error")).toEqual({
      message: "plain string error",
    });
  });

  it("处理 null/undefined", () => {
    expect(normalizeProviderError(null)).toEqual({ message: "null" });
    expect(normalizeProviderError(undefined)).toEqual({ message: "undefined" });
  });
});
