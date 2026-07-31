/**
 * Example 06: Prompt Templates 演示。
 *
 * 演示:
 * 1. 定义一个 code-review 模板(含 {{prUrl}} / {{branch}} / {{author}} 占位符)
 * 2. 调用 formatPromptTemplateInvocation(template, args) 替换占位符
 * 3. 启动 harness,把模板注入 resources
 * 4. 调用 harness.promptFromTemplate("code-review", args)
 * 5. 验证:LLM 收到的是替换后的 prompt
 *
 * 运行: cd packages/agent && npx tsx examples/06-prompt-templates.ts
 *
 * 真实 LLM 调用:需要设置 DEEPSEEK_API_KEY(代码自动从 packages/ai/.env 读取)
 */

import {
  AgentHarness,
  NodeExecutionEnv,
  InMemorySessionRepo,
  formatPromptTemplateInvocation,
  type AgentTool,
  type PromptTemplate,
  type Session,
} from "../src/index.js";
import {
  createModels,
  deepseekProvider,
  envApiKey,
  type Model,
} from "@mimi/ai";

// ── 1. PromptTemplate 定义 ──

const TPL_CODE_REVIEW: PromptTemplate = {
  name: "code-review",
  content: `请审查 PR {{prUrl}}。

## 分支信息
- 分支名:{{branch}}
- 作者:{{author}}
- 优先关注:安全、性能、可维护性

## 审查要求
1. 是否有明显的 bug(空指针、越界、资源泄漏)?
2. 测试是否充分覆盖了边界情况?
3. 命名 / 注释 / 类型签名是否清晰?
4. 是否有过度设计或欠设计?

## 输出格式
请按以下格式回复:
- 总体评价(1-2 句话)
- 必须修改的问题(以 - [MUST] 开头)
- 建议改进的问题(以 - [SHOULD] 开头)
- 亮点(以 - [NICE] 开头)
`,
};

// ── 2. 真实模型设置(DeepSeek) ──

function setupDeepSeekModel(): { model: Model<any>; models: ReturnType<typeof createModels> } {
  if (!envApiKey("DEEPSEEK_API_KEY")) {
    console.error("❌ 未设置 DEEPSEEK_API_KEY,请在 packages/ai/.env 中配置。");
    process.exit(1);
  }
  const models = createModels();
  models.set(deepseekProvider());
  const model = models.getModel("deepseek", "deepseek-v4-flash");
  if (!model) {
    console.error("❌ 找不到模型 deepseek/deepseek-v4-flash");
    process.exit(1);
  }
  console.log(`✅ DeepSeek 模型: ${model.name}\n`);
  return { model, models };
}

// ── 3. Tool(供演示用) ──

const noopTool: AgentTool = {
  name: "noop",
  label: "Noop",
  description: "无操作",
  parameters: { type: "object", properties: {} } as any,
  execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
};

// ── 4. Session ──

async function makeInMemorySession(): Promise<Session<any>> {
  // InMemorySessionRepo 内部自带 InMemorySessionStorage,不需要外部注入
  const repo = new InMemorySessionRepo();
  const session: Session<any> = await repo.create({ id: "tpl-demo" });
  return session;
}

// ── 主流程 ──

async function main() {
  console.log("=== Example 06: Prompt Templates 演示 ===\n");

  // 1. 演示 formatPromptTemplateInvocation
  console.log("--- 阶段 1:formatPromptTemplateInvocation 预览 ---\n");
  const args = {
    prUrl: "https://github.com/example/repo/pull/42",
    branch: "feat/user-auth",
    author: "alice",
  };
  const filled = formatPromptTemplateInvocation(TPL_CODE_REVIEW, args);
  console.log("  替换后(前 300 字符):");
  console.log(filled.slice(0, 300));
  console.log(`\n  ✓ 占位符已替换:${filled.includes("feat/user-auth") ? "成功" : "失败"}\n`);

  // 验证:原占位符已消失
  if (filled.includes("{{prUrl}}") || filled.includes("{{branch}}") || filled.includes("{{author}}")) {
    console.error("  ❌ 占位符未完全替换");
    process.exit(1);
  }

  // 2. 演示未提供的占位符保留原样
  console.log("--- 阶段 2:未提供的占位符保留原样 ---\n");
  const partial = formatPromptTemplateInvocation(TPL_CODE_REVIEW, { prUrl: "url" });
  console.log(`  {{branch}} 保留原样:${partial.includes("{{branch}}") ? "✓" : "❌"}`);
  console.log(`  {{author}} 保留原样:${partial.includes("{{author}}") ? "✓" : "❌"}\n`);

  // 3. 启动 harness + 注入 template
  console.log("--- 阶段 3:启动 harness + 注入 template ---\n");
  const { model, models } = setupDeepSeekModel();
  const session = await makeInMemorySession();
  const env = new NodeExecutionEnv({ cwd: process.cwd() });

  const harness = new AgentHarness({
    model,
    tools: [noopTool],
    env,
    session,
    resources: { promptTemplates: [TPL_CODE_REVIEW] },
    systemPrompt: "你是一个代码审查助手。",
    streamFn: models.stream.bind(models),
  });

  // 4. 调起 template
  console.log("--- 阶段 4:调起 harness.promptFromTemplate('code-review', args) ---\n");
  console.log("  ⏳ 调 LLM,LLM 会按 template 格式做 code review...");
  const messages = await harness.promptFromTemplate("code-review", {
    prUrl: "https://github.com/example/repo/pull/99",
    branch: "fix/login-bug",
    author: "bob",
  });
  console.log(`  ✓ prompt template 调起完成,产生 ${messages.length} 条消息\n`);

  // 5. 验证
  console.log("--- 阶段 5:验证 LLM 响应格式 ---\n");
  const assistants = messages.filter((m) => m.role === "assistant");
  const lastAssistant = assistants[assistants.length - 1];
  if (!lastAssistant) {
    console.error("  ❌ 没有 assistant 消息");
    process.exit(1);
  }
  const text = lastAssistant.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("");
  console.log(`  LLM 响应(前 400 字符):\n${text.slice(0, 400)}...\n`);

  // 验证:响应中包含 template 要求的 [MUST] / [SHOULD] / [NICE] 标签
  const tags = ["[MUST]", "[SHOULD]", "[NICE]"];
  const foundTags = tags.filter((t) => text.includes(t));
  console.log(`  找到的审查标签: ${foundTags.join(" ") || "(无)"}`);
  if (foundTags.length === 0) {
    console.error("  ❌ LLM 没有按 template 要求的格式输出");
    process.exit(1);
  }
  console.log(`  ✓ LLM 按 template 格式输出 (${foundTags.length}/${tags.length} 标签)`);

  console.log("\n✅ Prompt Templates 演示完成");
}

main().catch((e) => {
  console.error("ERR:", e);
  process.exit(1);
});
