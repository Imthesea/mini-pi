/**
 * isRetryableAssistantError 的单元测试。
 */
import { describe, it, expect } from "vitest";
import { isRetryableAssistantError } from "../utils/retry.js";

describe("isRetryableAssistantError", () => {
  it("可重试：服务端过载", () => {
    expect(isRetryableAssistantError(new Error("server overloaded"))).toBe(true);
  });

  it("可重试：503 错误", () => {
    expect(isRetryableAssistantError(new Error("HTTP 503 service unavailable"))).toBe(true);
  });

  it("可重试：网络超时", () => {
    expect(isRetryableAssistantError(new Error("Request timed out"))).toBe(true);
  });

  it("可重试：ECONNRESET", () => {
    expect(isRetryableAssistantError(new Error("read ECONNRESET"))).toBe(true);
  });

  it("不可重试：配额不足", () => {
    expect(isRetryableAssistantError(new Error("insufficient_quota"))).toBe(false);
  });

  it("不可重试：API Key 无效", () => {
    expect(isRetryableAssistantError(new Error("invalid_api_key"))).toBe(false);
  });

  it("不可重试：模型不存在", () => {
    expect(isRetryableAssistantError(new Error("model_not_found"))).toBe(false);
  });

  it("不可重试：权限不足", () => {
    expect(isRetryableAssistantError(new Error("permission denied"))).toBe(false);
  });

  it("可重试：rate_limit_exceeded（之前被错判为不可重试）", () => {
    expect(isRetryableAssistantError(new Error("rate_limit_exceeded"))).toBe(true);
  });

  it("可重试：HTTP 429", () => {
    expect(isRetryableAssistantError(new Error("HTTP 429 too many requests"))).toBe(true);
  });

  it("可重试：too many requests", () => {
    expect(isRetryableAssistantError(new Error("Too Many Requests"))).toBe(true);
  });

  it("处理字符串错误", () => {
    expect(isRetryableAssistantError("timeout error")).toBe(true);
  });

  it("默认不重试未知错误", () => {
    expect(isRetryableAssistantError(new Error("something unknown"))).toBe(false);
  });
});
