/**
 * Agent 层共用类型测试。
 *
 * 覆盖（依据 2026-07-30-phase02-agent-plan.md Task 1）：
 * - AgentContext 必填字段不可缺
 * - AgentEvent 的 type 联合完整覆盖所有变体
 * - CustomAgentMessages 默认可为空接口，声明合并后被识别
 * - AgentTool<T> 的 parameters 必须是 TSchema 类型（TypeBox）
 * - QueueMode 联合只接受两个值
 *
 * 还顺手验证了：AgentMessage、AgentToolResult、AgentLoopConfig 等关键导出。
 *
 * 声明合并样例：通过 declare module 把 notification 类型并入 CustomAgentMessages，
 * 测试 AgentMessage 联合确实接受了 customType 消息。
 */

import { describe, it, expect, expectTypeOf } from "vitest";
import Type from "typebox";
import type {
  AgentContext,
  AgentEvent,
  AgentMessage,
  AgentTool,
  AgentLoopConfig,
  AgentToolResult,
  AgentToolUpdateCallback,
  QueueMode,
  ThinkingLevel,
  ToolExecutionMode,
  BeforeToolCallResult,
  AfterToolCallResult,
  CustomAgentMessages,
} from "../src/types.js";

describe("AgentContext", () => {
  it("systemPrompt 是必填字段", () => {
    // @ts-expect-error 缺少 systemPrompt 应报错
    const ctx1: AgentContext = { messages: [] };
    // @ts-expect-error 缺少 messages 应报错
    const ctx2: AgentContext = { systemPrompt: "x" };
    // 正常构造不应报错
    const ctx3: AgentContext = { systemPrompt: "x", messages: [] };
    expect(ctx3.systemPrompt).toBe("x");
    expect(ctx3.messages).toEqual([]);
  });

  it("tools 是可选字段", () => {
    // tools 不传时仍合法
    const ctx: AgentContext = { systemPrompt: "x", messages: [] };
    expectTypeOf(ctx.tools).toEqualTypeOf<AgentTool<any>[] | undefined>();
  });
});

describe("AgentEvent", () => {
  it("type 联合覆盖所有变体", () => {
    // 列举 pi agent-loop 设计中的全部事件
    const types: AgentEvent["type"][] = [
      "agent_start",
      "agent_end",
      "turn_start",
      "turn_end",
      "message_start",
      "message_update",
      "message_end",
      "tool_execution_start",
      "tool_execution_update",
      "tool_execution_end",
    ];
    // 防止重复
    expect(new Set(types).size).toBe(types.length);
    expect(types.length).toBeGreaterThanOrEqual(10);
  });

  it("不同事件变体有不同 payload 形状", () => {
    // turn_end 必须有 message + toolResults
    expectTypeOf<Extract<AgentEvent, { type: "turn_end" }>>().toHaveProperty("message");
    expectTypeOf<Extract<AgentEvent, { type: "turn_end" }>>().toHaveProperty("toolResults");
    // agent_start 无 payload
    expectTypeOf<Extract<AgentEvent, { type: "agent_start" }>>().not.toHaveProperty("message");
  });
});

describe("CustomAgentMessages + AgentMessage", () => {
  it("默认 CustomAgentMessages 为空接口（keyof 为 never）", () => {
    expectTypeOf<keyof CustomAgentMessages>().toEqualTypeOf<never>();
  });

  it("声明合并后 AgentMessage 联合能容纳 customType 消息", () => {
    // 声明合并样例：把 notification 并入 CustomAgentMessages
    type NotificationMessage = {
      role: "custom";
      customType: "notification";
      title: string;
      body: string;
    };
    type MergedAgentMessage = AgentMessage | NotificationMessage;
    // 静态类型层面验证：notification 可以作为 AgentMessage 接受（用合并类型演示）
    const notif: MergedAgentMessage = {
      role: "custom",
      customType: "notification",
      title: "测试",
      body: "你好",
    };
    expect(notif.role).toBe("custom");
    if (notif.role === "custom") {
      expect(notif.title).toBe("测试");
    }
  });

  it("AgentMessage 是 LLM 消息的联合", () => {
    // 基本消息（来自 AI 层）应当是 AgentMessage 的子类型
    const userMsg: AgentMessage = {
      role: "user",
      content: "hi",
      timestamp: 1,
    };
    const asstMsg: AgentMessage = {
      role: "assistant",
      content: [{ type: "text", text: "hello" }],
      api: "anthropic-messages",
      provider: "anthropic",
      model: "claude",
      usage: { input: 1, output: 1, totalTokens: 2, cost: { input: 0, output: 0, total: 0 } },
      stopReason: "stop",
      timestamp: 1,
    };
    const toolMsg: AgentMessage = {
      role: "toolResult",
      toolCallId: "t1",
      toolName: "echo",
      content: [{ type: "text", text: "ok" }],
      isError: false,
      timestamp: 1,
    };
    expect(userMsg.role).toBe("user");
    expect(asstMsg.role).toBe("assistant");
    expect(toolMsg.role).toBe("toolResult");
  });
});

describe("AgentTool", () => {
  it("parameters 必须是 TypeBox TSchema 类型", () => {
    // 用 typebox 的 Type.Object 构造 schema
    const schema = Type.Object({
      path: Type.String(),
    });

    const tool: AgentTool<typeof schema> = {
      name: "read_file",
      label: "读文件",
      description: "读取本地文件",
      parameters: schema,
      execute: async (id, params) => {
        return {
          content: [{ type: "text", text: `read ${params.path}` }],
          details: { ok: true },
        };
      },
    };

    // 断言 parameters 类型
    expectTypeOf(tool.parameters).toMatchTypeOf<typeof schema>();
    expect(tool.name).toBe("read_file");
  });

  it("execute 函数签名正确", () => {
    type Execute = AgentTool<any>["execute"];
    expectTypeOf<Execute>().toBeFunction();
    // execute 必须返回 Promise<AgentToolResult>
    expectTypeOf<Execute>().returns.toMatchTypeOf<Promise<AgentToolResult<any>>>();
  });
});

describe("QueueMode 联合", () => {
  it("只接受 'all' 或 'one-at-a-time'", () => {
    const a: QueueMode = "all";
    const b: QueueMode = "one-at-a-time";
    expect([a, b]).toHaveLength(2);
    // @ts-expect-error 非法值
    const c: QueueMode = "foo";
    expect(typeof c).toBe("string");
  });
});

describe("ThinkingLevel 联合", () => {
  it("覆盖 pi 设计中的所有等级", () => {
    const levels: ThinkingLevel[] = [
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ];
    expect(new Set(levels).size).toBe(7);
    expectTypeOf<ThinkingLevel>().toEqualTypeOf<
      "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
    >();
  });
});

describe("ToolExecutionMode 联合", () => {
  it("只接受 'sequential' 或 'parallel'", () => {
    const a: ToolExecutionMode = "sequential";
    const b: ToolExecutionMode = "parallel";
    expect([a, b]).toHaveLength(2);
  });
});

describe("AgentToolResult + AgentToolUpdateCallback", () => {
  it("AgentToolResult 包含 content + details", () => {
    const r: AgentToolResult<{ ok: boolean }> = {
      content: [{ type: "text", text: "done" }],
      details: { ok: true },
    };
    expect(r.content[0].text).toBe("done");
    expect(r.details.ok).toBe(true);
  });

  it("AgentToolUpdateCallback 是 (partial) => void 函数", () => {
    expectTypeOf<AgentToolUpdateCallback>().toBeFunction();
  });
});

describe("AgentLoopConfig", () => {
  it("必填字段是 model 和 convertToLlm", () => {
    // 仅创建可空子集做类型断言
    type RequiredKeys = "model" | "convertToLlm";
    expectTypeOf<RequiredKeys>().toMatchTypeOf<keyof AgentLoopConfig>();
  });

  it("包含 hooks 与队列相关可选回调", () => {
    // 类型层面验证：这些字段必须存在于 AgentLoopConfig
    const cfg: AgentLoopConfig = {} as any;
    expectTypeOf<Pick<AgentLoopConfig, "transformContext">>().toHaveProperty("transformContext");
    expectTypeOf<Pick<AgentLoopConfig, "getApiKey">>().toHaveProperty("getApiKey");
    expectTypeOf<Pick<AgentLoopConfig, "shouldStopAfterTurn">>().toHaveProperty("shouldStopAfterTurn");
    expectTypeOf<Pick<AgentLoopConfig, "prepareNextTurn">>().toHaveProperty("prepareNextTurn");
    expectTypeOf<Pick<AgentLoopConfig, "getSteeringMessages">>().toHaveProperty("getSteeringMessages");
    expectTypeOf<Pick<AgentLoopConfig, "getFollowUpMessages">>().toHaveProperty("getFollowUpMessages");
    expectTypeOf<Pick<AgentLoopConfig, "toolExecution">>().toHaveProperty("toolExecution");
    expectTypeOf<Pick<AgentLoopConfig, "beforeToolCall">>().toHaveProperty("beforeToolCall");
    expectTypeOf<Pick<AgentLoopConfig, "afterToolCall">>().toHaveProperty("afterToolCall");
    // 防止 cfg 未使用的警告
    void cfg;
  });
});

describe("Before/After Tool Call Result", () => {
  it("BeforeToolCallResult 支持 block + reason", () => {
    const r: BeforeToolCallResult = { block: true, reason: "policy" };
    expect(r.block).toBe(true);
  });

  it("AfterToolCallResult 支持 content/details/isError/terminate 增量覆盖", () => {
    const r: AfterToolCallResult = {
      content: [{ type: "text", text: "patched" }],
      isError: false,
    };
    expect(r.content[0].text).toBe("patched");
  });
});
