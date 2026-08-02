/**
 * Example 03: Session 双后端(JSONL 持久化 + 内存)演示
 *
 * 演示:
 * 1. 用 `JsonlSessionRepo` 创建一个 JSONL 持久化 session
 * 2. 跑 2 轮对话:append user / assistant / toolResult 消息
 * 3. 走一次分支跳转:`moveTo` 回到第 1 轮 + BranchSummaryEntry
 * 4. 列出所有 entries
 * 5. 关闭(release reference),再 `open` 同 metadata,验证 entries 还在
 * 6. 输出 session 文件路径,用户可用 `cat` 查看
 * 7. 顺便演示 `InMemorySessionRepo` 的同流程(快速验证 fork)
 * 8. 附:把 session 接到 AgentHarness + 真实 DeepSeek,跑一次 prompt
 *    让 user / assistant 消息自动 append 到 JSONL 文件
 *
 * 运行: cd packages/agent && npx tsx examples/03-session.ts
 *
 * 真实 LLM 调用:需要设置 DEEPSEEK_API_KEY(代码自动从 packages/ai/.env 读取)
 *
 * 输出文件位置:
 * - 临时目录 `<TMP>/mimi-session-demo/<encoded-cwd>/<timestamp>_<id>.jsonl`
 * - 退出时不会自动清理(让用户能查看)
 * - 如需清理:运行 `npx tsx examples/03-session.ts --clean`
 */

import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import {
  AgentHarness,
  InMemorySessionRepo,
  JsonlSessionRepo,
  NodeExecutionEnv,
  type AgentMessage,
  type AgentTool,
  type AssistantMessage,
  type FileError,
  type JsonlSessionMetadata,
  type Result,
  type Session,
  type SessionTreeEntry,
  type UserMessage,
} from "../src/index.js";
import type { ExecutionEnv } from "../src/index.js";
import {
  createModels,
  deepseekProvider,
  envApiKey,
  type Model,
} from "@mimi/ai";

// ── 工厂:构造符合 @mimi/ai 契约的 AgentMessage ──

/** 构造 user message */
function userMsg(text: string): UserMessage {
  return { role: "user", content: text, timestamp: Date.now() };
}

/**
 * 构造 assistant message,带全部 @mimi/ai AssistantMessage 必填字段
 * (api / provider / model / usage / stopReason)。
 * 本例用真实 DeepSeek 返回的字段值占位(因为我们手动写入 session,
 * 不通过 LLM 调用,字段值是占位但符合 schema)。
 */
function assistantMsg(
  content: AssistantMessage["content"],
  model: Model<any>,
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 1,
      output: 1,
      totalTokens: 2,
      cost: { input: 0, output: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

/** 构造 tool result message */
function toolResultMsg(
  toolCallId: string,
  toolName: string,
  text: string,
  isError = false,
): AgentMessage {
  return {
    role: "toolResult",
    toolCallId,
    toolName,
    content: [{ type: "text", text }],
    isError,
    timestamp: Date.now(),
  };
}

// ── Adapter:ExecutionEnv → JsonlSessionRepoFileSystem ──

/**
 * 把 `ExecutionEnv` 适配到 `JsonlSessionRepoFileSystem`。
 *
 * 区别:
 * - ExecutionEnv 暴露通用 `readFile` / `readdir` / `mkdir`(返回完整 FileInfo)
 * - JsonlSessionRepoFileSystem 暴露 JSONL 后端私有的 `readTextFile` / `listDir` / `createDir`
 *   (返回简化的 `{name, path, kind}` 元组)
 *
 * 为什么不直接用 ExecutionEnv:
 * - JSONL repo 是"持久化层",有自己细化的 fs 需求(读文件/读行/列目录)
 * - ExecutionEnv 是"agent 通用执行层",暴露更宽但也更大
 * - 两者职责不同,中间靠 adapter 桥接
 */
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
    // readTextLines 用 readFile + split 实现
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
    // listDir 走 readdir,转成简化元组
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

/** 准备真实 DeepSeek 模型(从 .env 读 DEEPSEEK_API_KEY) */
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
  console.log(`✅ DeepSeek 模型: ${model.name} (context: ${model.contextWindow.toLocaleString()} tokens)\n`);
  return { model, models };
}

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
        return `message(user): ${text.slice(0, 60)}${text.length > 60 ? "..." : ""}`;
      }
      if (m.role === "assistant") {
        const summary = m.content
          .map((c) =>
            c.type === "text"
              ? `text("${c.text.slice(0, 40)}${c.text.length > 40 ? "..." : ""}")`
              : c.type === "toolCall"
                ? `toolCall(${c.name})`
                : `[${c.type}]`,
          )
          .join(" | ");
        return `message(assistant): ${summary}`;
      }
      if (m.role === "toolResult") {
        const first = m.content[0];
        const text = first?.type === "text" ? first.text : "";
        return `message(toolResult): ${m.toolName} isError=${m.isError} → ${text.slice(0, 40)}`;
      }
      return `message(${(m as { role: string }).role})`;
    }
    case "leaf":
      return `leaf(targetId=${entry.targetId ?? "null"})`;
    case "branch_summary":
      return `branch_summary(fromId=${entry.fromId}, summary="${entry.summary.slice(0, 40)}${entry.summary.length > 40 ? "..." : ""}")`;
    case "compaction":
      return `compaction(firstKept=${entry.firstKeptEntryId}, summary="${entry.summary.slice(0, 40)}...")`;
    case "custom":
      return `custom(type=${entry.customType})`;
    case "custom_message":
      return `custom_message(type=${entry.customType})`;
    case "label":
      return `label(targetId=${entry.targetId}, label="${entry.label ?? "<cleared>"}")`;
    case "session_info":
      return `session_info(name="${entry.name ?? "<none>"}")`;
    case "thinking_level_change":
      return `thinking_level_change(level=${entry.thinkingLevel})`;
    case "model_change":
      return `model_change(${entry.provider}/${entry.modelId})`;
    case "active_tools_change":
      return `active_tools_change([${entry.activeToolNames.join(", ")}])`;
  }
}

// ── Tool(供阶段 9 AgentHarness 集成使用) ──

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

// ── 主流程 ──

async function main() {
  console.log("=== Example 03: Session 双后端演示 ===\n");

  // ── 阶段 0:准备工作 ──
  const shouldClean = process.argv.includes("--clean");
  const tmpRoot = mkdtempSync(join(tmpdir(), "mimi-session-demo-"));
  const cwd = process.cwd();
  console.log(`📁 临时根目录: ${tmpRoot}`);
  console.log(`📂 session cwd:  ${cwd}\n`);

  if (shouldClean) {
    // 清理上次运行残留
    for (const dir of ["mimi-sessions", ".mimi-sessions"]) {
      const path = join(process.cwd(), dir);
      if (existsSync(path)) {
        rmSync(path, { recursive: true, force: true });
        console.log(`🧹 清理: ${path}`);
      }
    }
  }

  // 真实模型(DeepSeek)
  const { model: deepseekModel, models: deepseekModels } = setupDeepSeekModel();

  const env = new NodeExecutionEnv({ cwd });
  const fsAdapter = adaptExecutionEnvForJsonlRepo(env);
  const repo = new JsonlSessionRepo({
    fs: fsAdapter as any,
    sessionsRoot: tmpRoot,
  });

  // ── 阶段 1:create + append 2 轮对话 ──
  console.log("--- 阶段 1:创建 session + 2 轮对话 ---\n");

  const session = await repo.create({ cwd });
  const metadata1 = await session.getMetadata();
  console.log(`  ✓ 创建 session`);
  console.log(`    id:        ${metadata1.id}`);
  console.log(`    file path: ${metadata1.path}\n`);

  // 第 1 轮
  const user1Id = await session.appendMessage(userMsg("你好,我叫 Alice"));
  const assistant1Id = await session.appendMessage(
    assistantMsg([{ type: "text", text: "你好 Alice!有什么可以帮你?" }], deepseekModel),
  );
  console.log(`  ✓ 第 1 轮:`);
  console.log(`    user:      ${user1Id.slice(0, 8)}`);
  console.log(`    assistant: ${assistant1Id.slice(0, 8)}`);

  // 第 2 轮(带 tool call)
  const user2Id = await session.appendMessage(userMsg("查一下天气"));
  const assistant2Id = await session.appendMessage(
    assistantMsg(
      [
        { type: "text", text: "我查一下" },
        { type: "toolCall", id: "call_1", name: "get_weather", arguments: { city: "Beijing" } },
      ],
      deepseekModel,
    ),
  );
  const toolResult2Id = await session.appendMessage(
    toolResultMsg("call_1", "get_weather", "晴,25°C"),
  );
  const assistant2FinalId = await session.appendMessage(
    assistantMsg([{ type: "text", text: "北京今天晴,25°C。" }], deepseekModel),
  );
  console.log(`  ✓ 第 2 轮:`);
  console.log(`    user:           ${user2Id.slice(0, 8)}`);
  console.log(`    assistant+tool: ${assistant2Id.slice(0, 8)}`);
  console.log(`    toolResult:     ${toolResult2Id.slice(0, 8)}`);
  console.log(`    assistant:      ${assistant2FinalId.slice(0, 8)}`);

  // 给第 1 轮加个 label 演示
  await session.appendLabel(user1Id, "first-greeting");
  console.log(`  ✓ 给第 1 轮加 label: "first-greeting"\n`);

  // ── 阶段 2:列出 entries ──
  console.log("--- 阶段 2:列出当前 entries ---\n");
  const entriesBefore = await session.getEntries();
  entriesBefore.forEach((entry, i) => {
    console.log(`  [${i.toString().padStart(2)}] ${describeEntry(entry)}`);
  });
  console.log(`  共 ${entriesBefore.length} 条 entries\n`);

  // ── 阶段 3:close reference + reopen 验证持久化 ──
  console.log("--- 阶段 3:close reference + reopen ---\n");
  // 这里仅放弃引用,实际 JSONL 文件已经被写盘
  // 真实场景下,close 通常意味着不再持有 session 实例

  // 重新打开
  const reopened: Session<JsonlSessionMetadata> = await repo.open(metadata1);
  const metadata2 = await reopened.getMetadata();
  console.log(`  ✓ reopen 成功:`);
  console.log(`    id:        ${metadata2.id}`);
  console.log(`    file path: ${metadata2.path}`);
  console.log(`    same file: ${metadata1.path === metadata2.path ? "✅" : "❌"}`);

  const entriesAfter = await reopened.getEntries();
  console.log(`  ✓ entries 数: ${entriesAfter.length} (reopen 前: ${entriesBefore.length})`);
  if (entriesAfter.length !== entriesBefore.length) {
    console.error(`  ❌ 持久化失败!`);
    process.exit(1);
  }
  console.log(`  ✅ 持久化正常,entries 全部恢复\n`);

  // ── 阶段 4:moveTo 分支跳转 ──
  console.log("--- 阶段 4:moveTo 回到第 1 轮 + BranchSummary ---\n");
  // 切回 user1 这条 entry
  const branchSummaryId = await reopened.moveTo(user1Id, {
    summary: "从天气查询回到问候",
    details: { reason: "user want to ask about name again" },
  });
  console.log(`  ✓ moveTo(${user1Id.slice(0, 8)}),追加 BranchSummary: ${branchSummaryId?.slice(0, 8)}`);

  // 在新分支上继续
  const user3Id = await reopened.appendMessage(userMsg("我叫什么来着?"));
  const assistant3Id = await reopened.appendMessage(
    assistantMsg([{ type: "text", text: "你叫 Alice 呀!" }], deepseekModel),
  );
  console.log(`  ✓ 新分支:`);
  console.log(`    user:      ${user3Id.slice(0, 8)}`);
  console.log(`    assistant: ${assistant3Id.slice(0, 8)}\n`);

  // ── 阶段 5:buildContext 派生 messages ──
  console.log("--- 阶段 5:buildContext 派生 LLM messages ---\n");
  const context = await reopened.buildContext();
  console.log(`  ✓ buildContext 返回 ${context.messages.length} 条 messages:`);
  context.messages.forEach((m, i) => {
    if (m.role === "user") {
      const text =
        typeof m.content === "string"
          ? m.content
          : Array.isArray(m.content) && m.content[0]?.type === "text"
            ? m.content[0].text
            : "[complex]";
      console.log(`    [${i}] user: ${text}`);
    } else if (m.role === "assistant") {
      const summary = m.content
        .map((c) => (c.type === "text" ? c.text : `[${c.type}]`))
        .join(" | ");
      console.log(`    [${i}] assistant: ${summary}`);
    } else if (m.role === "toolResult") {
      const first = m.content[0];
      const text = first?.type === "text" ? first.text : "";
      console.log(`    [${i}] toolResult(${m.toolName}): ${text}`);
    }
  });
  console.log();

  // ── 阶段 6:third reopen + 跨进程验证 ──
  console.log("--- 阶段 6:再次 reopen 验证最终状态 ---\n");
  // drop reference 后再次 open(模拟"重启进程"场景)
  const reopened2 = await repo.open(metadata1);
  const finalEntries = await reopened2.getEntries();
  console.log(`  ✓ 再次 reopen 拿到 ${finalEntries.length} 条 entries`);
  finalEntries.slice(-4).forEach((entry, i) => {
    console.log(`    [-${4 - i}] ${describeEntry(entry)}`);
  });
  console.log();

  // ── 阶段 7:list 列出所有 session ──
  console.log("--- 阶段 7:list 列出所有 session ---\n");
  const allSessions = await repo.list({ cwd });
  console.log(`  ✓ 当前 cwd 下有 ${allSessions.length} 个 session:`);
  for (const meta of allSessions) {
    console.log(`    - id=${meta.id.slice(0, 8)}, path=${meta.path}`);
  }
  console.log();

  // ── 阶段 8:InMemorySessionRepo 对照(快速验证 fork) ──
  console.log("--- 阶段 8:InMemorySessionRepo fork 演示(快速对照) ---\n");
  const memRepo = new InMemorySessionRepo();
  const memSession = await memRepo.create({});
  await memSession.appendMessage(userMsg("parent"));
  const parentUserId = (await memSession.getEntries()).at(-1)!.id;
  await memSession.appendMessage(assistantMsg([{ type: "text", text: "hi" }], deepseekModel));
  console.log(`  ✓ 父 session 创建(${(await memSession.getMetadata()).id.slice(0, 8)})`);

  const forked = await memRepo.fork(await memSession.getMetadata(), {
    entryId: parentUserId,
    position: "at",
  });
  const forkedEntries = await forked.getEntries();
  console.log(`  ✓ fork 派生新 session,共 ${forkedEntries.length} 条 entries`);
  forkedEntries.forEach((e, i) => {
    console.log(`    [${i}] ${describeEntry(e)}`);
  });
  console.log();

  // ── 阶段 9:AgentHarness + 真实 DeepSeek 集成 ──
  console.log("--- 阶段 9:AgentHarness + 真实 DeepSeek + JSONL Session 集成 ---\n");
  console.log("  ℹ️  创建一个新 session,跑 2 个 prompt,让 AgentHarness 自动 appendMessage\n");

  // 创建一个新的 session(独立于上面演示用的)
  const harnessSession = await repo.create({ cwd });
  const harnessMeta = await harnessSession.getMetadata();
  console.log(`  ✓ 新 session: id=${harnessMeta.id.slice(0, 8)}`);
  console.log(`    file path: ${harnessMeta.path}\n`);

  // 构造 AgentHarness:真实模型 + 真实 streamFn(走 DeepSeek) + JSONL session
  const harness = new AgentHarness({
    model: deepseekModel,
    tools: [echoTool],
    env: env as any,
    session: harnessSession as any,
    systemPrompt: "你是一个简洁的中文助手,用 echo 工具回显用户的短句。",
    streamFn: (model: any, context: any, options?: any) =>
      deepseekModels.stream(model, context, options),
  });

  // 第 1 轮
  console.log("  → 第 1 个 prompt: '用一句话欢迎 Alice'\n");
  const messages1 = await harness.prompt("用一句话欢迎 Alice");
  console.log(`  ✓ 第 1 轮完成,收到 ${messages1.length} 条 messages\n`);

  // 第 2 轮
  console.log("  → 第 2 个 prompt: '用 echo 工具回显 hello'\n");
  const messages2 = await harness.prompt("用 echo 工具回显 hello");
  console.log(`  ✓ 第 2 轮完成,收到 ${messages2.length} 条 messages\n`);

  // 验证 session 已自动写入真实对话
  const harnessEntries = await harnessSession.getEntries();
  console.log(`  ✓ session 自动记录了 ${harnessEntries.length} 条 entries:`);
  harnessEntries.forEach((entry, i) => {
    console.log(`    [${i.toString().padStart(2)}] ${describeEntry(entry)}`);
  });
  console.log();

  // 关闭 harness
  await harness.getHooks().dispose();
  await harness.getHooks().clear();

  // ── 阶段 10:展示文件路径 + 提示 ──
  console.log("=== 演示完成 ===\n");
  console.log("📄 持久化文件路径:");
  console.log(`   ${metadata1.path}`);
  console.log(`   ${harnessMeta.path}\n`);
  console.log("💡 你可以用以下命令查看 JSONL 内容:");
  console.log(`   cat "${metadata1.path}" | head -30\n`);
  console.log("💡 清理临时文件:");
  console.log(`   rm -rf "${tmpRoot}"\n`);

  // 不要自动清理,让用户能查看文件
  // 如果传了 --clean 才清理
  if (shouldClean) {
    rmSync(tmpRoot, { recursive: true, force: true });
    console.log(`\n🧹 已清理临时目录: ${tmpRoot}`);
  }
}

main().catch((e) => {
  console.error("ERR:", e);
  process.exit(1);
});
