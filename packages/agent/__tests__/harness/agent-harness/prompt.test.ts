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
import { AssistantMessageEventStream } from "@mimi/ai";
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
    // Task 5 接入 session 后,harness 会调 session.appendMessage
    // 测试用 mock session:实现 appendMessage 等方法,记录调用
    session: makeMockSession(),
    ...rest,
  };
}

/**
 * 测试用 mock session。
 *
 * Task 5 接入后,harness 会调:
 * - session.appendMessage(message)  →  push 到 messages 数组
 * - session.getMetadata()           →  返回固定 id
 * - session.buildContext()          →  返回 messages 包装
 */
function makeMockSession(id = "sess-1") {
  const messages: any[] = [];
  return {
    id,
    appendMessage: vi.fn(async (msg: any) => {
      messages.push(msg);
    }),
    getMetadata: vi.fn(async () => ({ id, createdAt: new Date().toISOString() })),
    buildContext: vi.fn(async () => ({ messages: [...messages] })),
    getLeafId: vi.fn(async () => null),
    setLeafId: vi.fn(async () => {}),
    getEntries: vi.fn(async () => []),
    // 给测试断言用
    _messages: messages,
  } as any;
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
      session: makeMockSession(),
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
      session: makeMockSession(),
      streamFn: () => errorStream,
    } as any);

    await harness.prompt("x");
    // 即使 LLM 出错,phase 也应回 idle(错误通过 stopReason 表达,不是 throw)
    expect(harness.getPhase()).toBe("idle");
  });
});

// ── Task 8 增量:steer / followUp / nextTurn 队列方法测试 ──

describe("AgentHarness steer / followUp / nextTurn", () => {
  /**
   * 工具:构造最小可用 harness(mock session + 默认 streamFn)。
   * 不调 prompt,只测队列操作。
   */
  function makeHarness() {
    return new AgentHarness({
      model: mockModel,
      tools: [],
      env: {} as any,
      session: makeMockSession(),
    });
  }

  describe("steer 入队", () => {
    it("调一次 steer,内部队列有 1 条", () => {
      const h = makeHarness();
      h.steer("修正方向");
      // 队列是 private 字段,测试通过下划线前缀的内部方法 _drainSteerQueue 访问
      const drained = h._drainSteerQueue();
      expect(drained).toHaveLength(1);
      // 无 images 时 content 是纯文本字符串
      expect(drained[0].role).toBe("user");
      expect((drained[0] as any).content).toBe("修正方向");
    });

    it("连续 steer 3 次,mode='all' 排空出 3 条", () => {
      const h = makeHarness();
      h.steer("a");
      h.steer("b");
      h.steer("c");
      const drained = h._drainSteerQueue();
      expect(drained).toHaveLength(3);
      expect((drained[0] as any).content).toBe("a");
      expect((drained[2] as any).content).toBe("c");
    });

    it("mode='one-at-a-time' 排空只出 1 条,剩余 2 条保留", () => {
      const h = makeHarness();
      h.setSteeringMode("one-at-a-time");
      h.steer("a");
      h.steer("b");
      h.steer("c");
      const drained1 = h._drainSteerQueue();
      expect(drained1).toHaveLength(1);
      expect((drained1[0] as any).content).toBe("a");
      // 第二次排空取 b
      const drained2 = h._drainSteerQueue();
      expect(drained2).toHaveLength(1);
      expect((drained2[0] as any).content).toBe("b");
    });

    it("steer 后队列再排空返回 []", () => {
      const h = makeHarness();
      h.steer("hi");
      h._drainSteerQueue();
      const drained = h._drainSteerQueue();
      expect(drained).toEqual([]);
    });

    it("steer 不影响 phase(可在任意 phase 调,不会切 phase)", () => {
      const h = makeHarness();
      h._setPhase("turn");
      expect(() => h.steer("插队")).not.toThrow();
      // 切 turn 后 steer 不会改 phase
      expect(h.getPhase()).toBe("turn");
      h._setPhase("idle");
    });
  });

  describe("followUp 入队", () => {
    it("调一次 followUp,_drainFollowUpQueue 出 1 条", () => {
      const h = makeHarness();
      h.followUp("后续问题");
      const drained = h._drainFollowUpQueue();
      expect(drained).toHaveLength(1);
      expect(drained[0].role).toBe("user");
      expect((drained[0] as any).content).toBe("后续问题");
    });

    it("followUpMode='one-at-a-time' 排空只出 1 条", () => {
      const h = makeHarness();
      h.setFollowUpMode("one-at-a-time");
      h.followUp("a");
      h.followUp("b");
      const drained = h._drainFollowUpQueue();
      expect(drained).toHaveLength(1);
      expect((drained[0] as any).content).toBe("a");
      const drained2 = h._drainFollowUpQueue();
      expect(drained2).toHaveLength(1);
      expect((drained2[0] as any).content).toBe("b");
    });
  });

  describe("nextTurn 入队", () => {
    it("调一次 nextTurn,_drainNextTurnQueue 出 1 条", () => {
      const h = makeHarness();
      h.nextTurn("下次记得");
      const drained = h._drainNextTurnQueue();
      expect(drained).toHaveLength(1);
      expect(drained[0].role).toBe("user");
      expect((drained[0] as any).content).toBe("下次记得");
    });

    it("nextTurn 多次入队,排空按顺序出全部", () => {
      const h = makeHarness();
      h.nextTurn("first");
      h.nextTurn("second");
      h.nextTurn("third");
      const drained = h._drainNextTurnQueue();
      expect(drained).toHaveLength(3);
      expect((drained[0] as any).content).toBe("first");
      expect((drained[2] as any).content).toBe("third");
    });

    it("nextTurn 排空后队列为空,再次排空返回 []", () => {
      const h = makeHarness();
      h.nextTurn("hi");
      h._drainNextTurnQueue();
      const drained = h._drainNextTurnQueue();
      expect(drained).toEqual([]);
    });
  });

  describe("三种队列互不影响", () => {
    it("steer / followUp / nextTurn 各管各的", () => {
      const h = makeHarness();
      h.steer("s1");
      h.followUp("f1");
      h.nextTurn("n1");
      expect(h._drainSteerQueue()).toHaveLength(1);
      expect(h._drainFollowUpQueue()).toHaveLength(1);
      expect(h._drainNextTurnQueue()).toHaveLength(1);
      // 各自再排空为空
      expect(h._drainSteerQueue()).toEqual([]);
      expect(h._drainFollowUpQueue()).toEqual([]);
      expect(h._drainNextTurnQueue()).toEqual([]);
    });
  });

  describe("queue_update 钩子触发", () => {
    it("steer 触发 queue_update 钩子", async () => {
      const h = makeHarness();
      const fired: string[] = [];
      h.getHooks().on("queue_update", () => {
        fired.push("queue_update");
        return undefined;
      });
      h.steer("hi");
      // emit 是 fire-and-forget,等一拍
      await new Promise((r) => setTimeout(r, 10));
      expect(fired).toContain("queue_update");
    });

    it("followUp 触发 queue_update 钩子", async () => {
      const h = makeHarness();
      const fired: string[] = [];
      h.getHooks().on("queue_update", () => {
        fired.push("queue_update");
        return undefined;
      });
      h.followUp("hi");
      await new Promise((r) => setTimeout(r, 10));
      expect(fired).toContain("queue_update");
    });

    it("nextTurn 触发 queue_update 钩子", async () => {
      const h = makeHarness();
      const fired: string[] = [];
      h.getHooks().on("queue_update", () => {
        fired.push("queue_update");
        return undefined;
      });
      h.nextTurn("hi");
      await new Promise((r) => setTimeout(r, 10));
      expect(fired).toContain("queue_update");
    });
  });

  describe("nextTurn 集成到 prompt 入口", () => {
    it("prompt 之前 nextTurn 消息 prepend 到 user 消息前(LLM 看到正确顺序)", async () => {
      // 用自定义 streamFn 捕获 LLM 看到的 context.messages
      // 记录所有调用的 context,取第一次(初始 LLM 调用)
      const capturedContexts: any[] = [];
      const captureStreamFn: any = (_model: any, context: any) => {
        capturedContexts.push(context);
        // 返回一个简单的 done 流
        const stream = new AssistantMessageEventStream();
        queueMicrotask(() => {
          const msg = makePartial();
          msg.content = [{ type: "text", text: "ok" }];
          stream.push({ type: "start", partial: msg });
          stream.push({ type: "text_start", contentIndex: 0, partial: msg });
          stream.push({ type: "text_end", contentIndex: 0, content: "ok", partial: msg });
          stream.push({ type: "done", reason: "stop", message: msg });
        });
        return stream;
      };

      const h = new AgentHarness({
        model: mockModel,
        tools: [],
        env: {} as any,
        session: makeMockSession(),
        streamFn: captureStreamFn,
      } as any);
      h.nextTurn("前置 A");
      h.nextTurn("前置 B");

      await h.prompt("user-text");

      // LLM 第一次调用看到的 messages 头三条应是 [前置 A, 前置 B, user-text]
      expect(capturedContexts.length).toBeGreaterThan(0);
      const llmMessages = capturedContexts[0].messages;
      expect(llmMessages.length).toBeGreaterThanOrEqual(3);
      // 验证 nextTurn 消息 prepend 到 user 之前
      expect((llmMessages[0] as any).content).toBe("前置 A");
      expect((llmMessages[1] as any).content).toBe("前置 B");
      expect((llmMessages[2] as any).content).toBe("user-text");
    });

    it("prompt 消费 nextTurn 后,再 nextTurn 排空返回 []", async () => {
      const h = new AgentHarness({
        model: mockModel,
        tools: [],
        env: {} as any,
        session: makeMockSession(),
        streamFn: createMockStreamFn([{ kind: "text", text: "ok" }]).streamFn,
      } as any);
      h.nextTurn("ctx");
      await h.prompt("hi");
      // 消费后 nextTurn 队列空
      const drained = h._drainNextTurnQueue();
      expect(drained).toEqual([]);
    });
  });

  describe("dispose 后抛错", () => {
    it("dispose 后 steer 抛错", () => {
      const h = makeHarness();
      h.dispose();
      expect(() => h.steer("x")).toThrow(/dispose/i);
    });

    it("dispose 后 followUp 抛错", () => {
      const h = makeHarness();
      h.dispose();
      expect(() => h.followUp("x")).toThrow(/dispose/i);
    });

    it("dispose 后 nextTurn 抛错", () => {
      const h = makeHarness();
      h.dispose();
      expect(() => h.nextTurn("x")).toThrow(/dispose/i);
    });

    it("dispose 后清空所有队列", () => {
      const h = makeHarness();
      h.steer("s");
      h.followUp("f");
      h.nextTurn("n");
      h.dispose();
      expect(h._drainSteerQueue()).toEqual([]);
      expect(h._drainFollowUpQueue()).toEqual([]);
      expect(h._drainNextTurnQueue()).toEqual([]);
    });
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
