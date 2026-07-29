/**
 * Example 03: DeepSeek 流式对话（真实 API 调用）。
 * 需要设置 DEEPSEEK_API_KEY 环境变量或 .env 文件。
 *
 * 运行：npx tsx examples/03-deepseek-chat.ts
 */

import { createModels } from "../src/provider/index.js";
import { deepseekProvider } from "../src/api/openai.js";
import { envApiKey } from "../src/auth/index.js";

console.log("=== Example 03: DeepSeek 流式对话 ===\n");

// 1. 检查环境变量
const deepseekKey = envApiKey("DEEPSEEK_API_KEY");
if (!deepseekKey) {
  console.error("❌ 未设置 DEEPSEEK_API_KEY，请在 packages/ai/.env 中配置。");
  process.exit(1);
}
console.log("✅ DEEPSEEK_API_KEY 已配置");

// 2. 注册 DeepSeek Provider
const models = createModels();
models.set(deepseekProvider());

// 3. 查找模型
const model = models.getModel("deepseek", "deepseek-v4-flash");
if (!model) {
  console.error("❌ 找不到模型 deepseek-v4-flash");
  process.exit(1);
}
console.log(`✅ 模型: ${model.name}`);
console.log(`   上下文: ${model.contextWindow.toLocaleString()} tokens`);
console.log(`   最大输出: ${model.maxTokens.toLocaleString()} tokens\n`);

// 4. 流式调用
console.log("用户: 用一句话介绍你自己\n");
console.log("📡 流式响应:\n");

const stream = models.stream(model, {
  messages: [{ role: "user", content: "用一句话介绍你自己", timestamp: Date.now() }],
  maxTokens: 200,
  onPayload: (payload) => {
    const p = payload as any;
    console.log(`[DEBUG] 请求模型: ${p.model}, 消息数: ${p.messages?.length}`);
    return undefined;
  },
  onResponse: () => {
    console.log("[DEBUG] 收到响应");
  },
});

process.stdout.write("  ");
let fullText = "";

for await (const event of stream) {
  switch (event.type) {
    case "start":
      break;
    case "text_delta":
      process.stdout.write(event.delta);
      fullText += event.delta;
      break;
    case "thinking_delta":
      process.stdout.write(`\n  [思考] ${event.delta.slice(0, 80)}...`);
      break;
    case "done":
      console.log("\n");
      console.log(`✅ 完成 (stopReason: ${event.message.stopReason})`);
      console.log(`   Tokens: ${event.message.usage.input} in / ${event.message.usage.output} out`);
      console.log(`   费用: $${event.message.usage.cost.total.toFixed(6)}`);
      break;
    case "error":
      console.error(`\n❌ 错误: ${event.error.errorMessage}`);
      break;
  }
}
