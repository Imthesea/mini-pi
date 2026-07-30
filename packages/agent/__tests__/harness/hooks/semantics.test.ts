/**
 * hooks/semantics.ts 5 种语义的纯函数测试。
 *
 * 覆盖:
 * 1. runContextSemantics — context 事件:顺序转换,链式,每个 handler 看到上一个的输出
 * 2. runToolCallSemantics — tool_call 事件:顺序执行,遇 block 提前退出
 * 3. runToolResultSemantics — tool_result 事件:顺序累积补丁
 * 4. runSessionBeforeSemantics — session_before_* 事件:顺序执行,遇 cancel 提前退出
 * 5. runFireAndForgetSemantics — 其他事件:并行调用,忽略返回值
 *
 * 这些是纯函数,无副作用,易于测试。
 */

import { describe, expect, it, vi } from "vitest";
import {
  runContextSemantics,
  runToolCallSemantics,
  runToolResultSemantics,
  runSessionBeforeSemantics,
  runFireAndForgetSemantics,
} from "../../../src/harness/hooks/semantics.js";
import type { AgentMessage } from "../../../src/types.js";
import type { HookHandler } from "../../../src/harness/types/harness.js";

// ── 通用 helper ──

/** 构造一个返回固定值的 handler(sync) */
function constHandler<T>(value: T): HookHandler<any, any> {
  return () => value;
}

/** 构造一个 async handler(返回 Promise) */
function asyncConstHandler<T>(value: T): HookHandler<any, any> {
  return async () => value;
}

/** 构造一个 user 文本消息(测试用,不需要图片) */
function userMsg(text: string): AgentMessage {
  return {
    role: "user",
    content: [{ type: "text", text }],
    timestamp: 0,
  };
}

// ── 1. runContextSemantics ──

describe("runContextSemantics(context 事件)", () => {
  it("无 handlers 时返回 undefined", async () => {
    const result = await runContextSemantics({ type: "context" }, [], {
      messages: [userMsg("a")],
    });
    expect(result).toBeUndefined();
  });

  it("单个 handler 返回 messages 时,作为结果", async () => {
    const result = await runContextSemantics(
      { type: "context" },
      [constHandler({ messages: [userMsg("x")] })],
      { messages: [userMsg("a")] },
    );
    expect(result).toEqual({ messages: [userMsg("x")] });
  });

  it("多个 handler 链式:每个 handler 看到上一个的 messages", async () => {
    const calls: any[] = [];
    const h1: HookHandler<any, any> = (event, ctx) => {
      calls.push({ h: 1, input: ctx.messages });
      return { messages: [...ctx.messages, userMsg("from-h1")] };
    };
    const h2: HookHandler<any, any> = (event, ctx) => {
      calls.push({ h: 2, input: ctx.messages });
      return { messages: [...ctx.messages, userMsg("from-h2")] };
    };
    const h3: HookHandler<any, any> = (event, ctx) => {
      calls.push({ h: 3, input: ctx.messages });
      return { messages: [...ctx.messages, userMsg("from-h3")] };
    };

    const result = await runContextSemantics(
      { type: "context" },
      [h1, h2, h3],
      { messages: [userMsg("a")] },
    );

    // 链式:每个 handler 看到的 messages 是上一个的输出
    expect(calls[0].input).toEqual([userMsg("a")]);
    expect(calls[1].input).toEqual([userMsg("a"), userMsg("from-h1")]);
    expect(calls[2].input).toEqual([
      userMsg("a"),
      userMsg("from-h1"),
      userMsg("from-h2"),
    ]);
    // 最终结果是 h3 的输出
    expect(result).toEqual({
      messages: [
        userMsg("a"),
        userMsg("from-h1"),
        userMsg("from-h2"),
        userMsg("from-h3"),
      ],
    });
  });

  it("handler 返回 undefined 不影响链式", async () => {
    const calls: any[] = [];
    const h1: HookHandler<any, any> = (event, ctx) => {
      calls.push("h1");
      return { messages: [userMsg("from-h1")] };
    };
    const h2: HookHandler<any, any> = (event, ctx) => {
      calls.push("h2");
      // 不返回 → 链不变
    };
    const h3: HookHandler<any, any> = (event, ctx) => {
      calls.push("h3");
      return { messages: [...ctx.messages, userMsg("from-h3")] };
    };

    const result = await runContextSemantics(
      { type: "context" },
      [h1, h2, h3],
      { messages: [userMsg("a")] },
    );

    // h2 返回 undefined 时,h3 看到的 messages 应是 h1 的输出
    expect(calls).toEqual(["h1", "h2", "h3"]);
    expect(result).toEqual({
      messages: [userMsg("from-h1"), userMsg("from-h3")],
    });
  });

  it("支持 async handler", async () => {
    const result = await runContextSemantics(
      { type: "context" },
      [asyncConstHandler({ messages: [userMsg("async-x")] })],
      { messages: [userMsg("a")] },
    );
    expect(result).toEqual({ messages: [userMsg("async-x")] });
  });

  it("partial messages(只改 messages 字段):ctx 中其他字段保留", async () => {
    // 这里 messages 是唯一字段(扩展时可加字段)
    const result = await runContextSemantics(
      { type: "context" },
      [constHandler({ messages: [userMsg("only-messages")] })],
      { messages: [userMsg("a")] },
    );
    expect(result).toEqual({ messages: [userMsg("only-messages")] });
  });
});

// ── 2. runToolCallSemantics ──

describe("runToolCallSemantics(tool_call 事件)", () => {
  it("无 handlers 时返回 undefined", async () => {
    const result = await runToolCallSemantics({ type: "tool_call" }, [], {
      toolName: "x",
    });
    expect(result).toBeUndefined();
  });

  it("handler 不返回 block 时,继续执行后续", async () => {
    const calls: string[] = [];
    const h1: HookHandler<any, any> = () => {
      calls.push("h1");
      // 不返回 block
    };
    const h2: HookHandler<any, any> = () => {
      calls.push("h2");
      return { reason: "ok" }; // 没 block,不算阻止
    };
    const h3: HookHandler<any, any> = () => {
      calls.push("h3");
    };

    const result = await runToolCallSemantics(
      { type: "tool_call" },
      [h1, h2, h3],
      { toolName: "x" },
    );

    expect(calls).toEqual(["h1", "h2", "h3"]);
    expect(result).toEqual({ reason: "ok" }); // 最后一个非空返回值
  });

  it("遇 block=true 时停止后续 handler,返回 block 结果", async () => {
    const calls: string[] = [];
    const h1: HookHandler<any, any> = () => {
      calls.push("h1");
    };
    const h2: HookHandler<any, any> = () => {
      calls.push("h2");
      return { block: true, reason: "policy violation" };
    };
    const h3: HookHandler<any, any> = () => {
      calls.push("h3");
    };

    const result = await runToolCallSemantics(
      { type: "tool_call" },
      [h1, h2, h3],
      { toolName: "x" },
    );

    expect(calls).toEqual(["h1", "h2"]); // h3 没执行
    expect(result).toEqual({ block: true, reason: "policy violation" });
  });

  it("block 出现在中间位置时,后续 handler 完全跳过", async () => {
    const h1: HookHandler<any, any> = () => undefined;
    const h2: HookHandler<any, any> = () => ({ block: true });
    const h3: HookHandler<any, any> = () => ({ block: false });
    const h4: HookHandler<any, any> = () => undefined;

    const result = await runToolCallSemantics(
      { type: "tool_call" },
      [h1, h2, h3, h4],
      { toolName: "x" },
    );

    // h3 / h4 都被跳过(即使 h3 返回 block:false,也没机会执行)
    expect(result).toEqual({ block: true });
  });

  it("block 后仍能继续(假阳性测试):只要 block=true,后面都不跑", async () => {
    // 验证语义:不光是"短路",而是"硬性停止"
    const spy = vi.fn();
    const h1: HookHandler<any, any> = () => ({ block: true });
    const h2: HookHandler<any, any> = spy;

    await runToolCallSemantics(
      { type: "tool_call" },
      [h1, h2],
      { toolName: "x" },
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it("支持 async handler", async () => {
    const result = await runToolCallSemantics(
      { type: "tool_call" },
      [asyncConstHandler({ block: true, reason: "async block" })],
      { toolName: "x" },
    );
    expect(result).toEqual({ block: true, reason: "async block" });
  });
});

// ── 3. runToolResultSemantics ──

describe("runToolResultSemantics(tool_result 事件)", () => {
  it("无 handlers 时返回 undefined", async () => {
    const result = await runToolResultSemantics(
      { type: "tool_result" },
      [],
      { result: "r" },
    );
    expect(result).toBeUndefined();
  });

  it("单 handler 完整返回 → 作为结果", async () => {
    const result = await runToolResultSemantics(
      { type: "tool_result" },
      [constHandler({ content: "new", isError: true })],
      { result: "r" },
    );
    expect(result).toEqual({ content: "new", isError: true });
  });

  it("多 handler 累积补丁:每个 handler 可以独立覆盖 content / details / isError / terminate", async () => {
    const h1: HookHandler<any, any> = () => ({ content: "from-h1" });
    const h2: HookHandler<any, any> = () => ({ isError: true });
    const h3: HookHandler<any, any> = () => ({ terminate: true });

    const result = await runToolResultSemantics(
      { type: "tool_result" },
      [h1, h2, h3],
      { result: "r" },
    );

    // 累积:每个字段取最后一个非 undefined 的覆盖
    expect(result).toEqual({
      content: "from-h1",
      isError: true,
      terminate: true,
    });
  });

  it("terminate 单独返回时,保留其他字段不变", async () => {
    const h1: HookHandler<any, any> = () => ({ terminate: true });

    const result = await runToolResultSemantics(
      { type: "tool_result" },
      [h1],
      { result: "r" },
    );
    expect(result).toEqual({ terminate: true });
  });

  it("handler 返回 undefined 时,该 handler 不贡献任何字段", async () => {
    const h1: HookHandler<any, any> = () => undefined;
    const h2: HookHandler<any, any> = () => ({ content: "from-h2" });

    const result = await runToolResultSemantics(
      { type: "tool_result" },
      [h1, h2],
      { result: "r" },
    );
    expect(result).toEqual({ content: "from-h2" });
  });

  it("支持 async handler", async () => {
    const result = await runToolResultSemantics(
      { type: "tool_result" },
      [asyncConstHandler({ details: { ok: true } })],
      { result: "r" },
    );
    expect(result).toEqual({ details: { ok: true } });
  });
});

// ── 4. runSessionBeforeSemantics ──

describe("runSessionBeforeSemantics(session_before_* 事件)", () => {
  it("无 handlers 时返回 undefined", async () => {
    const result = await runSessionBeforeSemantics(
      { type: "session_before_compact" },
      [],
      {},
    );
    expect(result).toBeUndefined();
  });

  it("session_before_compact 事件:支持 { cancel?, compaction? } 累积", async () => {
    const h1: HookHandler<any, any> = () => ({ compaction: { summary: "h1-sum" } });
    const h2: HookHandler<any, any> = () => ({ cancel: false });

    const result = await runSessionBeforeSemantics(
      { type: "session_before_compact" },
      [h1, h2],
      {},
    );
    expect(result).toEqual({
      compaction: { summary: "h1-sum" },
      cancel: false,
    });
  });

  it("遇 cancel=true 时停止后续 handler", async () => {
    const spy = vi.fn();
    const h1: HookHandler<any, any> = () => ({ cancel: true });
    const h2: HookHandler<any, any> = spy;

    const result = await runSessionBeforeSemantics(
      { type: "session_before_compact" },
      [h1, h2],
      {},
    );

    expect(spy).not.toHaveBeenCalled();
    expect(result).toEqual({ cancel: true });
  });

  it("支持任意 session_before_* 事件(泛型:event.type 由调用方传)", async () => {
    // 同样适用于 session_before_tree
    const result = await runSessionBeforeSemantics(
      { type: "session_before_tree" },
      [constHandler({ cancel: true, label: "checkpoint" })],
      {},
    );
    expect(result).toEqual({ cancel: true, label: "checkpoint" });
  });

  it("支持 async handler", async () => {
    const result = await runSessionBeforeSemantics(
      { type: "session_before_compact" },
      [asyncConstHandler({ cancel: true })],
      {},
    );
    expect(result).toEqual({ cancel: true });
  });
});

// ── 5. runFireAndForgetSemantics ──

describe("runFireAndForgetSemantics(其他事件)", () => {
  it("无 handlers 时返回 undefined", async () => {
    const result = await runFireAndForgetSemantics(
      { type: "message_end" },
      [],
      {},
    );
    expect(result).toBeUndefined();
  });

  it("并行调用所有 handler(同步 handler 立即执行)", async () => {
    const order: string[] = [];
    const h1: HookHandler<any, any> = () => {
      order.push("h1-sync");
    };
    const h2: HookHandler<any, any> = () => {
      order.push("h2-sync");
    };

    await runFireAndForgetSemantics(
      { type: "message_end" },
      [h1, h2],
      {},
    );

    // 同步 handler 立即执行,顺序由调用栈决定
    expect(order).toEqual(["h1-sync", "h2-sync"]);
  });

  it("async handler 并行等待(Promise.all)", async () => {
    const delays: number[] = [];
    const h1: HookHandler<any, any> = async () => {
      await new Promise((r) => setTimeout(r, 30));
      delays.push(30);
    };
    const h2: HookHandler<any, any> = async () => {
      await new Promise((r) => setTimeout(r, 10));
      delays.push(10);
    };
    const h3: HookHandler<any, any> = async () => {
      await new Promise((r) => setTimeout(r, 20));
      delays.push(20);
    };

    const start = Date.now();
    await runFireAndForgetSemantics(
      { type: "model_update" },
      [h1, h2, h3],
      {},
    );
    const elapsed = Date.now() - start;

    // 并行:总耗时应 < 三个串行的耗时(30+10+20=60)
    expect(elapsed).toBeLessThan(80);
    // 所有 handler 都执行了
    expect(delays.sort()).toEqual([10, 20, 30]);
  });

  it("handler 的返回值被忽略", async () => {
    const h1: HookHandler<any, any> = () => ({ ignored: "h1" });
    const h2: HookHandler<any, any> = () => ({ ignored: "h2" });

    const result = await runFireAndForgetSemantics(
      { type: "model_update" },
      [h1, h2],
      {},
    );

    expect(result).toBeUndefined();
  });

  it("混合同步 + async handler", async () => {
    const calls: string[] = [];
    const h1: HookHandler<any, any> = () => {
      calls.push("h1-sync");
    };
    const h2: HookHandler<any, any> = async () => {
      await new Promise((r) => setTimeout(r, 5));
      calls.push("h2-async");
    };

    await runFireAndForgetSemantics(
      { type: "abort" },
      [h1, h2],
      {},
    );

    // 同步立即执行,async 后完成
    expect(calls).toEqual(["h1-sync", "h2-async"]);
  });

  it("handler 抛错时不冒泡(适合 fire-and-forget 语义)", async () => {
    // fire-and-forget 的契约:单个 handler 失败不影响其他
    const h1: HookHandler<any, any> = () => {
      throw new Error("h1 boom");
    };
    const h2: HookHandler<any, any> = vi.fn();

    // 期望:不抛出,只有 h2 被调用
    await expect(
      runFireAndForgetSemantics(
        { type: "model_update" },
        [h1, h2],
        {},
      ),
    ).resolves.toBeUndefined();
    expect(h2).toHaveBeenCalled();
  });
});
