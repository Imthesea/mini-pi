/**
 * Example 02: Anthropic Provider 框架验证（mock，经用户批准）。
 * 因为暂无 ANTHROPIC_API_KEY，使用内联 mock Provider 验证流式框架。
 *
 * 运行：npx tsx examples/02-anthropic-mock.ts
 */

import { createModels } from "../src/provider/index.js";
import { AssistantMessageEventStream } from "../src/stream/index.js";
import { envApiKey } from "../src/auth/index.js";
import type { Provider, Models } from "../src/provider/index.js";
import type { Api, Model, Context, AssistantMessage } from "../src/types.js";

console.log("=== Example 02: Anthropic Provider 框架验证（mock） ===\n");

// 环境检查
const hasKey = envApiKey("ANTHROPIC_API_KEY");
console.log(`ANTHROPIC_API_KEY: ${hasKey ? "✅ 已设置" : "⚠️ 未设置（使用内联 mock）"}\n`);

// ── 内联 mock Provider（仅此 example 使用，业务代码中不存在） ──
const models_attr: Model<"anthropic-messages">[] = [{
  id: "claude-sonnet-4-20250514",
  name: "Claude Sonnet 4",
  api: "anthropic-messages",
  provider: "anthropic",
  baseUrl: "https://api.anthropic.com",
  reasoning: true,
  input: ["text", "image"],
  cost: { input: 3.0, output: 15.0 },
  contextWindow: 200000,
  maxTokens: 8192,
}];

function createMockAnthropicProvider(): Provider<"anthropic-messages"> {
  return {
    id: "anthropic",
    name: "Anthropic (mock)",
    baseUrl: "https://api.anthropic.com",
    getApiKey: () => hasKey ?? "mock-key",
    getModels: () => models_attr,
    getModel: (id: string) => models_attr.find((m) => m.id === id),

    stream(model: Model<"anthropic-messages">, context: Context) {
      const stream = new AssistantMessageEventStream();
      const mockText = `[Anthropic Mock] 收到 ${context.messages.length} 条消息。模型: ${model.name}。Anthropic 框架验证通过。`;

      const partial: AssistantMessage = {
        role: "assistant",
        content: [],
        api: "anthropic-messages",
        provider: "anthropic",
        model: model.id,
        usage: { input: 10, output: mockText.length, totalTokens: 10 + mockText.length, cost: { input: 0, output: 0, total: 0 } },
        stopReason: "stop",
        timestamp: Date.now(),
      };

      stream.push({ type: "start", partial: { ...partial } });
      // 模拟流式字符输出
      let i = 0;
      const timer = setInterval(() => {
        if (i < mockText.length) {
          stream.push({ type: "text_delta", contentIndex: 0, delta: mockText[i], partial: { ...partial } });
          i++;
        } else {
          clearInterval(timer);
          stream.push({ type: "text_end", contentIndex: 0, content: mockText, partial: { ...partial } });
          stream.push({ type: "done", reason: "stop", message: { ...partial, content: [{ type: "text", text: mockText }] } });
        }
      }, 5);
      return stream;
    },

    async complete(model, context, options) {
      return this.stream(model, context, options).result();
    },
  };
}

// 注册 + 查模型
const models = createModels();
models.set(createMockAnthropicProvider());
console.log(`✅ 已注册: ${models.list().map((p) => p.name).join(", ")}`);

const model = models.getModel("anthropic", "claude-sonnet-4-20250514")!;
console.log(`✅ 模型: ${model.name} | Context: ${model.contextWindow.toLocaleString()} tokens`);

// 流式调用
console.log("\n📡 流式调用:\n");
const stream = models.stream(model, {
  messages: [{ role: "user", content: "Hello!", timestamp: Date.now() }],
  systemPrompt: "用中文回答",
});

for await (const event of stream) {
  if (event.type === "text_delta") process.stdout.write(event.delta);
  else if (event.type === "done") console.log(`\n\n✅ 完成 | Tokens: ${event.message.usage.input} in / ${event.message.usage.output} out`);
  else if (event.type === "error") console.error(`\n❌ ${event.error.errorMessage}`);
}
