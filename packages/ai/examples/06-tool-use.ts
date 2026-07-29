/**
 * Example 06: 工具调用——定义 Tool，模型判断何时调用工具并返回正确参数。
 * 使用 DeepSeek 真实 API。
 *
 * 运行：npx tsx examples/06-tool-use.ts
 */

import { Type } from "typebox";
import { createModels } from "../src/provider/index.js";
import { deepseekProvider } from "../src/api/openai.js";
import { envApiKey } from "../src/auth/index.js";
import type { Tool } from "../src/types.js";

// ── 定义工具：获取天气 ──

const getWeatherTool = {
  name: "get_weather",
  description: "获取指定城市的当前天气信息",
  parameters: Type.Object({
    city: Type.String({ description: "城市名称，如 北京、上海" }),
    unit: Type.Optional(Type.String({ description: "温度单位：celsius 或 fahrenheit" })),
  }),
} satisfies Tool;

console.log("=== Example 06: 工具调用 ===\n");

// 检查环境变量
const key = envApiKey("DEEPSEEK_API_KEY");
if (!key) {
  console.error("❌ 未设置 DEEPSEEK_API_KEY");
  process.exit(1);
}

// 注册 Provider
const models = createModels();
models.set(deepseekProvider());

const model = models.getModel("deepseek", "deepseek-v4-flash");
if (!model) {
  console.error("❌ 找不到模型");
  process.exit(1);
}

console.log(`模型: ${model.name}`);
console.log(`工具: ${getWeatherTool.name}`);
console.log(`问题: 北京今天天气怎么样？\n`);

// 流式调用（带工具）
const stream = models.stream(
  model,
  {
    messages: [{ role: "user", content: "北京今天天气怎么样？", timestamp: Date.now() }],
    tools: [getWeatherTool],
  },
  {
    maxTokens: 500,
    onPayload: (payload) => {
      const p = payload as any;
      console.log(`[DEBUG] 工具数: ${p.tools?.length}`);
      return undefined;
    },
  },
);

let hasToolCall = false;

for await (const event of stream) {
  switch (event.type) {
    case "start":
      console.log("📡 流式响应:\n");
      break;
    case "text_delta":
      process.stdout.write(event.delta);
      break;
    case "toolcall_start":
      hasToolCall = true;
      console.log("🔧 模型决定调用工具:\n");
      break;
    case "toolcall_delta":
      // 流式工具参数
      break;
    case "toolcall_end":
      console.log(`   工具名: ${event.toolCall.name}`);
      console.log(`   参数: ${JSON.stringify(event.toolCall.arguments, null, 2)}`);
      break;
    case "done":
      if (hasToolCall) {
        console.log("\n✅ 模型正确识别了需要调用工具，并给出了正确参数");
      } else {
        console.log(`\n✅ 完成: ${event.message.content.map((c: any) => c.text ?? "").join("")}`);
      }
      console.log(`   Tokens: ${event.message.usage.input} in / ${event.message.usage.output} out`);
      console.log(`   费用: $${event.message.usage.cost.total.toFixed(6)}`);
      break;
    case "error":
      console.error(`\n❌ 错误: ${event.error.errorMessage}`);
      break;
  }
}
