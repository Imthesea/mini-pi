/**
 * Example 02：认证 + Models 框架验证。
 * 使用 mock Provider 验证注册、查找、分发流程。
 * 无需 API Key。
 *
 * 运行：npx tsx examples/02-auth-and-models.ts
 */

import { createModels } from "../src/provider.js";
import { AssistantMessageEventStream } from "../src/stream.js";
import { envApiKey } from "../src/auth.js";
import type { Provider, Models } from "../src/provider.js";
import type { Api, Model, Context } from "../src/types.js";

// ── 构建 mock Provider ──
function createMockProvider(): Provider<Api> {
  const models: Model<Api>[] = [{
    id: "mock-1",
    name: "Mock Model",
    api: "anthropic-messages",
    provider: "mock",
    baseUrl: "https://mock.example.com",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 4096,
    maxTokens: 256,
  }];

  const provider: Provider<Api> = {
    id: "mock",
    name: "Mock Provider",
    getApiKey: () => "mock-key-for-test",
    getModels: () => models,
    getModel: (id) => models.find((m) => m.id === id),
    stream: (model, context, _options) => {
      const stream = new AssistantMessageEventStream();
      stream.push({
        type: "start",
        partial: {
          role: "assistant",
          content: [],
          api: "anthropic-messages",
          provider: "mock",
          model: model.id,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: "stop",
          timestamp: Date.now(),
        },
      });
      setTimeout(() => {
        stream.push({
          type: "done",
          reason: "stop",
          message: {
            role: "assistant",
            content: [{ type: "text", text: `Mock 响应——你发了 ${context.messages.length} 条消息` }],
            api: "anthropic-messages",
            provider: "mock",
            model: model.id,
            usage: { input: 5, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 8, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
            stopReason: "stop",
            timestamp: Date.now(),
          },
        });
      }, 10);
      return stream;
    },
    complete: async (model, context, options) => {
      return provider.stream(model, context, options).result();
    },
  };

  return provider;
}

// ── 主流程 ──
console.log("=== Example 02: 认证 + Models 框架验证 ===\n");

// 1. 检查环境变量
const hasAnthropic = envApiKey("ANTHROPIC_API_KEY");
const hasOpenAI = envApiKey("OPENAI_API_KEY");
const hasDeepSeek = envApiKey("DEEPSEEK_API_KEY");
console.log("环境变量状态:");
console.log(`  ANTHROPIC_API_KEY: ${hasAnthropic ? "✅ 已设置" : "⚠️ 未设置（示例 03 需要）"}`);
console.log(`  OPENAI_API_KEY:    ${hasOpenAI ? "✅ 已设置" : "⚠️ 未设置（示例 04 需要）"}`);
console.log(`  DEEPSEEK_API_KEY:  ${hasDeepSeek ? "✅ 已设置" : "⚠️ 未设置（示例 05 需要）"}`);
console.log();

// 2. Models 集合 + 注册 mock Provider
const models = createModels();
models.set(createMockProvider());
console.log(`✅ 已注册 ${models.list().length} 个 Provider`);

// 3. 查找模型
const mockModel = models.getModel("mock", "mock-1");
console.log(`✅ 找到模型: ${mockModel?.name} (${mockModel?.provider}/${mockModel?.id})`);

// 4. 流式调用
console.log("\n📡 流式调用 mock Provider:\n");

const stream = models.stream(mockModel!, {
  messages: [{ role: "user", content: "Hello!", timestamp: Date.now() }],
});

for await (const event of stream) {
  if (event.type === "start") console.log("  [流开始]");
  else if (event.type === "done") {
    const text = event.message.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("");
    console.log(`  [完成] ${text}`);
  }
}

console.log("\n✅ Models 框架验证全部通过！");
