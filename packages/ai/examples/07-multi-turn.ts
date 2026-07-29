/**
 * Example 07: 多轮对话 + 工具结果。
 * 完整流程：用户提问 → 模型决定调用工具 → 返回工具结果 → 模型给出最终答案。
 * 使用 DeepSeek 真实 API。
 *
 * 运行：npx tsx examples/07-multi-turn.ts
 */

import { Type } from "typebox";
import { createModels } from "../src/provider/index.js";
import { deepseekProvider } from "../src/api/openai.js";
import { envApiKey } from "../src/auth/index.js";
import type { Tool, Message, AssistantMessage } from "../src/types.js";

// ── 定义工具 ──

const getWeatherTool = {
  name: "get_weather",
  description: "获取指定城市的当前天气信息",
  parameters: Type.Object({
    city: Type.String({ description: "城市名称" }),
  }),
} satisfies Tool;

// ── 模拟天气数据 ──

function mockWeatherAPI(city: string): string {
  const weatherData: Record<string, string> = {
    "北京": "晴，25°C，湿度 45%，北风 3 级",
    "上海": "多云，28°C，湿度 65%，东南风 2 级",
    "深圳": "阵雨，30°C，湿度 80%，南风 4 级",
  };
  return weatherData[city] ?? `${city}：暂无数据`;
}

console.log("=== Example 07: 多轮对话 ===\n");

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
console.log(`场景: 查询北京天气\n`);

// ── 第一轮：用户提问 ──
const messages: Message[] = [
  { role: "user", content: "帮我查一下北京今天天气怎么样", timestamp: Date.now() },
];

console.log("👤 用户: 帮我查一下北京今天天气怎么样\n");

const round1 = models.stream(model, {
  messages,
  tools: [getWeatherTool],
  maxTokens: 500,
});

let toolToCall: { name: string; arguments: Record<string, any> } | null = null;
// 保存第一轮完整返回——DeepSeek 要求后续轮次传回 thinking 内容
let round1AssistantMsg: AssistantMessage | null = null;

console.log("📡 第一轮（模型决定是否调用工具）:\n");

for await (const event of round1) {
  switch (event.type) {
    case "toolcall_start":
      console.log("  🔧 模型决定调用工具");
      break;
    case "toolcall_end":
      toolToCall = {
        name: event.toolCall.name,
        arguments: event.toolCall.arguments,
      };
      console.log(`     工具: ${event.toolCall.name}(${JSON.stringify(event.toolCall.arguments)})`);
      break;
    case "text_delta":
      process.stdout.write(`  模型输出: ${event.delta}`);
      break;
    case "done":
      round1AssistantMsg = event.message;
      if (!toolToCall) {
        console.log("  模型直接回复，无需工具调用");
      }
      break;
    case "error":
      console.error(`  ❌ 错误: ${event.error.errorMessage}`);
      process.exit(1);
  }
}

if (!toolToCall || !round1AssistantMsg) {
  console.log("\n⚠️ 模型未调用工具，跳过第二轮。");
  process.exit(0);
}

// ── 模拟工具执行 ──
const weatherResult = mockWeatherAPI(toolToCall.arguments.city as string);
console.log(`\n⚙️  工具执行结果: ${weatherResult}`);

// 使用第一轮的完整 assistant 消息（含 thinking 和 toolCall）
messages.push(round1AssistantMsg);
messages.push({
  role: "toolResult",
  toolCallId: toolToCall.name === "get_weather" ? (round1AssistantMsg.content.find((c) => c.type === "toolCall") as any)?.id ?? "call_1" : "call_1",
  toolName: toolToCall.name,
  content: [{ type: "text", text: weatherResult }],
  isError: false,
  timestamp: Date.now(),
});

// ── 第二轮：基于工具结果生成最终回答 ──
console.log("\n📡 第二轮（基于工具结果生成最终回答）:\n");

const round2 = models.stream(model, {
  messages,
  maxTokens: 500,
});

for await (const event of round2) {
  switch (event.type) {
    case "start":
      break;
    case "text_delta":
      process.stdout.write(event.delta);
      break;
    case "done":
      console.log("\n");
      console.log(`✅ 完成`);
      console.log(`   总 Tokens: ${event.message.usage.input} in / ${event.message.usage.output} out`);
      console.log(`   费用: $${event.message.usage.cost.total.toFixed(6)}`);
      break;
    case "error":
      console.error(`\n❌ 错误: ${event.error.errorMessage}`);
      break;
  }
}

console.log("\n✅ 多轮对话流程验证通过！");
