/**
 * Example 01：核心类型验证。
 * 创建 Model / Context 对象，验证类型系统能正常运转。
 * 无需 API Key。
 *
 * 运行：npx tsx examples/01-core-types.ts
 */

import type { Model, Context, UserMessage } from "../src/types.js";

// 创建模型定义
const model: Model<"anthropic-messages"> = {
  id: "claude-sonnet-4-20250514",
  name: "Claude Sonnet 4",
  api: "anthropic-messages",
  provider: "anthropic",
  baseUrl: "https://api.anthropic.com",
  reasoning: true,
  input: ["text", "image"],
  cost: { input: 3.0, output: 15.0, cacheRead: 0.30, cacheWrite: 3.75 },
  contextWindow: 200000,
  maxTokens: 8192,
};

// 创建上下文
const context: Context = {
  systemPrompt: "你是一个有帮助的助手。",
  messages: [
    {
      role: "user",
      content: "你好！",
      timestamp: Date.now(),
    } satisfies UserMessage,
  ],
};

console.log("✅ 模型:", model.name);
console.log("✅ Provider:", model.provider);
console.log("✅ 上下文消息数:", context.messages.length);
console.log("✅ 所有类型检查通过！");
