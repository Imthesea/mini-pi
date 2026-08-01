/**
 * 队列处理纯函数测试。
 *
 * 覆盖:
 * - enqueueSteer / enqueueFollowUp / enqueueNextTurn 的入队行为
 * - drainSteerQueue / drainFollowUpQueue 的 QueueMode 行为差异("all" / "one-at-a-time")
 * - drain 返回值结构(drained messages + remaining queue)
 * - 入队不修改原数组(不可变性)
 */

import { describe, expect, it } from "vitest";
import {
  drainFollowUpQueue,
  drainSteerQueue,
  enqueueFollowUp,
  enqueueNextTurn,
  enqueueSteer,
  type MessageQueue,
} from "../../src/harness/queue.js";
import type { AgentMessage } from "../../src/types.js";

// ── 辅助:构造 user 消息 ──

function userMsg(text: string): AgentMessage {
  return {
    role: "user",
    content: [{ type: "text", text }],
    timestamp: 0,
  };
}

describe("queue 纯函数", () => {
  describe("enqueueSteer", () => {
    it("空队列入队一条,返回单元素队列", () => {
      const result = enqueueSteer([], userMsg("hi"));
      expect(result).toEqual([userMsg("hi")]);
    });

    it("追加到现有队列尾部", () => {
      const queue = [userMsg("a"), userMsg("b")];
      const result = enqueueSteer(queue, userMsg("c"));
      expect(result).toEqual([userMsg("a"), userMsg("b"), userMsg("c")]);
    });

    it("不修改入参(不可变)", () => {
      const queue = [userMsg("a")];
      const snapshot = [...queue];
      enqueueSteer(queue, userMsg("b"));
      expect(queue).toEqual(snapshot);
    });
  });

  describe("enqueueFollowUp", () => {
    it("空队列入队一条,返回单元素队列", () => {
      const result = enqueueFollowUp([], userMsg("follow1"));
      expect(result).toEqual([userMsg("follow1")]);
    });

    it("追加到现有队列尾部", () => {
      const queue = [userMsg("a")];
      const result = enqueueFollowUp(queue, userMsg("b"));
      expect(result).toEqual([userMsg("a"), userMsg("b")]);
    });
  });

  describe("enqueueNextTurn", () => {
    it("空队列入队一条,返回单元素队列", () => {
      const result = enqueueNextTurn([], userMsg("preface"));
      expect(result).toEqual([userMsg("preface")]);
    });

    it("追加到现有队列尾部", () => {
      const queue = [userMsg("a")];
      const result = enqueueNextTurn(queue, userMsg("b"));
      expect(result).toEqual([userMsg("a"), userMsg("b")]);
    });
  });

  describe("drainSteerQueue", () => {
    it("空队列 drain 返回 {drained: [], remaining: []}", () => {
      const result = drainSteerQueue([], "all");
      expect(result.drained).toEqual([]);
      expect(result.remaining).toEqual([]);
    });

    it('mode="all" 排空全部消息', () => {
      const queue: AgentMessage[] = [userMsg("a"), userMsg("b"), userMsg("c")];
      const result = drainSteerQueue(queue, "all");
      expect(result.drained).toEqual([userMsg("a"), userMsg("b"), userMsg("c")]);
      expect(result.remaining).toEqual([]);
    });

    it('mode="one-at-a-time" 只取出第一条,剩余保留', () => {
      const queue: AgentMessage[] = [userMsg("a"), userMsg("b"), userMsg("c")];
      const result = drainSteerQueue(queue, "one-at-a-time");
      expect(result.drained).toEqual([userMsg("a")]);
      expect(result.remaining).toEqual([userMsg("b"), userMsg("c")]);
    });

    it("不修改入参队列(不可变)", () => {
      const queue: AgentMessage[] = [userMsg("a"), userMsg("b")];
      const snapshot = [...queue];
      drainSteerQueue(queue, "all");
      expect(queue).toEqual(snapshot);
    });

    it("连续 one-at-a-time 调用逐步排空", () => {
      let queue: AgentMessage[] = [userMsg("a"), userMsg("b"), userMsg("c")];
      const r1 = drainSteerQueue(queue, "one-at-a-time");
      queue = [...r1.remaining];
      const r2 = drainSteerQueue(queue, "one-at-a-time");
      queue = [...r2.remaining];
      const r3 = drainSteerQueue(queue, "one-at-a-time");
      expect(r1.drained).toEqual([userMsg("a")]);
      expect(r2.drained).toEqual([userMsg("b")]);
      expect(r3.drained).toEqual([userMsg("c")]);
      expect(r3.remaining).toEqual([]);
    });
  });

  describe("drainFollowUpQueue", () => {
    it("空队列 drain 返回 {drained: [], remaining: []}", () => {
      const result = drainFollowUpQueue([], "all");
      expect(result.drained).toEqual([]);
      expect(result.remaining).toEqual([]);
    });

    it('mode="all" 排空全部消息', () => {
      const queue: AgentMessage[] = [userMsg("a"), userMsg("b")];
      const result = drainFollowUpQueue(queue, "all");
      expect(result.drained).toEqual([userMsg("a"), userMsg("b")]);
      expect(result.remaining).toEqual([]);
    });

    it('mode="one-at-a-time" 只取出第一条,剩余保留', () => {
      const queue: AgentMessage[] = [userMsg("a"), userMsg("b")];
      const result = drainFollowUpQueue(queue, "one-at-a-time");
      expect(result.drained).toEqual([userMsg("a")]);
      expect(result.remaining).toEqual([userMsg("b")]);
    });
  });

  describe("drainNextTurnQueue", () => {
    it("空队列 drain 返回 {drained: [], remaining: []}", () => {
      const queue: MessageQueue = [];
      const result = drainFollowUpQueue(queue, "all");
      expect(result.drained).toEqual([]);
      expect(result.remaining).toEqual([]);
    });

    it("nextTurn 模式只支持 one-at-a-time(用 first 取一条)", () => {
      // nextTurn 没有 QueueMode 概念,只取 first 一条
      // 验证 enqueueNextTurn + 取 first 的协作
      let queue: MessageQueue = [];
      queue = enqueueNextTurn(queue, userMsg("a"));
      queue = enqueueNextTurn(queue, userMsg("b"));
      // 排空 first
      const first = queue[0];
      queue = queue.slice(1);
      expect(first).toEqual(userMsg("a"));
      expect(queue).toEqual([userMsg("b")]);
    });
  });

  describe("入队 + 排空协作", () => {
    it("先入队 3 条,再以 all 模式排空,得到 3 条", () => {
      let queue: MessageQueue = [];
      queue = enqueueSteer(queue, userMsg("a"));
      queue = enqueueSteer(queue, userMsg("b"));
      queue = enqueueSteer(queue, userMsg("c"));
      const { drained, remaining } = drainSteerQueue(queue, "all");
      expect(drained).toHaveLength(3);
      expect(remaining).toEqual([]);
    });

    it("三种队列互不影响", () => {
      let steer: MessageQueue = [];
      let follow: MessageQueue = [];
      let next: MessageQueue = [];
      steer = enqueueSteer(steer, userMsg("s"));
      follow = enqueueFollowUp(follow, userMsg("f"));
      next = enqueueNextTurn(next, userMsg("n"));
      expect(steer).toHaveLength(1);
      expect(follow).toHaveLength(1);
      expect(next).toHaveLength(1);
      expect(steer[0]).toEqual(userMsg("s"));
      expect(follow[0]).toEqual(userMsg("f"));
      expect(next[0]).toEqual(userMsg("n"));
    });
  });
});
