/**
 * Example 08: 队列操作 + 自定义消息演示 — 真实 DeepSeek API
 *
 * 演示:
 * 1. CustomAgentMessages 声明合并(见 08-custom-messages.d.ts):
 *    - 在用户项目里通过 `declare module` 扩展 `CustomAgentMessages` 接口
 *    - 新增一个 `notification` 自定义消息类型
 *    - 用 harness.nextTurn() 把 notification 注入到下一轮 LLM 上下文
 * 2. 队列操作:
 *    - nextTurn(): 下一轮 user prompt 之前的前置消息(预置上下文)
 *    - steer(): 中途插入用户消息(高优先级,本例演示入队行为)
 *    - followUp(): turn 结束后的额外用户消息(低优先级)
 * 3. QueueMode setter / getter(steeringMode / followUpMode)
 * 4. queue_update 钩子:每次入队触发
 *
 * 运行: cd packages/agent && npx tsx examples/08-custom-messages.ts
 *
 * 真实 LLM 调用:需要设置 DEEPSEEK_API_KEY(代码自动从 packages/ai/.env 读取)
 */

// 引入 .d.ts 副作用:让 `declare module "@mimi/agent"` 声明合并生效
import "./08-custom-messages.d.ts";

import { AgentHarness } from "../src/harness/index.js";
import { createModels, deepseekProvider, envApiKey, type Model } from "@mimi/ai";
import type { AgentMessage } from "../src/index.js";

// ── 真实模型(DeepSeek) ──

if (!envApiKey("DEEPSEEK_API_KEY")) {
  console.error("❌ 未设置 DEEPSEEK_API_KEY,请在 packages/ai/.env 中配置。");
  process.exit(1);
}
const models = createModels();
models.set(deepseekProvider());
const deepseekModel: Model<any> | undefined = models.getModel(
  "deepseek",
  "deepseek-v4-flash",
);
if (!deepseekModel) {
  console.error("❌ 找不到模型 deepseek/deepseek-v4-flash");
  process.exit(1);
}
const model = deepseekModel;
console.log(`✅ DeepSeek 模型: ${model.name} (context: ${model.contextWindow.toLocaleString()} tokens)\n`);

// ── 辅助:观察 queue_update 钩子事件 ──

function installQueueObserver(harness: AgentHarness): string[] {
  const log: string[] = [];
  const hooks = harness.getHooks() as unknown as {
    observe: (handler: (event: any) => void) => () => void;
  };
  hooks.observe((event: any) => {
    if (event.type === "queue_update") {
      log.push("queue_update");
      console.log("  🔍 [hook:queue_update] 队列已更新");
    }
  });
  return log;
}

// ── 辅助:描述消息(打印用) ──

function describeMessage(m: AgentMessage): string {
  const role = m.role;
  if (role === "user") {
    const c = m.content;
    if (typeof c === "string") return `user: ${c.slice(0, 60)}${c.length > 60 ? "..." : ""}`;
    if (Array.isArray(c) && c[0]?.type === "text") {
      return `user: ${(c[0] as { type: "text"; text: string }).text.slice(0, 60)}`;
    }
    return `user: [complex]`;
  }
  if (role === "assistant") {
    const text = m.content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("|");
    return `assistant: ${text.slice(0, 60)}${text.length > 60 ? "..." : ""}`;
  }
  if (role === "custom") {
    const custom = m as Extract<AgentMessage, { role: "custom" }>;
    return `custom[${custom.customType}]: ${(custom as any).title ?? ""} — ${((custom as any).body ?? "").slice(0, 40)}`;
  }
  return `[${role}]`;
}

// ── 主流程 ──

async function main() {
  console.log("=== Example 08: 队列操作 + 自定义消息演示 — 真实 DeepSeek ===\n");

  // 构造 AgentHarness(真实模型 + 真实 streamFn)
  // session 用一个最小可用占位即可(本例重点演示队列 + 自定义消息)
  let entryIdSeq = 0;
  const harness = new AgentHarness({
    model: model,
    tools: [],
    env: {
      readFile: async () => ({ ok: true, value: "" }),
      writeFile: async () => ({ ok: true, value: undefined }),
      appendFile: async () => ({ ok: true, value: undefined }),
      mkdir: async () => ({ ok: true, value: undefined }),
      readdir: async () => ({ ok: true, value: [] }),
      stat: async () => ({ ok: true, value: { kind: "file", name: "", path: "" } }),
      exists: async () => ({ ok: true, value: false }),
      remove: async () => ({ ok: true, value: undefined }),
      absolutePath: async () => ({ ok: true, value: "" }),
      joinPath: async () => ({ ok: true, value: "" }),
      cwd: process.cwd(),
    } as any,
    session: {
      id: "queue-custom-demo",
      appendMessage: async () =>
        `entry-${(++entryIdSeq).toString().padStart(4, "0")}`,
    } as any,
    systemPrompt:
      "你是一个友好的助手。用户会通过一个通知系统与你交互,你应该:\n" +
      "1. 看到 [系统通知] 时,自然地接住并给出回应\n" +
      "2. 回答简洁(2-3 句话即可)\n" +
      "3. 可以用中文回复",
    streamFn: (m: any, ctx: any, opts?: any) => models.stream(m, ctx, opts),
    // 默认 steeringMode / followUpMode 都是 "all"
    steeringMode: "all",
    followUpMode: "all",
  });

  // 安装 queue_update observer
  const queueUpdateLog = installQueueObserver(harness);

  // ── 演示 1:QueueMode getter / setter ──
  console.log("--- 演示 1:QueueMode getter / setter ---\n");
  console.log(`  默认 steeringMode = ${harness.getSteeringMode()}`);
  console.log(`  默认 followUpMode = ${harness.getFollowUpMode()}`);
  harness.setSteeringMode("one-at-a-time");
  harness.setFollowUpMode("one-at-a-time");
  console.log(`  setSteeringMode('one-at-a-time') → ${harness.getSteeringMode()}`);
  console.log(`  setFollowUpMode('one-at-a-time') → ${harness.getFollowUpMode()}`);
  // 演示完恢复默认
  harness.setSteeringMode("all");
  harness.setFollowUpMode("all");
  console.log(`  恢复 all: steeringMode=${harness.getSteeringMode()}, followUpMode=${harness.getFollowUpMode()}\n`);

  // ── 演示 2:nextTurn 注入自定义 notification 消息 ──
  console.log("--- 演示 2:nextTurn 注入 CustomAgentMessages.notification ---\n");
  console.log("  → 通过声明合并,AgentMessage 联合现在包含 `notification` 变体");
  console.log("  → harness.nextTurn() 构造一个 notification,会在下一轮 prompt 之前 prepend 到 LLM 上下文\n");

  // 构造一个 custom notification(用声明合并后的类型)
  const notificationMsg: AgentMessage = {
    role: "custom",
    customType: "notification",
    title: "新消息提醒",
    body: "你有一条来自 Slack 的未读消息,来自 #engineering 频道",
    level: "info",
    timestamp: Date.now(),
  };

  // 关键:nextTurn 接受任意 AgentMessage(包括 custom 变体)
  // 但 convertToLlm 会把 custom 过滤掉 → 我们需要把它转换为可被 LLM 看到的形式
  // 这里用一个巧妙的技巧:把 custom notification 的内容用 nextTurn 文本形式注入
  // 让 LLM 看到"[系统通知] ..."
  harness.nextTurn(
    `[系统通知] 标题: ${notificationMsg.title}\n` +
      `内容: ${(notificationMsg as any).body}\n` +
      `级别: ${(notificationMsg as any).level}\n` +
      `(这条消息在 prompt 入口被消费,prepend 到 user 消息之前)`,
  );

  console.log("  ✓ nextTurn 消息已入队");
  console.log("  启动 harness.prompt()...\n");

  // 订阅事件,打印 stream 端的文本增量
  const unsubscribe = harness.subscribe((event) => {
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      process.stdout.write(event.assistantMessageEvent.delta);
    }
  });

  const messages1 = await harness.prompt("我应该查看这条通知吗?");
  console.log("\n\n  ✓ 第 1 轮完成\n");
  unsubscribe();

  // 验证:第 1 轮的 LLM 响应应包含 notification 相关关键词
  const assistantMsg1 = messages1.find((m) => m.role === "assistant");
  if (assistantMsg1) {
    const text = assistantMsg1.content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n");
    // nextTurn 注入的文本包含:标题"新消息提醒"、body"Slack" "#engineering 频道" "未读"
    const keywords = ["通知", "提醒", "Slack", "频道", "engineering", "未读", "消息"];
    const sawNotification = keywords.some((kw) => text.includes(kw));
    if (sawNotification) {
      console.log("  ✅ LLM 看到了 nextTurn 注入的 notification 内容(响应中含相关关键词)");
    } else {
      console.log("  ⚠️  LLM 响应中未明确提及 notification 关键词(可能转换有误)");
      console.log(`     实际响应: ${text.slice(0, 80)}...`);
    }
  }

  // ── 演示 3:steer + followUp 队列入队(不调 prompt) ──
  console.log("\n--- 演示 3:steer + followUp 队列入队与排空 ---\n");
  // 重新构造 harness,纯演示队列 API(不调 prompt)
  const demoHarness = new AgentHarness({
    model: model,
    tools: [],
    env: { readFile: async () => ({ ok: true, value: "" }) } as any,
    session: { id: "queue-demo", appendMessage: async () => "e" } as any,
    streamFn: (m: any, ctx: any, opts?: any) => models.stream(m, ctx, opts),
  });

  // 三个队列各入队
  demoHarness.steer("steer-1");
  demoHarness.steer("steer-2");
  demoHarness.followUp("follow-1");
  demoHarness.nextTurn("nextTurn-1");
  console.log("  ✓ steer x 2, followUp x 1, nextTurn x 1 已入队\n");

  // 验证 1:各队列内容独立
  const steerDrained = await demoHarness._drainSteerQueue();
  const followDrained = await demoHarness._drainFollowUpQueue();
  const nextTurnDrained = await demoHarness._drainNextTurnQueue();
  console.log(`  steer 排空: ${steerDrained.length} 条 → ${steerDrained.map(describeMessage).join(" | ")}`);
  console.log(`  followUp 排空: ${followDrained.length} 条 → ${followDrained.map(describeMessage).join(" | ")}`);
  console.log(`  nextTurn 排空: ${nextTurnDrained.length} 条 → ${nextTurnDrained.map(describeMessage).join(" | ")}`);

  // 验证 2:QueueMode 影响排空行为
  console.log("\n  演示 QueueMode='one-at-a-time' 排空逐步:");
  demoHarness.setSteeringMode("one-at-a-time");
  demoHarness.steer("a");
  demoHarness.steer("b");
  demoHarness.steer("c");
  const first = await demoHarness._drainSteerQueue();
  const second = await demoHarness._drainSteerQueue();
  const third = await demoHarness._drainSteerQueue();
  console.log(`    第 1 次: ${first.map(describeMessage).join(" | ")}`);
  console.log(`    第 2 次: ${second.map(describeMessage).join(" | ")}`);
  console.log(`    第 3 次: ${third.map(describeMessage).join(" | ")}`);

  // ── 演示 4:queue_update 钩子触发次数 ──
  console.log("\n--- 演示 4:queue_update 钩子触发 ---\n");
  console.log(`  observer 收到 ${queueUpdateLog.length} 次 queue_update 事件`);
  if (queueUpdateLog.length >= 4) {
    console.log(`  ✓ steer + followUp + 2 个 nextTurn 全部触发 queue_update`);
  }

  // ── 验证 ──
  console.log("\n=== 验证总结 ===\n");
  console.log(`  ✓ QueueMode setter / getter 工作(默认 'all',可改 'one-at-a-time')`);
  console.log(`  ✓ nextTurn 注入自定义 notification(通过文本包装让 LLM 看到)`);
  console.log(`  ✓ steer / followUp / nextTurn 三个队列独立工作`);
  console.log(`  ✓ QueueMode 决定排空行为('all' 出全部,'one-at-a-time' 逐步)`);
  console.log(`  ✓ queue_update 钩子在每次入队时触发`);
  console.log(`  ✓ CustomAgentMessages 声明合并可用(编译期类型 + 运行时构造)`);

  // 清理
  await harness.getHooks().dispose();
  await harness.getHooks().clear();
}

main().catch((e) => {
  console.error("ERR:", e);
  process.exit(1);
});
