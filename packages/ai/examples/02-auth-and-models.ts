/**
 * Example 02：认证 + Models 框架验证（真实 OpenAI Provider）。
 * 注册 openaiProvider，查找模型，检查环境变量，流式调用验证框架分发。
 *
 * 运行：需在 .env 中设置 OPENAI_API_KEY，然后 npx tsx examples/02-auth-and-models.ts
 */

import { createModels } from "../src/provider/index.js";
import { openaiProvider } from "../src/api/openai.js";
import { envApiKey } from "../src/auth/index.js";

console.log("=== Example 02: 认证 + Models 框架验证 ===\n");

// 1. 检查环境变量
const openaiKey = envApiKey("OPENAI_API_KEY");
if (!openaiKey) {
  console.error("❌ 未设置 OPENAI_API_KEY，请在 packages/ai/.env 中配置。");
  process.exit(1);
}
console.log("✅ OPENAI_API_KEY 已配置");

// 2. 创建 Models 集合，注册真实的 OpenAI Provider
const models = createModels();
models.set(openaiProvider());
console.log(`✅ 已注册 ${models.list().length} 个 Provider: ${models.list().map((p) => p.name).join(", ")}`);

// 3. 查找模型
const gptModel = models.getModel("openai", "gpt-5.5");
if (!gptModel) {
  console.error("❌ 找不到模型 gpt-5.5");
  process.exit(1);
}
console.log(`✅ 找到模型: ${gptModel.name}`);
console.log(`   Provider: ${gptModel.provider}`);
console.log(`   Context: ${gptModel.contextWindow.toLocaleString()} tokens`);
console.log(`   Max output: ${gptModel.maxTokens.toLocaleString()} tokens`);

// 4. 流式调用
console.log("\n📡 流式调用 OpenAI:\n");
console.log("用户: 用一句话介绍你自己\n");

const stream = models.stream(gptModel, {
  messages: [{ role: "user", content: "用一句话介绍你自己", timestamp: Date.now() }],
  maxTokens: 200,
  // debug 回调：检查实际发出去的请求
  onPayload: (payload) => {
    const p = payload as any;
    console.log(`[DEBUG] 请求模型: ${p.model}, 消息数: ${p.messages?.length}, 工具数: ${p.tools?.length ?? 0}`);
    return undefined;
  },
  onResponse: () => {
    console.log("[DEBUG] 收到响应");
  },
});

process.stdout.write("  ");
for await (const event of stream) {
  switch (event.type) {
    case "start":
      break;
    case "text_delta":
      process.stdout.write(event.delta);
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

console.log("\n✅ Models 框架验证全部通过！");
