/**
 * AgentHarness prompt() 业务入口测试。
 *
 * 覆盖:
 * - prompt()在 idle 时正常工作,phase 正确转换
 * - prompt()在非 idle 时抛 PhaseError
 * - prompt()把 LLM 响应通过 _emit 转发到订阅者
 * - prompt()完成后 phase 回到 idle
 * - prompt()异常路径后 phase 回到 idle
 */

import { describe, expect, it, vi } from "vitest";
import { AgentHarness } from "../../../src/harness/agent-harness/agent-harness.js";
import { createMockStreamFn, mockModel } from "../../_helpers/mock-provider.js";
import { PhaseError } from "../../../src/harness/errors.js";
import type { AgentHarnessEvent } from "../../../src/harness/types/events.js";
import type { AgentHarnessOptions } from "../../../src/harness/types/options.js";

function makeOptions(overrides: Partial<AgentHarnessOptions> = {}): AgentHarnessOptions {
  // streamFn 注入到 options(在 prompt.ts 中读取,作为 AgentLoopConfig.streamFn)
  const { streamFn: _ignored, ...rest } = overrides;
  void _ignored;
  return {
    model: mockModel,
    tools: [],
    env: { readFile: async () => ({ ok: true, value: "" }) } as any,
    session: { id: "sess-1" } as any,
    ...rest,
  };
}

/** 构造 harness 并注入 streamFn(经 options 透传) */
function makeHarness(
  responses: Parameters<typeof createMockStreamFn>[0],
  options: Partial<AgentHarnessOptions> = {},
) {
  // streamFn 通过单独路径注入:包到 options 里,prompt.ts 读 options.streamFn
  const { streamFn, handle } = createMockStreamFn(responses);
  const harness = new AgentHarness({
    ...makeOptions(options),
    // 临时用 as any,因为 options 没有 streamFn 字段(在 prompt.ts 中通过 options._streamFn 注入)
    ...({ streamFn } as any),
  });
  return { harness, handle };
}

describe("AgentHarness prompt()", () => {
  it("idle 状态下 prompt()正常工作,phase 转换后回到 idle", async () => {
    const { harness } = makeHarness([{ kind: "text", text: "hi" }]);
    expect(harness.getPhase()).toBe("idle");
    await harness.prompt("hello");
    expect(harness.getPhase()).toBe("idle");
  });

  it("prompt()过程中 phase 是 turn", async () => {
    // 模拟 LLM 慢响应,在 prompt 进行中检查 phase
    const slowStream = new (await import("@mimi/ai")).AssistantMessageEventStream();
    queueMicrotask(() => {
      slowStream.push({ type: "start", partial: makePartial() });
      slowStream.push({
        type: "text_start",
        contentIndex: 0,
        partial: makePartial(),
      });
      // 不推 done,让 turn 卡在中间
    });
    const harness = new AgentHarness({
      model: mockModel,
      tools: [],
      env: {} as any,
      session: {} as any,
      streamFn: () => slowStream,
    } as any);

    const p = harness.prompt("hello");
    // 异步开始后,phase 应该是 turn
    await new Promise((r) => setTimeout(r, 5));
    expect(harness.getPhase()).toBe("turn");
    // 关闭流
    slowStream.push({ type: "done", reason: "stop", message: withContent([{ type: "text", text: "x" }]) });
    await p;
    expect(harness.getPhase()).toBe("idle");
  });

  it("非 idle 状态下 prompt()抛 PhaseError", async () => {
    const { harness } = makeHarness([{ kind: "text", text: "hi" }]);
    // 手动把 phase 设为 turn,模拟正在进行的 turn
    harness._setPhase("turn");
    await expect(harness.prompt("x")).rejects.toThrow(PhaseError);
    // 清理:把 phase 还原,避免影响其他测试
    harness._setPhase("idle");
  });

  it("prompt()通过 _emit 转发事件到订阅者", async () => {
    const { harness } = makeHarness([{ kind: "text", text: "hi" }]);
    const events: AgentHarnessEvent[] = [];
    const sub = harness.subscribe();
    (async () => {
      for await (const evt of sub) {
        events.push(evt);
      }
    })();
    // 给订阅一点时间启动
    await new Promise((r) => setTimeout(r, 5));
    await harness.prompt("hello");
    // 给订阅一点时间拿到事件
    await new Promise((r) => setTimeout(r, 10));
    sub.cancel();

    // 应当看到 agent_start, turn_start, message_start/end(用户), message_start/end(assistant), turn_end, agent_end
    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain("agent_start");
    expect(eventTypes).toContain("turn_start");
    expect(eventTypes).toContain("agent_end");
  });

  it("prompt()完成后 phase 回到 idle(异常路径)", async () => {
    // 准备一个会出错的 streamFn
    const errorStream = new (await import("@mimi/ai")).AssistantMessageEventStream();
    queueMicrotask(() => {
      const errMsg = makePartial();
      errMsg.stopReason = "error";
      errMsg.errorMessage = "test error";
      errorStream.push({ type: "start", partial: errMsg });
      errorStream.push({ type: "error", reason: "error", error: errMsg });
    });
    const harness = new AgentHarness({
      model: mockModel,
      tools: [],
      env: {} as any,
      session: {} as any,
      streamFn: () => errorStream,
    } as any);

    await harness.prompt("x");
    // 即使 LLM 出错,phase 也应回 idle(错误通过 stopReason 表达,不是 throw)
    expect(harness.getPhase()).toBe("idle");
  });
});

// ── 辅助函数 ──

function makePartial(): import("@mimi/ai").AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: mockModel.api,
    provider: mockModel.provider,
    model: mockModel.id,
    usage: { input: 0, output: 0, totalTokens: 0, cost: { input: 0, output: 0, total: 0 } },
    stopReason: "stop",
    timestamp: 0,
  };
}

function withContent(
  content: import("@mimi/ai").AssistantMessage["content"],
): import("@mimi/ai").AssistantMessage {
  return { ...makePartial(), content };
}
