/**
 * isContextOverflow 的单元测试。
 *
 * 覆盖三种检测分支：
 * 1. 基于错误消息的模式匹配（含 NON_OVERFLOW 排除）
 * 2. 静默溢出（usage.input > contextWindow）
 * 3. 长度截断溢出（stopReason "length" + 零输出 + 输入填满窗口）
 */
import { describe, it, expect } from "vitest";
import { isContextOverflow } from "../utils/overflow.js";
import type { AssistantMessage } from "../types.js";

function makeAssistant(partial: Partial<AssistantMessage>): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: "hi" }],
    api: "openai-completions",
    provider: "deepseek",
    model: "deepseek-chat",
    usage: { input: 1, output: 1, totalTokens: 2, cost: { input: 0, output: 0, total: 0 } },
    stopReason: "stop",
    timestamp: Date.now(),
    ...partial,
  };
}

describe("isContextOverflow — 错误消息模式", () => {
  it("Anthropic prompt is too long", () => {
    expect(
      isContextOverflow(makeAssistant({ stopReason: "error", errorMessage: "prompt is too long: 213462 tokens > 200000 maximum" })),
    ).toBe(true);
  });

  it("OpenAI exceeds the context window", () => {
    expect(
      isContextOverflow(makeAssistant({ stopReason: "error", errorMessage: "Your input exceeds the context window of this model" })),
    ).toBe(true);
  });

  it("LiteLLM maximum context length", () => {
    expect(
      isContextOverflow(makeAssistant({ stopReason: "error", errorMessage: "exceeds the model's maximum context length of 131072 tokens" })),
    ).toBe(true);
  });

  it("Google input token count exceeds maximum", () => {
    expect(
      isContextOverflow(makeAssistant({ stopReason: "error", errorMessage: "The input token count (1196265) exceeds the maximum number of tokens allowed (1048575)" })),
    ).toBe(true);
  });

  it("xAI maximum prompt length", () => {
    expect(
      isContextOverflow(makeAssistant({ stopReason: "error", errorMessage: "This model's maximum prompt length is 131072 but the request contains 537812 tokens" })),
    ).toBe(true);
  });

  it("Groq reduce the length of the messages", () => {
    expect(
      isContextOverflow(makeAssistant({ stopReason: "error", errorMessage: "Please reduce the length of the messages or completion" })),
    ).toBe(true);
  });

  it("非溢出的普通错误返回 false", () => {
    expect(
      isContextOverflow(makeAssistant({ stopReason: "error", errorMessage: "invalid_api_key" })),
    ).toBe(false);
  });
});

describe("isContextOverflow — NON_OVERFLOW 排除", () => {
  it("Bedrock Throttling error 前缀不判为溢出", () => {
    expect(
      isContextOverflow(makeAssistant({ stopReason: "error", errorMessage: "Throttling error: Too many tokens, please wait before trying again." })),
    ).toBe(false);
  });

  it("rate limit 不判为溢出", () => {
    expect(
      isContextOverflow(makeAssistant({ stopReason: "error", errorMessage: "rate limit exceeded, try again later" })),
    ).toBe(false);
  });
});

describe("isContextOverflow — 静默溢出（usage.input > contextWindow）", () => {
  it("input 超过窗口 → true", () => {
    const msg = makeAssistant({
      stopReason: "stop",
      usage: { input: 250000, output: 1, totalTokens: 250001, cost: { input: 0, output: 0, total: 0 } },
    });
    expect(isContextOverflow(msg, 200000)).toBe(true);
  });

  it("input 未超窗口 → false", () => {
    const msg = makeAssistant({
      stopReason: "stop",
      usage: { input: 100000, output: 1, totalTokens: 100001, cost: { input: 0, output: 0, total: 0 } },
    });
    expect(isContextOverflow(msg, 200000)).toBe(false);
  });

  it("未传 contextWindow 时不触发静默溢出检测", () => {
    const msg = makeAssistant({
      stopReason: "stop",
      usage: { input: 250000, output: 1, totalTokens: 250001, cost: { input: 0, output: 0, total: 0 } },
    });
    expect(isContextOverflow(msg)).toBe(false);
  });
});

describe("isContextOverflow — 长度截断（MiMo 风格）", () => {
  it("length + 零输出 + 输入填满窗口 → true", () => {
    const msg = makeAssistant({
      stopReason: "length",
      usage: { input: 199000, output: 0, totalTokens: 199000, cost: { input: 0, output: 0, total: 0 } },
    });
    expect(isContextOverflow(msg, 200000)).toBe(true);
  });

  it("length + 零输出但输入未填满 → false", () => {
    const msg = makeAssistant({
      stopReason: "length",
      usage: { input: 100000, output: 0, totalTokens: 100000, cost: { input: 0, output: 0, total: 0 } },
    });
    expect(isContextOverflow(msg, 200000)).toBe(false);
  });
});
