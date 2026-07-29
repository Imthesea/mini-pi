/**
 * EventStream 和 AssistantMessageEventStream 的单元测试。
 */
import { describe, it, expect } from "vitest";
import { EventStream, AssistantMessageEventStream } from "../stream/index.js";
import type { AssistantMessage } from "../types.js";

describe("EventStream", () => {
  it("推送事件后可以异步迭代消费", async () => {
    const stream = new EventStream<number, number>(
      (n) => n === 999,  // 999 是终端标记
      (n) => n,
    );

    stream.push(1);
    stream.push(2);
    stream.push(999);  // 终端

    const received: number[] = [];
    for await (const event of stream) {
      received.push(event);
    }

    expect(received).toEqual([1, 2, 999]);
  });

  it("通过 result() 获取最终结果", async () => {
    const stream = new EventStream<string, string>(
      (s) => s.startsWith("DONE:"),
      (s) => s.slice(5),  // 去掉 "DONE:" 前缀
    );

    stream.push("hello");
    stream.push("DONE:world");

    const result = await stream.result();
    expect(result).toBe("world");
  });

  it("手动 end() 结束流", async () => {
    const stream = new EventStream<string, string>(
      () => false,
      () => "never",
    );

    stream.push("a");
    stream.end("manual_result");

    const received: string[] = [];
    for await (const event of stream) {
      received.push(event);
    }

    expect(received).toEqual(["a"]);
    expect(await stream.result()).toBe("manual_result");
  });

  it("done 后再 push 不会影响 result", async () => {
    const stream = new EventStream<number, number>(
      (n) => n > 0,
      (n) => n,
    );

    stream.push(1);  // 终端
    stream.push(2);  // 被忽略

    expect(await stream.result()).toBe(1);
  });
});

describe("AssistantMessageEventStream", () => {
  it("done 事件返回 message，error 事件返回 error", async () => {
    // 测试 done
    const doneMsg: AssistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: "hi" }],
      api: "anthropic-messages" as const,
      provider: "anthropic",
      model: "claude",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop",
      timestamp: Date.now(),
    };

    const stream1 = new AssistantMessageEventStream();
    stream1.push({ type: "done", reason: "stop", message: doneMsg });
    expect(await stream1.result()).toBe(doneMsg);

    // 测试 error
    const errorMsg: AssistantMessage = {
      ...doneMsg,
      stopReason: "error",
      errorMessage: "网络错误",
    };

    const stream2 = new AssistantMessageEventStream();
    stream2.push({ type: "error", reason: "error", error: errorMsg });
    expect(await stream2.result()).toBe(errorMsg);
  });
});
