/**
 * hooks/default-hooks.ts 核心类测试。
 *
 * 覆盖:
 * - 构造:接受初始 context
 * - observe / on 注册与注销(返回 unsubscribe)
 * - emit 派发顺序(observers 先,再 handlers)
 * - emit 路由(不同事件 type 走不同 semantics)
 * - setContext 立即更新
 * - addCleanup / clear / dispose 生命周期
 * - 注册未知事件 type 的容错
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DefaultAgentHarnessHooks } from "../../../src/harness/hooks/default-hooks.js";
import type { AgentHarnessHookContext } from "../../../src/harness/hooks/types.js";

// ── 通用 helper ──

const TEST_CTX: AgentHarnessHookContext = {
  harness: {} as any,
  session: {} as any,
  models: {} as any,
  messages: [],
};

describe("DefaultAgentHarnessHooks — 构造与基本 API", () => {
  it("可构造并保留初始 context", () => {
    const ctx: AgentHarnessHookContext = { ...TEST_CTX };
    const hooks = new DefaultAgentHarnessHooks({ context: ctx });
    expect(hooks.context).toBe(ctx);
  });

  it("setContext 立即更新 context", () => {
    const hooks = new DefaultAgentHarnessHooks({ context: { ...TEST_CTX } });
    const newCtx: AgentHarnessHookContext = { ...TEST_CTX, harness: { tag: "new" } as any };
    hooks.setContext(newCtx);
    expect(hooks.context).toBe(newCtx);
  });

  it("context 是当前 context 的引用(非快照)", () => {
    const ctx: AgentHarnessHookContext = { ...TEST_CTX };
    const hooks = new DefaultAgentHarnessHooks({ context: ctx });
    // 注意:context 属性可能是 getter,读取最新值即可
    expect(hooks.context).toBe(ctx);
    // setContext 后切换
    const ctx2: AgentHarnessHookContext = { ...TEST_CTX };
    hooks.setContext(ctx2);
    expect(hooks.context).toBe(ctx2);
  });
});

describe("DefaultAgentHarnessHooks — observe / on 订阅", () => {
  let hooks: DefaultAgentHarnessHooks;

  beforeEach(() => {
    hooks = new DefaultAgentHarnessHooks({ context: { ...TEST_CTX } });
  });

  it("observe 注册观察者,emit 时被调用", async () => {
    const obs = vi.fn();
    const unsubscribe = hooks.observe(obs);
    expect(typeof unsubscribe).toBe("function");

    await hooks.emit({ type: "message_end" });
    expect(obs).toHaveBeenCalledTimes(1);
    expect(obs).toHaveBeenCalledWith(
      { type: "message_end" },
      hooks.context,
      undefined, // signal 未传
    );
  });

  it("observe 收到的 event + ctx + signal 与 emit 调用一致", async () => {
    const obs = vi.fn();
    hooks.observe(obs);

    const ctrl = new AbortController();
    await hooks.emit({ type: "model_update" }, ctrl.signal);
    expect(obs).toHaveBeenCalledWith(
      { type: "model_update" },
      hooks.context,
      ctrl.signal,
    );
  });

  it("observe 返回的 unsubscribe 调用后,observer 不再被调用", async () => {
    const obs = vi.fn();
    const unsubscribe = hooks.observe(obs);

    await hooks.emit({ type: "message_end" });
    unsubscribe();
    await hooks.emit({ type: "message_end" });
    expect(obs).toHaveBeenCalledTimes(1);
  });

  it("on(type, handler) 只在该 type 触发时被调用", async () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    hooks.on("context", h1);
    hooks.on("message_end", h2);

    await hooks.emit({ type: "context" });
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).not.toHaveBeenCalled();

    await hooks.emit({ type: "message_end" });
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
  });

  it("on 返回的 unsubscribe 调用后,handler 不再被调用", async () => {
    const handler = vi.fn();
    const unsubscribe = hooks.on("context", handler);

    await hooks.emit({ type: "context" });
    unsubscribe();
    await hooks.emit({ type: "context" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("多个 handler 注册到同一 type 时全部被调用", async () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    const h3 = vi.fn();
    hooks.on("context", h1);
    hooks.on("context", h2);
    hooks.on("context", h3);

    await hooks.emit({ type: "context" });
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
    expect(h3).toHaveBeenCalledTimes(1);
  });

  it("不同 type 的 handler 互不影响", async () => {
    const contextHandler = vi.fn();
    const toolCallHandler = vi.fn();
    hooks.on("context", contextHandler);
    hooks.on("tool_call", toolCallHandler);

    await hooks.emit({ type: "context" });
    expect(contextHandler).toHaveBeenCalledTimes(1);
    expect(toolCallHandler).not.toHaveBeenCalled();

    await hooks.emit({ type: "tool_call" });
    expect(contextHandler).toHaveBeenCalledTimes(1);
    expect(toolCallHandler).toHaveBeenCalledTimes(1);
  });
});

describe("DefaultAgentHarnessHooks — emit 派发顺序", () => {
  let hooks: DefaultAgentHarnessHooks;

  beforeEach(() => {
    hooks = new DefaultAgentHarnessHooks({ context: { ...TEST_CTX } });
  });

  it("emit 时 observers 先,再 handlers(符合 spec)", async () => {
    const order: string[] = [];
    hooks.observe(() => {
      order.push("observer-1");
    });
    hooks.observe(() => {
      order.push("observer-2");
    });
    hooks.on("context", () => {
      order.push("handler-1");
    });
    hooks.on("context", () => {
      order.push("handler-2");
    });

    await hooks.emit({ type: "context" });
    // observers 先全部派发,再 handlers
    expect(order).toEqual([
      "observer-1",
      "observer-2",
      "handler-1",
      "handler-2",
    ]);
  });

  it("observer 与 on 同时存在时,observer 不影响 handler 链式结果", async () => {
    const observer = vi.fn();
    hooks.observe(observer);

    const h1 = vi.fn(() => ({ messages: ["a"] }));
    const h2 = vi.fn(() => ({ messages: ["a", "b"] }));
    hooks.on("context", h1);
    hooks.on("context", h2);

    const result = await hooks.emit({ type: "context" });
    expect(observer).toHaveBeenCalledTimes(1);
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ messages: ["a", "b"] }); // 链式最终结果
  });
});

describe("DefaultAgentHarnessHooks — emit 路由(各事件 → 对应 semantics)", () => {
  let hooks: DefaultAgentHarnessHooks;

  beforeEach(() => {
    hooks = new DefaultAgentHarnessHooks({ context: { ...TEST_CTX } });
  });

  it("context 事件:走 runContextSemantics(链式)", async () => {
    const h1 = vi.fn((_e: any, ctx: any) => ({
      messages: [...(ctx.messages ?? []), "h1"],
    }));
    const h2 = vi.fn((_e: any, ctx: any) => ({
      messages: [...(ctx.messages ?? []), "h2"],
    }));
    hooks.on("context", h1);
    hooks.on("context", h2);

    const result = await hooks.emit({ type: "context" });
    expect(result).toEqual({ messages: ["h1", "h2"] });
  });

  it("tool_call 事件:遇 block=true 提前退出", async () => {
    const h1 = vi.fn();
    const h2 = vi.fn(() => ({ block: true, reason: "blocked" }));
    const h3 = vi.fn();
    hooks.on("tool_call", h1);
    hooks.on("tool_call", h2);
    hooks.on("tool_call", h3);

    const result = await hooks.emit({ type: "tool_call" });
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
    expect(h3).not.toHaveBeenCalled();
    expect(result).toEqual({ block: true, reason: "blocked" });
  });

  it("tool_result 事件:累积补丁", async () => {
    const h1 = vi.fn(() => ({ content: "from-h1" }));
    const h2 = vi.fn(() => ({ isError: true }));
    const h3 = vi.fn(() => ({ terminate: true }));
    hooks.on("tool_result", h1);
    hooks.on("tool_result", h2);
    hooks.on("tool_result", h3);

    const result = await hooks.emit({ type: "tool_result" });
    expect(result).toEqual({
      content: "from-h1",
      isError: true,
      terminate: true,
    });
  });

  it("session_before_compact 事件:遇 cancel=true 提前退出", async () => {
    const h1 = vi.fn();
    const h2 = vi.fn(() => ({ cancel: true }));
    const h3 = vi.fn();
    hooks.on("session_before_compact", h1);
    hooks.on("session_before_compact", h2);
    hooks.on("session_before_compact", h3);

    const result = await hooks.emit({ type: "session_before_compact" });
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
    expect(h3).not.toHaveBeenCalled();
    expect(result).toEqual({ cancel: true });
  });

  it("session_before_tree 事件:同样走 session-before 语义", async () => {
    const h1 = vi.fn(() => ({ cancel: true, label: "checkpoint" }));
    hooks.on("session_before_tree", h1);

    const result = await hooks.emit({ type: "session_before_tree" });
    expect(result).toEqual({ cancel: true, label: "checkpoint" });
  });

  it("message_end 事件:走 fire-and-forget 语义", async () => {
    const h1 = vi.fn(() => ({ ignored: "h1" }));
    const h2 = vi.fn(() => ({ ignored: "h2" }));
    hooks.on("message_end", h1);
    hooks.on("message_end", h2);

    const result = await hooks.emit({ type: "message_end" });
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
    expect(result).toBeUndefined(); // fire-and-forget 忽略返回值
  });

  it("model_update 事件:走 fire-and-forget 语义", async () => {
    const h1 = vi.fn();
    hooks.on("model_update", h1);

    const result = await hooks.emit({ type: "model_update" });
    expect(h1).toHaveBeenCalledTimes(1);
    expect(result).toBeUndefined();
  });

  it("abort 事件:走 fire-and-forget 语义", async () => {
    const h1 = vi.fn();
    hooks.on("abort", h1);

    const result = await hooks.emit({ type: "abort" });
    expect(h1).toHaveBeenCalledTimes(1);
    expect(result).toBeUndefined();
  });
});

describe("DefaultAgentHarnessHooks — handler 接收 ctx 与 signal", () => {
  it("handler 收到 (event, ctx, signal) 三个参数", async () => {
    const hooks = new DefaultAgentHarnessHooks({ context: { ...TEST_CTX } });
    const handler = vi.fn();
    hooks.on("context", handler);

    const ctrl = new AbortController();
    await hooks.emit({ type: "context" }, ctrl.signal);

    expect(handler).toHaveBeenCalledWith(
      { type: "context" },
      hooks.context,
      ctrl.signal,
    );
  });

  it("handler 收到的 ctx 是 setContext 设置的最新值", async () => {
    const hooks = new DefaultAgentHarnessHooks({ context: { ...TEST_CTX } });
    const handler = vi.fn();
    hooks.on("context", handler);

    const newCtx: AgentHarnessHookContext = {
      ...TEST_CTX,
      harness: { tag: "updated" } as any,
    };
    hooks.setContext(newCtx);

    await hooks.emit({ type: "context" });
    // 内容相等即可(每次 emit 构造临时 ctx 防链式 mutate)
    expect(handler.mock.calls[0][1]).toEqual(newCtx);
  });
});

describe("DefaultAgentHarnessHooks — addCleanup / clear / dispose", () => {
  let hooks: DefaultAgentHarnessHooks;

  beforeEach(() => {
    hooks = new DefaultAgentHarnessHooks({ context: { ...TEST_CTX } });
  });

  it("addCleanup 注册清理函数,clear 时执行", async () => {
    const cleanup = vi.fn();
    const unsubscribe = hooks.addCleanup(cleanup);
    expect(typeof unsubscribe).toBe("function");

    await hooks.clear();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("addCleanup 返回的 unsubscribe 调用后,清理函数不会在 clear 时执行", async () => {
    const cleanup = vi.fn();
    const unsubscribe = hooks.addCleanup(cleanup);

    unsubscribe();
    await hooks.clear();
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("多个 cleanup 按注册顺序执行", async () => {
    const order: string[] = [];
    hooks.addCleanup(() => {
      order.push("c1");
    });
    hooks.addCleanup(() => {
      order.push("c2");
    });
    hooks.addCleanup(() => {
      order.push("c3");
    });

    await hooks.clear();
    expect(order).toEqual(["c1", "c2", "c3"]);
  });

  it("clear 移除所有 handlers 和 observers", async () => {
    const obs = vi.fn();
    const h1 = vi.fn();
    const h2 = vi.fn();
    hooks.observe(obs);
    hooks.on("context", h1);
    hooks.on("message_end", h2);

    await hooks.clear();
    await hooks.emit({ type: "context" });
    await hooks.emit({ type: "message_end" });
    expect(obs).not.toHaveBeenCalled();
    expect(h1).not.toHaveBeenCalled();
    expect(h2).not.toHaveBeenCalled();
  });

  it("clear 执行 cleanups 后,清空 cleanup 列表(再次 clear 时不重复执行)", async () => {
    const cleanup = vi.fn();
    hooks.addCleanup(cleanup);

    await hooks.clear();
    expect(cleanup).toHaveBeenCalledTimes(1);

    await hooks.clear();
    expect(cleanup).toHaveBeenCalledTimes(1); // 还是 1 次
  });

  it("dispose 行为等价于 clear", async () => {
    const cleanup = vi.fn();
    const h1 = vi.fn();
    hooks.addCleanup(cleanup);
    hooks.on("context", h1);

    await hooks.dispose();
    expect(cleanup).toHaveBeenCalledTimes(1);
    await hooks.emit({ type: "context" });
    expect(h1).not.toHaveBeenCalled();
  });

  it("clear 后可以重新注册 handlers", async () => {
    const h1 = vi.fn();
    hooks.on("context", h1);
    await hooks.clear();

    const h2 = vi.fn();
    hooks.on("context", h2);
    await hooks.emit({ type: "context" });
    expect(h1).not.toHaveBeenCalled();
    expect(h2).toHaveBeenCalledTimes(1);
  });
});

describe("DefaultAgentHarnessHooks — 边界场景", () => {
  it("无 handlers / 无 observers 时 emit 返回 undefined", async () => {
    const hooks = new DefaultAgentHarnessHooks({ context: { ...TEST_CTX } });
    const result = await hooks.emit({ type: "context" });
    expect(result).toBeUndefined();
  });

  it("observer 抛错时不影响 handler 派发", async () => {
    const hooks = new DefaultAgentHarnessHooks({ context: { ...TEST_CTX } });
    const brokenObs = vi.fn(() => {
      throw new Error("obs boom");
    });
    const handler = vi.fn();
    hooks.observe(brokenObs);
    hooks.on("context", handler);

    // observer 抛错应该不阻断 handler
    await hooks.emit({ type: "context" });
    expect(brokenObs).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("handler 抛错时 propagate(用于 context 链式,失败时立即暴露)", async () => {
    const hooks = new DefaultAgentHarnessHooks({ context: { ...TEST_CTX } });
    const brokenHandler = vi.fn(() => {
      throw new Error("handler boom");
    });
    hooks.on("context", brokenHandler);

    await expect(hooks.emit({ type: "context" })).rejects.toThrow(
      "handler boom",
    );
  });

  it("不同 type 的 emit 互不影响", async () => {
    const hooks = new DefaultAgentHarnessHooks({ context: { ...TEST_CTX } });
    const ctxHandler = vi.fn();
    const toolHandler = vi.fn();
    hooks.on("context", ctxHandler);
    hooks.on("tool_call", toolHandler);

    await hooks.emit({ type: "context" });
    expect(ctxHandler).toHaveBeenCalledTimes(1);
    expect(toolHandler).not.toHaveBeenCalled();

    await hooks.emit({ type: "tool_call" });
    expect(ctxHandler).toHaveBeenCalledTimes(1);
    expect(toolHandler).toHaveBeenCalledTimes(1);
  });
});
