/**
 * Example 01: agent-loop 基础用法
 *
 * 演示：
 * - 用 mock streamFn 启动 runAgentLoop
 * - 注册一个工具(echo)
 * - 订阅事件(逐个打印)
 * - 验证:agent_start → turn_start → message_start/update/end → tool_execution_* → message_start/end → agent_end
 *
 * 运行: cd packages/agent && npx tsx examples/01-basic.ts
 */

import { Type } from "typebox";
import { runAgentLoop, type AgentEvent, type AgentMessage, type AgentTool } from "../src/index.js";
import { AssistantMessageEventStream, type AssistantMessage, type Model, type StreamFn } from "@mimi/ai";

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
 * 剧本式 mock stream:第一轮返回 1 个 toolCall,第二轮返回文本。
 * 行为与 __tests__/_helpers/mock-provider.ts 等价,放在 example 内方便独立运行。
 */
function createScriptedStreamFn(
  responses: Array<
    | { kind: "text"; text: string }
    | { kind: "toolCalls"; toolCalls: Array<{ id: string; name: string; arguments: any }>; text?: string }
  >,
): StreamFn {
  let cursor = 0;
  let callCount = 0;
  return (model, _context) => {
    callCount++;
    const response = responses[cursor++];
    const stream = new AssistantMessageEventStream();

    if (!response) {
      // 剧本耗尽:返回错误
      const err: AssistantMessage = {
        role: "assistant",
        content: [],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: { input: 0, output: 0, totalTokens: 0, cost: { input: 0, output: 0, total: 0 } },
        stopReason: "error",
        errorMessage: `剧本耗尽(已调用 ${callCount} 次)`,
        timestamp: Date.now(),
      };
      queueMicrotask(() => {
        stream.push({ type: "start", partial: err });
        stream.push({ type: "error", reason: "error", error: err });
      });
      return stream;
    }

    // 构造 partial
    const partial: AssistantMessage = {
      role: "assistant",
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
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
          stream.push({ type: "text_start", contentIndex: i, partial: { ...partial, content: content.slice(0, i) } });
          stream.push({ type: "text_delta", contentIndex: i, delta: block.text, partial: { ...partial, content: content.slice(0, i + 1) } });
          stream.push({ type: "text_end", contentIndex: i, content: block.text, partial: { ...partial, content: content.slice(0, i + 1) } });
        } else if (block.type === "toolCall") {
          stream.push({ type: "toolcall_start", contentIndex: i, partial: { ...partial, content: content.slice(0, i) } });
          stream.push({ type: "toolcall_end", contentIndex: i, toolCall: block, partial: { ...partial, content: content.slice(0, i + 1) } });
        }
      }
      stream.push({
        type: "done",
        reason: "stop",
        message: { ...partial, content, stopReason: response.kind === "toolCalls" ? "toolUse" : "stop" },
      });
    });

    return stream;
  };
}

// ── Tool: echo ──

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
  console.log("=== Example 01: agent-loop 基础流程 ===\n");

  const streamFn = createScriptedStreamFn([
    {
      kind: "toolCalls",
      text: "我先 echo 一下",
      toolCalls: [{ id: "call_1", name: "echo", arguments: { text: "hello" } }],
    },
    { kind: "text", text: "工具返回了 echo: hello,任务完成。" },
  ]);

  // 收集事件用于展示
  const eventLog: string[] = [];
  const messages = await runAgentLoop(
    [{ role: "user", content: "请 echo 'hello'", timestamp: Date.now() }],
    { systemPrompt: "你是一个有用的助手", messages: [], tools: [echoTool] },
    { model: mockModel, convertToLlm: (msgs) => msgs, streamFn },
    async (event: AgentEvent) => {
      const tag = eventTypeLabel(event);
      eventLog.push(tag);
      console.log(`  📡 ${tag}`);
    },
  );

  console.log("\n=== 事件流总览 ===");
  console.log(`共 ${eventLog.length} 个事件:`);
  console.log(eventLog.map((t) => `  - ${t}`).join("\n"));

  console.log("\n=== 返回的 messages ===");
  messages.forEach((m, i) => {
    console.log(`  [${i}] ${describeMessage(m)}`);
  });

  // 验证:看到关键事件
  const required = ["agent_start", "turn_start", "agent_end"];
  const missing = required.filter((r) => !eventLog.includes(r));
  if (missing.length > 0) {
    console.error(`\n❌ 缺少关键事件: ${missing.join(", ")}`);
    process.exit(1);
  }

  // 验证:看到 tool 执行
  if (!eventLog.some((e) => e.startsWith("tool_execution"))) {
    console.error(`\n❌ 没有 tool_execution_* 事件`);
    process.exit(1);
  }

  console.log("\n✅ 流程完整,关键事件齐全");
}

function eventTypeLabel(event: AgentEvent): string {
  switch (event.type) {
    case "agent_start":
    case "agent_end":
    case "turn_start":
    case "turn_end":
    case "message_start":
    case "message_end":
      return event.type;
    case "message_update":
      return `message_update(${event.assistantMessageEvent.type})`;
    case "tool_execution_start":
      return `tool_execution_start(${event.toolName})`;
    case "tool_execution_update":
      return `tool_execution_update(${event.toolName})`;
    case "tool_execution_end":
      return `tool_execution_end(${event.toolName}, isError=${event.isError})`;
  }
}

function describeMessage(m: AgentMessage): string {
  if (m.role === "user") return `user: ${typeof m.content === "string" ? m.content : "[complex]"}`;
  if (m.role === "assistant") {
    return `assistant: ${m.content.map((c) => (c.type === "text" ? c.text : c.type === "toolCall" ? `[toolCall:${c.name}]` : `[${c.type}]`)).join(" | ")}`;
  }
  if (m.role === "toolResult") {
    return `toolResult: ${m.toolName} isError=${m.isError} → ${m.content[0]?.text ?? ""}`;
  }
  return `[${(m as any).role}]`;
}

main().catch((e) => {
  console.error("ERR:", e);
  process.exit(1);
});
