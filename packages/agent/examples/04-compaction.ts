/**
 * Example 04: 压缩 + 分支摘要演示。
 *
 * 演示:
 * 1. 用 `JsonlSessionRepo` 创建一个 JSONL 持久化 session
 * 2. 跑 4 轮对话(用真实 DeepSeek),让 session 累积多条 entries
 * 3. 调用 `harness.compact()` 手动触发压缩
 * 4. 验证:session.jsonl 出现 CompactionEntry,buildContext() 派生 LLM messages 时
 *    早于 firstKeptEntryId 的 entries 被压缩 summary 替换
 * 5. 调用 `harness.navigateTree({ targetId })` 跳回之前的 entry
 * 6. 验证:session.jsonl 出现 BranchSummaryEntry
 *
 * 运行: cd packages/agent && npx tsx examples/04-compaction.ts
 *
 * 真实 LLM 调用:需要设置 DEEPSEEK_API_KEY(代码自动从 packages/ai/.env 读取)
 *
 * 输出文件位置:
 * - 临时目录 `<TMP>/mimi-compaction-demo/<encoded-cwd>/<timestamp>_<id>.jsonl`
 * - 退出时不会自动清理(让用户能查看)
 * - 如需清理:运行 `npx tsx examples/04-compaction.ts --clean`
 */

import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import {
  AgentHarness,
  JsonlSessionRepo,
  NodeExecutionEnv,
  estimateTokens,
  type AgentMessage,
  type AgentTool,
  type ExecutionEnv,
  type FileError,
  type JsonlSessionMetadata,
  type Result,
  type Session,
  type SessionTreeEntry,
  type UserMessage,
} from "../src/index.js";
import {
  createModels,
  deepseekProvider,
  envApiKey,
  type Model,
} from "@mimi/ai";

// ── Adapter:ExecutionEnv → JsonlSessionRepoFileSystem ──
//
// (与 03-session.ts 同样的 adapter,因为 JSONL repo 有自己的 fs 接口)

function adaptExecutionEnvForJsonlRepo(env: ExecutionEnv): {
  cwd: string;
  absolutePath: (path: string) => Promise<Result<string, FileError>>;
  joinPath: (parts: string[]) => Promise<Result<string, FileError>>;
  readTextFile: (path: string) => Promise<Result<string, FileError>>;
  readTextLines: (
    path: string,
    options?: { maxLines?: number },
  ) => Promise<Result<string[], FileError>>;
  writeFile: (path: string, content: string) => Promise<Result<void, FileError>>;
  appendFile: (path: string, content: string) => Promise<Result<void, FileError>>;
  listDir: (
    path: string,
  ) => Promise<Result<Array<{ name: string; path: string; kind: string }>, FileError>>;
  exists: (path: string) => Promise<Result<boolean, FileError>>;
  createDir: (
    path: string,
    options?: { recursive?: boolean },
  ) => Promise<Result<void, FileError>>;
  remove: (
    path: string,
    options?: { recursive?: boolean; force?: boolean },
  ) => Promise<Result<void, FileError>>;
} {
  return {
    cwd: env.cwd,
    absolutePath: env.absolutePath.bind(env),
    joinPath: env.joinPath.bind(env),
    readTextFile: env.readFile.bind(env),
    readTextLines: async (path, options) => {
      const result = await env.readFile(path);
      if (!result.ok) return result;
      const lines = result.value.split("\n");
      if (options?.maxLines !== undefined) {
        return { ok: true, value: lines.slice(0, options.maxLines) };
      }
      return { ok: true, value: lines };
    },
    writeFile: env.writeFile.bind(env),
    appendFile: env.appendFile.bind(env),
    listDir: async (path) => {
      const result = await env.readdir(path);
      if (!result.ok) return result;
      return {
        ok: true,
        value: result.value.map((info) => ({
          name: info.name,
          path: info.path,
          kind: info.kind,
        })),
      };
    },
    exists: env.exists.bind(env),
    createDir: env.mkdir.bind(env),
    remove: env.remove.bind(env),
  };
}

// ── 真实模型设置(DeepSeek) ──

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
  console.log(
    `✅ DeepSeek 模型: ${model.name} (context: ${model.contextWindow.toLocaleString()} tokens)\n`,
  );
  return { model, models };
}

// ── 工具(供演示用) ──

const echoTool: AgentTool = {
  name: "echo",
  label: "Echo",
  description: "回显输入文本",
  parameters: Type.Object({
    text: Type.String({ description: "要回显的文本" }),
  }),
  execute: async (_id, params) => {
    return {
      content: [{ type: "text", text: `echo: ${(params as { text: string }).text}` }],
      details: { ok: true },
    };
  },
};

// ── 工具:打印 entries ──

function describeEntry(entry: SessionTreeEntry): string {
  switch (entry.type) {
    case "message": {
      const m = entry.message;
      if (m.role === "user") {
        const text =
          typeof m.content === "string"
            ? m.content
            : Array.isArray(m.content) && m.content[0]?.type === "text"
              ? m.content[0].text
              : "[complex]";
        return `message(user): ${text.slice(0, 50)}${text.length > 50 ? "..." : ""}`;
      }
      if (m.role === "assistant") {
        const summary = m.content
          .map((c) =>
            c.type === "text"
              ? `text("${c.text.slice(0, 30)}${c.text.length > 30 ? "..." : ""}")`
              : c.type === "toolCall"
                ? `toolCall(${c.name})`
                : `[${c.type}]`,
          )
          .join(", ");
        return `message(assistant): ${summary}`;
      }
      if (m.role === "toolResult") {
        return `message(toolResult): ${m.toolName}`;
      }
      // 其他 role (custom / customMessage) — 用 (m as { role: string }).role 防止 narrow
      return `message(${(m as { role: string }).role})`;
    }
    case "compaction":
      return `compaction: firstKeptEntryId=${entry.firstKeptEntryId.slice(0, 8)}, tokensBefore=${entry.tokensBefore}, summary="${entry.summary.slice(0, 40)}${entry.summary.length > 40 ? "..." : ""}"`;
    case "branch_summary":
      return `branch_summary: fromId=${entry.fromId.slice(0, 8)}, summary="${entry.summary.slice(0, 40)}${entry.summary.length > 40 ? "..." : ""}"`;
    case "leaf":
      return `leaf: targetId=${entry.targetId?.slice(0, 8) ?? "null"}`;
    case "label":
      return `label: ${entry.label}`;
    default:
      return `${entry.type}`;
  }
}

// ── 主流程 ──

async function main() {
  console.log("=== Example 04: 压缩 + 分支摘要演示 ===\n");

  // ── 阶段 0:准备工作 ──
  const shouldClean = process.argv.includes("--clean");
  const tmpRoot = mkdtempSync(join(tmpdir(), "mimi-compaction-demo-"));
  const cwd = process.cwd();
  console.log(`📁 临时根目录: ${tmpRoot}`);
  console.log(`📂 session cwd:  ${cwd}\n`);

  if (shouldClean) {
    for (const dir of ["mimi-sessions", ".mimi-sessions"]) {
      const path = join(process.cwd(), dir);
      if (existsSync(path)) {
        rmSync(path, { recursive: true, force: true });
        console.log(`🧹 清理: ${path}`);
      }
    }
  }

  const { model: deepseekModel, models: deepseekModels } = setupDeepSeekModel();

  const env = new NodeExecutionEnv({ cwd });
  const fsAdapter = adaptExecutionEnvForJsonlRepo(env);
  const repo = new JsonlSessionRepo({
    fs: fsAdapter as any,
    sessionsRoot: tmpRoot,
  });

  // ── 阶段 1:创建 session + 4 轮对话 ──
  console.log("--- 阶段 1:创建 session + 4 轮对话 ---\n");
  const session = await repo.create({ cwd });
  const metadata = await session.getMetadata();
  console.log(`  ✓ 创建 session`);
  console.log(`    id:        ${metadata.id}`);
  console.log(`    file path: ${metadata.path}\n`);

  // 准备 harness
  const harness = new AgentHarness({
    model: deepseekModel,
    tools: [echoTool],
    env,
    session,
    streamFn: (model, context, options) =>
      deepseekModels.stream(model, context as any, options),
  });

  // 订阅事件(可选,静默消费)
  const unsubscribe = harness.subscribe(() => {});

  // 4 轮对话
  const turns: UserMessage[] = [
    { role: "user", content: "你好,我叫 Alice,我喜欢读科幻小说。", timestamp: 0 },
    { role: "user", content: "我最近在读《三体》,讲的是地球文明与三体文明的接触。", timestamp: 1 },
    { role: "user", content: "你能用一句话总结一下这本书的核心主题吗?", timestamp: 2 },
    { role: "user", content: "如果我想写一篇读后感,你会建议我从哪些角度切入?", timestamp: 3 },
  ];

  for (let i = 0; i < turns.length; i++) {
    const t = turns[i]!;
    // t.content 是 string | (TextContent | ImageContent)[] — prompt 只接受 string
    const text =
      typeof t.content === "string"
        ? t.content
        : t.content
            .filter((c): c is { type: "text"; text: string } => c.type === "text")
            .map((c) => c.text)
            .join("");
    console.log(`  ✓ 第 ${i + 1} 轮: ${text.slice(0, 40)}...`);
    await harness.prompt(text);
  }
  console.log();

  // ── 阶段 2:列出 entries(压缩前) ──
  console.log("--- 阶段 2:列出 entries(压缩前) ---\n");
  const entriesBefore = await session.getEntries();
  entriesBefore.forEach((entry, i) => {
    console.log(`  [${i.toString().padStart(2)}] ${describeEntry(entry)}`);
  });
  console.log(`  共 ${entriesBefore.length} 条 entries\n`);

  // 计算 token 估算
  const ctxBefore = await session.buildContext();
  const tokensBefore = estimateTokens(ctxBefore.messages);
  console.log(`  📊 派生 LLM context 估算 token: ${tokensBefore}\n`);

  // ── 阶段 3:手动触发压缩 ──
  console.log("--- 阶段 3:手动触发 harness.compact() ---\n");
  console.log("  ⏳ 调 LLM 生成 summary...");
  const summary = await harness.compact();
  console.log(`  ✓ 压缩完成`);
  console.log(`    summary(前 200 字符): ${summary?.slice(0, 200) ?? "(empty)"}\n`);

  // ── 阶段 4:列出 entries(压缩后) ──
  console.log("--- 阶段 4:列出 entries(压缩后) ---\n");
  const entriesAfter = await session.getEntries();
  entriesAfter.forEach((entry, i) => {
    console.log(`  [${i.toString().padStart(2)}] ${describeEntry(entry)}`);
  });
  console.log(`  共 ${entriesAfter.length} 条 entries(之前 ${entriesBefore.length})\n`);

  // 验证 CompactionEntry 出现
  const compactionEntry = entriesAfter.find((e) => e.type === "compaction");
  if (!compactionEntry) {
    console.error("  ❌ 未找到 CompactionEntry!");
    process.exit(1);
  }
  console.log(`  ✅ CompactionEntry 已写入`);
  console.log(`    firstKeptEntryId: ${compactionEntry.firstKeptEntryId.slice(0, 8)}`);
  console.log(`    tokensBefore:     ${compactionEntry.tokensBefore}\n`);

  // ── 阶段 5:reopen + 验证 buildContext 派生 ──
  console.log("--- 阶段 5:reopen + 验证 buildContext 派生 ---\n");
  const reopened: Session<JsonlSessionMetadata> = await repo.open(metadata);
  const ctxAfter = await reopened.buildContext();
  const tokensAfter = estimateTokens(ctxAfter.messages);
  console.log(`  📊 压缩后 LLM context 估算 token: ${tokensAfter}`);
  console.log(`  📊 压缩前: ${tokensBefore} → 压缩后: ${tokensAfter}`);
  if (tokensAfter >= tokensBefore) {
    console.log(`  ⚠️  压缩后 token 未减少(可能 keepRecentTokens 设得太大)\n`);
  } else {
    console.log(`  ✅ 压缩生效,token 减少 ${tokensBefore - tokensAfter}\n`);
  }

  // ── 阶段 6:navigateTree 跳回之前的 entry ──
  console.log("--- 阶段 6:手动触发 harness.navigateTree ---\n");
  // 找到第 1 条 user message 作为 target
  const firstUserEntry = entriesAfter.find(
    (e) => e.type === "message" && e.message.role === "user",
  );
  if (!firstUserEntry) {
    console.error("  ❌ 找不到 user message entry");
    process.exit(1);
  }
  console.log(`  🎯 跳回 entry: ${firstUserEntry.id.slice(0, 8)} (第 1 条 user 消息)`);
  console.log("  ⏳ 调 LLM 生成 branch summary...");
  const branchId = await harness.navigateTree({ targetId: firstUserEntry.id });
  console.log(`  ✓ navigateTree 完成`);
  console.log(`    branchEntryId: ${branchId?.slice(0, 8) ?? "(none)"}\n`);

  // 列出最终 entries
  const entriesFinal = await session.getEntries();
  const branchEntry = entriesFinal.find((e) => e.type === "branch_summary");
  if (branchEntry) {
    console.log(`  ✅ BranchSummaryEntry 已写入`);
    console.log(`    summary(前 100 字符): ${branchEntry.summary.slice(0, 100)}...\n`);
  }

  // 关闭订阅
  unsubscribe();

  console.log("--- 演示结束 ---\n");
  console.log(`📁 Session 文件位置: ${metadata.path}`);
  console.log(`   可用 \`cat "${metadata.path}"\` 查看内容\n`);
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
