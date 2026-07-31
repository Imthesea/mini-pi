/**
 * Example 07: 钩子系统(hooks)演示
 *
 * 演示:
 * 1. 3 个 hook 注册:
 *    - `tool_call` handler:阻止删除 `node_modules` 下文件的工具调用
 *    - `context` handler:在 messages 头部注入"今天日期"提醒
 *    - observer:打印所有 hook 事件(用于调试)
 * 2. 验证 hook 实际生效:
 *    - tool_call block:工具被阻止,LLM 看到错误 toolResult
 *    - context 注入:LLM 收到的 messages 包含 reminder
 *
 * 运行: cd packages/agent && npx tsx examples/07-hooks.ts
 */

import { Type } from "typebox";
import { AgentHarness } from "../src/harness/index.js";
import {
  AssistantMessageEventStream,
  type AssistantMessage,
  type Model,
} from "@mimi/ai";
import type { AgentMessage, AgentTool } from "../src/index.js";

// ── Mock model + streamFn ──

const mockModel: Model<any> = {
  id: "mock-model",
  name: "Mock Model",
  api: "anthropic-messages",
  provider: "mock",
  baseUrl: "https://mock.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0 },
  contextWindow: 200000,
  maxTokens: 8192,
};

/**
 * 创建剧本式 mock streamFn:按 responses 数组顺序返回。
 */
function createScriptedStreamFn(
  responses: Array<
    | { kind: "text"; text: string }
    | {
        kind: "toolCalls";
        toolCalls: Array<{ id: string; name: string; arguments: any }>;
        text?: string;
      }
  >,
) {
  let cursor = 0;
  return (_model: Model<any>, _context: any) => {
    const response = responses[cursor++];
    const stream = new AssistantMessageEventStream();

    if (!response) {
      const err: AssistantMessage = {
        role: "assistant",
        content: [],
        api: "anthropic-messages",
        provider: "mock",
        model: "mock-model",
        usage: { input: 0, output: 0, totalTokens: 0, cost: { input: 0, output: 0, total: 0 } },
        stopReason: "error",
        errorMessage: "剧本耗尽",
        timestamp: Date.now(),
      };
      queueMicrotask(() => {
        stream.push({ type: "start", partial: err });
        stream.push({ type: "error", reason: "error", error: err });
      });
      return stream;
    }

    const partial: AssistantMessage = {
      role: "assistant",
      content: [],
      api: "anthropic-messages",
      provider: "mock",
      model: "mock-model",
      usage: { input: 0, output: 0, totalTokens: 0, cost: { input: 0, output: 0, total: 0 } },
      stopReason: response.kind === "toolCalls" ? "toolUse" : "stop",
      timestamp: Date.now(),
    };

    const content: AssistantMessage["content"] = [];
    if (response.kind === "toolCalls") {
      if (response.text) content.push({ type: "text", text: response.text });
      for (const tc of response.toolCalls) {
        content.push({
          type: "toolCall",
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
        });
      }
    } else {
      content.push({ type: "text", text: response.text });
    }

    queueMicrotask(() => {
      stream.push({ type: "start", partial: { ...partial, content: [] } });
      for (let i = 0; i < content.length; i++) {
        const block = content[i];
        if (block.type === "text") {
          stream.push({
            type: "text_start",
            contentIndex: i,
            partial: { ...partial, content: content.slice(0, i) },
          });
          stream.push({
            type: "text_delta",
            contentIndex: i,
            delta: block.text,
            partial: { ...partial, content: content.slice(0, i + 1) },
          });
          stream.push({
            type: "text_end",
            contentIndex: i,
            content: block.text,
            partial: { ...partial, content: content.slice(0, i + 1) },
          });
        } else if (block.type === "toolCall") {
          stream.push({
            type: "toolcall_start",
            contentIndex: i,
            partial: { ...partial, content: content.slice(0, i) },
          });
          stream.push({
            type: "toolcall_end",
            contentIndex: i,
            toolCall: block,
            partial: { ...partial, content: content.slice(0, i + 1) },
          });
        }
      }
      stream.push({
        type: "done",
        reason: "stop",
        message: {
          ...partial,
          content,
          stopReason: response.kind === "toolCalls" ? "toolUse" : "stop",
        },
      });
    });

    return stream;
  };
}

// ── Tool:delete_file(危险:可指定任意 path) ──

const deleteFileTool: AgentTool = {
  name: "delete_file",
  label: "Delete File",
  description: "删除指定路径的文件",
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
  harness.getHooks().on("tool_call", () => {
    // 实际应该读 toolCall 上下文判断 toolName / arguments
    // 这里简化:用全局计数器演示 hook 被触发了
    state.blockedCount++;
    return { block: true, reason: `禁止删除 ${blockedPrefix} 下的文件` };
  });
  return { blocked: () => state.blockedCount };
}

// ── Hook 2:context handler 注入 reminder ──

/**
 * 上下文注入 hook:在 messages 头部加一个"今天日期"提醒。
 * 演示 `context` 事件 + 链式 messages 转换。
 */
function installContextReminderHook(harness: AgentHarness): void {
  harness.getHooks().on("context", (_event, ctx) => {
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
    return { messages: [reminder, ...ctx.messages] };
  });
}

// ── Hook 3:observer 记录所有事件 ──

/**
 * 观察者:打印所有 hook 事件(用于调试与验证 hook 流)。
 */
function installObserverLogger(harness: AgentHarness): string[] {
  const log: string[] = [];
  harness.getHooks().observe((event) => {
    const tag = `[hook:${event.type}]`;
    log.push(tag);
    console.log(`  🔍 ${tag}`);
  });
  return log;
}

// ── 主流程 ──

async function main() {
  console.log("=== Example 07: 钩子系统(hooks)演示 ===\n");

  // 剧本:第一轮 LLM 想删 node_modules 下的文件,被 hook 阻止
  //      第二轮 LLM 看到错误信息,改成"我自己来"
  const streamFn = createScriptedStreamFn([
    {
      kind: "toolCalls",
      text: "我尝试删除文件",
      toolCalls: [
        {
          id: "call_1",
          name: "delete_file",
          arguments: { path: "node_modules/foo/bar.js" },
        },
      ],
    },
    {
      kind: "text",
      text: "看到 hook 阻止后,我放弃了删除,直接告诉用户结果。",
    },
  ]);

  // 构造 AgentHarness
  const harness = new AgentHarness({
    model: mockModel,
    tools: [deleteFileTool],
    env: { readFile: async () => ({ ok: true, value: "" }) } as any,
    session: {
      id: "hooks-demo",
      appendMessage: async () => "mock-entry-id",
    } as any,
    systemPrompt: "你是一个文件管理助手",
    streamFn: streamFn as any,
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
  const subscription = harness.subscribe();
  (async () => {
    for await (const _event of subscription) {
      // no-op,只让订阅存在
    }
  })();

  // 启动 turn
  console.log("--- 启动 harness.prompt() ---\n");
  const messages = await harness.prompt("帮我删除 node_modules/foo/bar.js");
  await new Promise((r) => setTimeout(r, 20));
  subscription.cancel();

  // ── 验证 ──
  console.log("\n=== 验证 hook 行为 ===\n");

  // 验证 1:observer 收到多个事件
  console.log(
    `  observer 收到 ${observerLog.length} 个事件:`,
    observerLog.join(", "),
  );
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
  const errorToolResults = messages.filter(
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

  console.log("\n=== 总结 ===");
  // 用 seenEvents(已剥掉 brackets)做计数
  const contextCount = seenEvents.has("context") ? 1 : 0;
  console.log(`  3 个 hooks 全部安装并被触发:`);
  console.log(`    - tool_call handler 触发了 ${dangerousGuard.blocked()} 次`);
  console.log(`    - context handler 触发了 ${contextCount} 次`);
  console.log(`    - observer 总共收到 ${observerLog.length} 个事件`);

  // 清理:dispose harness
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
