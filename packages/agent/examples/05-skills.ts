/**
 * Example 05: Skills 演示。
 *
 * 演示:
 * 1. 写一个 SKILL.md(git-commit)
 * 2. 用 loadSkillFromFile(env, path) 加载 skill
 * 3. 把 skill 注入到 harness resources
 * 4. 调用 harness.skill("git-commit") 调起 skill
 * 5. 验证:LLM 收到的 user 消息包含 skill content
 *
 * 运行: cd packages/agent && npx tsx examples/05-skills.ts
 *
 * 真实 LLM 调用:需要设置 DEEPSEEK_API_KEY(代码自动从 packages/ai/.env 读取)
 */

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  AgentHarness,
  NodeExecutionEnv,
  InMemorySessionRepo,
  loadSkillFromFile,
  formatSkillInvocation,
  type AgentTool,
  type Session,
  type Skill,
} from "../src/index.js";
import {
  createModels,
  deepseekProvider,
  envApiKey,
  type Model,
} from "@mimi/ai";

// ── 1. 准备 SKILL.md(写到临时目录) ──

const TMP_DIR = join(tmpdir(), "mimi-skill-demo");
if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });

const SKILL_PATH = join(TMP_DIR, "SKILL.md");
const SKILL_CONTENT = `---
name: git-commit
description: 提交代码到 git,生成符合 conventional commits 的消息
---

# git-commit skill

你需要按照以下流程帮用户提交代码:

1. 运行 \`git status\` 查看变更
2. 运行 \`git diff --staged\` 看待提交内容
3. 根据变更类型生成 commit message:
   - feat: 新功能
   - fix: bug 修复
   - refactor: 重构
   - docs: 文档
   - test: 测试
4. 询问用户是否确认提交
5. 确认后运行 \`git commit -m "<message>"\`

注意:
- 绝不能 force push
- 绝不能跳过 pre-commit hook(--no-verify)
- commit message 用中文或英文皆可,跟随用户语言
`;

writeFileSync(SKILL_PATH, SKILL_CONTENT, "utf-8");
console.log(`📄 SKILL.md 已写到: ${SKILL_PATH}\n`);

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
  description: "无操作,仅返回 ok",
  parameters: { type: "object", properties: {} } as any,
  execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
};

// ── 4. Session setup(InMemory,简洁) ──

async function makeInMemorySession(): Promise<Session<any>> {
  // InMemorySessionRepo 内部自带 InMemorySessionStorage,不需要外部注入
  const repo = new InMemorySessionRepo();
  const session: Session<any> = await repo.create({ id: "skill-demo" });
  return session;
}

// ── 主流程 ──

async function main() {
  console.log("=== Example 05: Skills 演示 ===\n");

  // 1. 加载 skill
  console.log("--- 阶段 1:加载 SKILL.md ---\n");
  const env = new NodeExecutionEnv({ cwd: process.cwd() });
  const skill = await loadSkillFromFile(env, SKILL_PATH);
  console.log(`  ✓ 加载 skill: ${skill.name}`);
  console.log(`    description: ${skill.description}`);
  console.log(`    content 长度: ${skill.content.length} 字符\n`);

  // 2. 演示 formatSkillInvocation(无 args,返回 content)
  console.log("--- 阶段 2:formatSkillInvocation 预览 ---\n");
  const preview = formatSkillInvocation(skill);
  console.log(`  调起文本(前 200 字符):\n${preview.slice(0, 200)}...\n`);

  // 3. 启动 harness + 注入 skill
  console.log("--- 阶段 3:启动 harness + 注入 skill ---\n");
  const { model, models } = setupDeepSeekModel();
  const session = await makeInMemorySession();

  const harness = new AgentHarness({
    model,
    tools: [noopTool],
    env,
    session,
    resources: { skills: [skill] },
    systemPrompt: "你是一个有用的助手,会按 skill 指引完成任务。",
    streamFn: models.stream.bind(models),
  });

  // 4. 调起 skill
  console.log("--- 阶段 4:调起 harness.skill('git-commit') ---\n");
  console.log("  ⏳ 调 LLM,LLM 会按 skill content 指引执行...");
  const messages = await harness.skill("git-commit");
  console.log(`  ✓ skill 调起完成,产生 ${messages.length} 条消息\n`);

  // 5. 验证
  console.log("--- 阶段 5:验证 ---\n");
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
  console.log(`  LLM 最终回答(前 300 字符):\n${text.slice(0, 300)}...\n`);

  // 验证:assistant 消息里提到了 commit 流程
  if (!text.includes("commit") && !text.includes("提交") && !text.includes("git")) {
    console.error("  ❌ LLM 没有按 skill 指引提到 commit / git / 提交");
    process.exit(1);
  }
  console.log("  ✓ LLM 按 skill 指引响应");

  // 6. 清理
  console.log(`\n💡 临时文件保留在: ${TMP_DIR} (可手动删除)`);
  console.log("\n✅ Skills 演示完成");
}

main().catch((e) => {
  console.error("ERR:", e);
  process.exit(1);
});
