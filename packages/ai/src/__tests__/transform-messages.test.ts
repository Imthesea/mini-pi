/**
 * transformMessages 的单元测试。
 */
import { describe, it, expect } from "vitest";
import { transformMessages } from "../api/transform-messages.js";
import type { Model, Message } from "../types.js";

const visionModel: Model<"openai-completions"> = {
  id: "vision-model",
  name: "Vision",
  api: "openai-completions",
  provider: "openai",
  baseUrl: "",
  reasoning: false,
  input: ["text", "image"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1000,
  maxTokens: 100,
};

const textOnlyModel: Model<"openai-completions"> = {
  ...visionModel,
  id: "text-only",
  input: ["text"],
};

describe("transformMessages", () => {
  it("视觉模型保留图片内容不变", () => {
    const messages: Message[] = [{
      role: "user",
      content: [{ type: "image", data: "base64...", mimeType: "image/png" }],
      timestamp: 0,
    }];

    const result = transformMessages(messages, visionModel);
    expect(result[0]).toBe(messages[0]);
  });

  it("非视觉模型将图片替换为 [图片] 占位符", () => {
    const messages: Message[] = [{
      role: "user",
      content: [
        { type: "text", text: "看这张图:" },
        { type: "image", data: "base64...", mimeType: "image/png" },
      ],
      timestamp: 0,
    }];

    const result = transformMessages(messages, textOnlyModel);
    const content = (result[0] as any).content;
    expect(content[0]).toEqual({ type: "text", text: "看这张图:" });
    expect(content[1]).toEqual({ type: "text", text: "[图片]" });
  });

  it("纯文本消息不变", () => {
    const messages: Message[] = [{
      role: "user",
      content: "hello",
      timestamp: 0,
    }];

    const result = transformMessages(messages, textOnlyModel);
    expect(result[0]).toBe(messages[0]);
  });
});
