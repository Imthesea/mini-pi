/**
 * envApiKey 的单元测试。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { envApiKey } from "../auth.js";

describe("envApiKey", () => {
  const VAR = "TEST_MIMI_API_KEY";

  beforeEach(() => {
    delete process.env[VAR];
  });

  afterEach(() => {
    delete process.env[VAR];
  });

  it("环境变量存在时返回其值", () => {
    process.env[VAR] = "sk-test-key-123";
    expect(envApiKey(VAR)).toBe("sk-test-key-123");
  });

  it("环境变量不存在时返回 undefined", () => {
    expect(envApiKey(VAR)).toBeUndefined();
  });

  it("环境变量为空字符串时返回 undefined", () => {
    process.env[VAR] = "   ";
    expect(envApiKey(VAR)).toBeUndefined();
  });

  it("自动 trim 首尾空格", () => {
    process.env[VAR] = "  key-with-spaces  ";
    expect(envApiKey(VAR)).toBe("key-with-spaces");
  });
});
