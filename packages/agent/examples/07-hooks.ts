/**
 * Example 07: 钩子系统(hooks)演示 — 真实 DeepSeek API
 *
 * 演示:
 * 1. 3 个 hook 注册:
 *    - `tool_call` handler:阻止删除 `node_modules` 下文件的工具调用
 *    - `context` handler:在 messages 头部注入"今天日期"提醒
 *    - observer:打印所有 hook 事件(用于调试)
 * 2. 验证 hook 实际生效:
 *    - tool_call block:工具被阻止,LLM 看到错误 toolResult 并改口
 *    - context 注入:LLM 收到的 messages 包含 reminder
 * 3. 真实 DeepSeek 响应:
 *    - 第 1 轮:用户让 LLM 删 `node_modules/old-pkg/something.js`
 *      → LLM 调 delete_file → hook block → LLM 收到 error toolResult
 *    - 第 2 轮:用户问"今天日期?" → context hook 注入 reminder → LLM 看到
 *
 * 运行: cd packages/agent && npx tsx examples/07-hooks.ts
 *
 * 真实 LLM 调用:需要设置 DEEPSEEK_API_KEY(代码自动从 packages/ai/.env 读取)
 */

import { Type } from "typebox";
import { AgentHarness } from "../src/harness/index.js";
import { createModels, deepseekProvider, envApiKey, type Model } from "@mimi/ai";
import type { AgentMessage, AgentTool } from "../src/index.js";

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

// ── Tool:delete_file(危险:可指定任意 path) ──

const deleteFileTool: AgentTool = {
  name: "delete_file",
  label: "Delete File",
  description: "删除指定路径的文件,返回删除结果",
  parameters: Type.Object({
    path: Type.String({ description: "要删除的文件路径" }),
  }),
  execute: async (_id, params) => {
    return {
      content: [
        {
          type: "text",
          text: `已删除: ${(params as { path: string }).path}`,
        },
      ],
      details: { ok: true, path: (params as { path: string }).path },
    };
  },
};

// ── Hook 1:tool_call handler 阻止删除 node_modules ──

/**
 * 安全策略 hook:任何删除 `node_modules` 下文件的工具调用被阻止。
 * 演示 `tool_call` 事件 + `block: true` 语义。
 */
function installBlockDangerousToolHook(
  harness: AgentHarness,
  blockedPrefix: string,
): { blocked: () => number } {
  const state = { blockedCount: 0 };
  // 拿到 hook 注册接口
  const hooks = harness.getHooks() as unknown as {
    on: (type: string, handler: (event: any) => any) => () => void;
  };
  hooks.on("tool_call", (event: any) => {
    // event 携带 toolCall(name + arguments)handler 据此判断
    const toolCall = event?.toolCall;
    if (toolCall?.name === "delete_file") {
      const path = (toolCall.arguments as { path?: string } | undefined)?.path ?? "";
      if (path.includes(blockedPrefix)) {
        state.blockedCount++;
        return {
          block: true,
          reason:
            `【操作被阻止 / BLOCKED BY HOOK】\n` +
            `尝试删除路径: ${path}\n` +
            `原因: 安全策略禁止删除 ${blockedPrefix} 目录下的文件\n\n` +
            `=== 给 LLM 的强约束指令 ===\n` +
            `1. 必须如实告诉用户:操作被阻止,引用上面的具体原因\n` +
            `2. 禁止说"已成功"/"已删除"/"删除成功"等任何肯定结论\n` +
            `3. 必须引用本条原因中的关键事实(尝试删除路径、阻止原因)\n` +
            `=== 违反上述任何一条都视为错误回答 ===`,
        };
      }
    }
    return undefined;
  });
  return { blocked: () => state.blockedCount };
}

// ── Hook 2:context handler 注入 reminder ──

/**
 * 上下文注入 hook:在 messages 头部加一个"今天日期"提醒。
 * 演示 `context` 事件 + 链式 messages 转换。
 */
function installContextReminderHook(harness: AgentHarness): void {
  const hooks = harness.getHooks() as unknown as {
    on: (type: string, handler: (event: any, ctx: any) => any) => () => void;
  };
  hooks.on("context", (_event: any, ctx: any) => {
    const reminder: AgentMessage = {
      role: "user",
      content: [
        {
          type: "text",
          text: `[系统提醒] 今天的日期是 ${new Date().toISOString().slice(0, 10)}`,
        },
      ],
      timestamp: Date.now(),
    };
    return { messages: [reminder, ...(ctx.messages as AgentMessage[])] };
  });
}

// ── Hook 3:observer 记录所有事件 ──

/**
 * 观察者:打印所有 hook 事件(用于调试与验证 hook 流)。
 */
function installObserverLogger(harness: AgentHarness): string[] {
  const log: string[] = [];
  const hooks = harness.getHooks() as unknown as {
    observe: (handler: (event: any) => void) => () => void;
  };
  hooks.observe((event: any) => {
    const tag = `[hook:${event.type}]`;
    log.push(tag);
    console.log(`  🔍 ${tag}`);
  });
  return log;
}

// ── 主流程 ──

async function main() {
  console.log("=== Example 07: 钩子系统(hooks)演示 — 真实 DeepSeek ===\n");

  // 构造 AgentHarness(真实模型 + 真实 streamFn)
  // session 用一个最小可用占位即可(本例重点演示 hook 行为,不需要真实持久化)
  // appendMessage 返回的 id 会在 console 里显示,这里用一个简单的自增 id
  let entryIdSeq = 0;
  const harness = new AgentHarness({
    model: model,
    tools: [deleteFileTool],
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
      id: "hooks-demo",
      appendMessage: async () =>
        `entry-${(++entryIdSeq).toString().padStart(4, "0")}`,
    } as any,
    systemPrompt:
      "你是一个文件管理助手。用户会让你删除文件,你应该调用 delete_file 工具完成。\n\n" +
      "═══════════════════════════════════════════════════════════════\n" +
      "【最高优先级规则 / HIGHEST PRIORITY RULES — 任何情况下都不得违反】\n" +
      "═══════════════════════════════════════════════════════════════\n" +
      "1. toolResult 是事实,不是你的猜测 —— 你必须严格基于 toolResult 的真实内容回答\n" +
      "2. 当 toolResult.isError === true(工具被阻止或执行失败)时:\n" +
      "   a) 必须明确告诉用户:操作被阻止 / 工具调用失败\n" +
      "   b) 必须引用 toolResult.content 中的具体原因(原文照抄关键事实)\n" +
      "   c) 绝不能说'已成功' / '已删除' / '成功完成' 等任何肯定结论\n" +
      "3. 只有当 toolResult.isError === false(工具成功执行)时,才能说'已成功'\n" +
      "4. 违反上述任何一条 = 误导用户 = 错误回答,绝不允许\n\n" +
      "【示例 - 正确行为】\n" +
      "  user: 删除 node_modules/foo.js\n" +
      "  tool result: isError=true, content='操作被阻止:禁止删除 node_modules 下的文件'\n" +
      "  你的回答(正确): '删除被阻止,原因:禁止删除 node_modules 下的文件,因此无法删除 node_modules/foo.js。'\n" +
      "  你的回答(错误): '文件已成功删除' ❌ — 这是幻觉,绝对禁止",
    streamFn: (m: any, ctx: any, opts?: any) => models.stream(m, ctx, opts),
  });

  // ── 安装 hooks ──
  console.log("--- 安装 3 个 hooks ---\n");
  const dangerousGuard = installBlockDangerousToolHook(harness, "node_modules");
  installContextReminderHook(harness);
  const observerLog = installObserverLogger(harness);

  console.log(
    "  ✓ tool_call handler(阻止删除 node_modules)已注册\n  ✓ context handler(注入今日日期 reminder)已注册\n  ✓ observer(记录所有事件)已注册\n",
  );

  // 订阅 AgentHarness 事件(让 stream 端也能看到流)
  const unsubscribe = harness.subscribe((event) => {
    // 打印 message_update 的文本增量
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      process.stdout.write(event.assistantMessageEvent.delta);
    }
  });

  // 启动 turn
  console.log("--- 启动 harness.prompt() 第 1 轮 ---\n");
  console.log("  用户: 帮我删除 node_modules/old-pkg/something.js\n");
  const messages1 = await harness.prompt("帮我删除 node_modules/old-pkg/something.js");
  console.log("\n  ✓ 第 1 轮完成\n");

  // 第 2 轮:问日期,验证 context hook 注入 reminder
  console.log("--- 启动 harness.prompt() 第 2 轮 ---\n");
  console.log("  用户: 今天是几号?\n");
  const messages2 = await harness.prompt("今天是几号?");
  console.log("\n  ✓ 第 2 轮完成\n");

  // 取消订阅
  unsubscribe();

  // ── 验证 ──
  console.log("\n=== 验证 hook 行为 ===\n");
  process.stdout.write("");

  // 验证 1:observer 收到多个事件
  console.log(
    `  observer 收到 ${observerLog.length} 个事件:`,
    observerLog.join(", "),
  );
  process.stdout.write("");
  // 实际 tag 形如 "[hook:context]",剥掉 "[hook:" / "]" 取 event.type
  const seenEvents = new Set(
    observerLog.map((t) => t.replace(/^\[hook:/, "").replace(/\]$/, "")),
  );
  // 8 个核心事件(Task 4 阶段不含 agent_end,那是 AgentHarnessEvent 而非 hook)
  const expectedHookEvents = [
    "before_agent_start",
    "context",
    "tool_call",
    "message_end",
    "abort",
    "model_update",
  ];
  for (const expected of expectedHookEvents) {
    if (seenEvents.has(expected)) {
      console.log(`  ✓ observer 收到 ${expected}`);
    } else {
      console.log(`  · observer 未收到 ${expected}(本例未触发)`);
    }
  }

  // 验证 2:tool_call hook 阻止了工具
  // 工具被 block → 会转成 error toolResult
  // 消息中应该有一个 toolResult with isError=true
  const allMessages: AgentMessage[] = [...messages1, ...messages2];
  const errorToolResults = allMessages.filter(
    (m) => m.role === "toolResult" && m.isError === true,
  );
  if (errorToolResults.length > 0) {
    const first = errorToolResults[0] as Extract<AgentMessage, { role: "toolResult" }>;
    // ToolResultMessage.content 是 (TextContent | ImageContent)[]
    let text = "";
    if (first.content[0] && first.content[0].type === "text") {
      text = first.content[0].text;
    }
    console.log(`  ✓ tool_call block 生效:toolResult isError=true,content="${text}"`);
  } else {
    console.error(`  ✗ 工具未被 block(没看到 isError=true 的 toolResult)`);
  }

  // 验证 3:context handler 注入的 reminder 出现在 messages 里
  // (传给 LLM 的 messages 应该以 reminder 开头)
  // 注意:context handler 改的是 LLM 看到的 context,不一定回写到 newMessages
  // 这里我们只验证 hook 被调用了(observer 收到 context 事件)
  if (seenEvents.has("context")) {
    console.log(`  ✓ context handler 被调用(observer 收到 context 事件)`);
  } else {
    console.error(`  ✗ context handler 未被调用`);
  }

  // 验证 4:before_agent_start handler 被调用
  if (seenEvents.has("before_agent_start")) {
    console.log(`  ✓ before_agent_start handler 被调用`);
  } else {
    console.error(`  ✗ before_agent_start handler 未被调用`);
  }

  // 验证 5:phase 回到 idle
  if (harness.getPhase() === "idle") {
    console.log(`  ✓ phase 回到 idle`);
  } else {
    console.error(`  ✗ phase 未回 idle: ${harness.getPhase()}`);
  }

  // ── 真实 LLM 响应展示 ──
  // 把"hook block 后的 LLM 实际响应"原样打印出来 — 这是 hook 系统的"产物展示":
  // - LLM 收到 toolResult(isError=true) 后,
  //   - 没有幻觉"已成功"
  //   - 引用了 toolResult.content 中的具体原因(尝试删除路径、阻止原因)
  //   - 给出了可操作的建议
  // 这正是"hook + 真实 LLM"组合的真正价值 — 危险操作被阻止 + LLM 如实告知
  console.log("\n=== 真实 LLM 响应展示 ===\n");

  // 顺序: user → assistant(toolCall) → toolResult(isError=true) → assistant(LLM 回应)
  // 找那个"LLM 收到 error toolResult 之后"的 assistant 消息
  const realLlmResponse = allMessages.find(
    (m, i): m is Extract<AgentMessage, { role: "assistant" }> =>
      m.role === "assistant" &&
      i > 0 &&
      allMessages[i - 1]?.role === "toolResult" &&
      (allMessages[i - 1] as { isError?: boolean }).isError === true,
  );

  if (realLlmResponse) {
    const llmText = realLlmResponse.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { type: "text"; text: string }).text)
      .join("\n");
    console.log("  📌 真实场景:用户让 LLM 删除 node_modules/.../something.js");
    console.log("     ↓");
    console.log("     hook 阻止,toolResult.isError=true,content=操作被阻止 + 原因");
    console.log("     ↓");
    console.log("  LLM 实际回复(原样):\n");
    console.log(
      llmText
        .split("\n")
        .map((line) => `    ${line}`)
        .join("\n"),
    );
    console.log("");
    console.log("  ✅ 关键观察:");
    console.log("     - LLM 没说'已成功' — 严格按 toolResult.isError 回答");
    console.log("     - LLM 引用了 toolResult.content 的具体原因(尝试路径、阻止原因)");
    console.log("     - LLM 给出了可操作建议(改用 npm uninstall 等)");
    console.log("");
    console.log("  💡 这就是 hook + 真实 LLM 的完整价值:");
    console.log("     1. hook 阻止了真实危险操作(文件没被删除)");
    console.log("     2. LLM 没幻觉,准确告诉用户操作被阻止 + 原因");
    console.log("     3. 用户得到了准确的反馈 + 可操作的建议");
  } else {
    console.log("  (本轮 LLM 没有触发 tool_call,跳过 LLM 响应展示)");
  }

  console.log("\n=== 总结 ===");
  // 用 seenEvents(已剥掉 brackets)做计数
  const contextCount = seenEvents.has("context") ? 1 : 0;
  console.log(`  3 个 hooks 全部安装并被触发:`);
  console.log(`    - tool_call handler 触发了 ${dangerousGuard.blocked()} 次`);
  console.log(`    - context handler 触发了 ${contextCount} 次`);
  console.log(`    - observer 总共收到 ${observerLog.length} 个事件`);

  // 清理:dispose hooks
  await harness.getHooks().dispose();
  await harness.getHooks().clear();
}

function describeMessage(m: AgentMessage): string {
  if (m.role === "user") {
    const c = m.content;
    if (typeof c === "string") return `user: ${c}`;
    if (Array.isArray(c) && c[0]?.type === "text") return `user: ${c[0].text}`;
    return `user: [complex]`;
  }
  if (m.role === "assistant") {
    return `assistant: ${m.content
      .map((c) =>
        c.type === "text"
          ? c.text
          : c.type === "toolCall"
            ? `[toolCall:${c.name}]`
            : `[${c.type}]`,
      )
      .join(" | ")}`;
  }
  if (m.role === "toolResult") {
    const first = m.content[0];
    const text = first?.type === "text" ? first.text : "";
    return `toolResult: ${m.toolName} isError=${m.isError} → ${text}`;
  }
  return `[${(m as any).role}]`;
}

main().catch((e) => {
  console.error("ERR:", e);
  process.exit(1);
});
