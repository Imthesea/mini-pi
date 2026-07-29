/**
 * Example 04: OpenAI Provider 框架验证（mock，经用户批准）。
 * 因为 OPENAI_API_KEY 在国内需代理，使用内联 mock Provider 验证流式框架。
 *
 * 运行：npx tsx examples/04-openai-mock.ts
 */

import { createModels } from "../src/provider/index.js";
import { AssistantMessageEventStream } from "../src/stream/index.js";
import { envApiKey } from "../src/auth/index.js";
import type { Provider } from "../src/provider/index.js";
import type { Api, Model, Context, AssistantMessage } from "../src/types.js";

console.log("=== Example 04: OpenAI Provider 框架验证（mock） ===\n");

const hasKey = envApiKey("OPENAI_API_KEY");
console.log(`OPENAI_API_KEY: ${hasKey ? "✅ 已设置" : "⚠️ 未设置（使用内联 mock）"}\n`);

// ── 内联 mock Provider ──
const mockModels: Model<"openai-completions">[] = [{
  id: "gpt-5.5",
  name: "GPT-5.5",
  api: "openai-completions",
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  reasoning: true,
  input: ["text", "image"],
  cost: { input: 2.5, output: 10.0 },
  contextWindow: 128000,
  maxTokens: 16384,
}];

function createMockOpenAIProvider(): Provider<"openai-completions"> {
  return {
    id: "openai",
    name: "OpenAI (mock)",
    baseUrl: "https://api.openai.com/v1",
    getApiKey: () => hasKey ?? "mock-key",
    getModels: () => mockModels,
    getModel: (id: string) => mockModels.find((m) => m.id === id),

    stream(model: Model<"openai-completions">, context: Context) {
      const stream = new AssistantMessageEventStream();
      const mockText = `[OpenAI Mock] 收到 ${context.messages.length} 条消息。模型: ${model.name}。OpenAI 框架验证通过。`;

      const partial: AssistantMessage = {
        role: "assistant",
        content: [],
        api: "openai-completions",
        provider: "openai",
        model: model.id,
        usage: { input: 10, output: mockText.length, totalTokens: 10 + mockText.length, cost: { input: 0, output: 0, total: 0 } },
        stopReason: "stop",
        timestamp: Date.now(),
      };

      stream.push({ type: "start", partial: { ...partial } });
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
models.set(createMockOpenAIProvider());
console.log(`✅ 已注册: ${models.list().map((p) => p.name).join(", ")}`);

const found = models.getModel("openai", "gpt-5.5");
if (!found) {
  console.error("❌ 找不到模型 gpt-5.5");
  process.exit(1);
}
console.log(`✅ 模型: ${found.name} | Context: ${found.contextWindow.toLocaleString()} tokens`);

// 流式调用
console.log("\n📡 流式调用:\n");
const stream = models.stream(found, {
  messages: [{ role: "user", content: "Hello!", timestamp: Date.now() }],
});

for await (const event of stream) {
  if (event.type === "text_delta") process.stdout.write(event.delta);
  else if (event.type === "done") console.log(`\n\n✅ 完成 | Tokens: ${event.message.usage.input} in / ${event.message.usage.output} out`);
  else if (event.type === "error") console.error(`\n❌ ${event.error.errorMessage}`);
}
