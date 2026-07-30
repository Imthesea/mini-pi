/**
 * harness/messages/custom.ts 的单元测试。
 *
 * custom.ts 是"自定义消息投影器"集合:
 * 把声明合并进来的 custom 消息(目前是 notification / bashExecution /
 * branchSummary 等)按规则投影成 user 消息或直接丢弃。
 *
 * Task 3 阶段只暴露核心 API:
 * - mapCustomToUserMessages(messages): 默认把所有 custom 消息映射为 user 消息
 * - getDefaultCustomProjector(): 返回一个默认 projector
 *
 * 具体 custom 消息类型的"渲染规则"留到后续 Task(8: 自定义消息演示)。
 */

import { describe, expect, it } from "vitest";
import {
  getDefaultCustomProjector,
  mapCustomToUserMessages,
} from "../../../src/harness/messages/custom.js";
import type { AgentMessage } from "../../../src/types.js";

describe("harness/messages/custom", () => {
  describe("mapCustomToUserMessages", () => {
    it("空列表 → 空列表", () => {
      expect(mapCustomToUserMessages([])).toEqual([]);
    });

    it("非 custom 消息保持原样", () => {
      const user: AgentMessage = { role: "user", content: "hi", timestamp: 1 };
      expect(mapCustomToUserMessages([user])).toEqual([user]);
    });

    it("custom 消息:Task 3 阶段无已知 type,默认返回空(留待 Task 8)", () => {
      const custom = {
        role: "custom",
        customType: "notification",
        title: "t",
        body: "b",
        timestamp: 1,
      } as unknown as AgentMessage;
      // 默认 projector 不识别任何 customType,跳过(返回空数组)
      expect(mapCustomToUserMessages([custom])).toEqual([]);
    });

    it("混合:user + custom + user → user + user(custom 被默认跳过)", () => {
      const u1: AgentMessage = { role: "user", content: "a", timestamp: 1 };
      const custom = {
        role: "custom",
        customType: "x",
        data: "y",
        timestamp: 2,
      } as unknown as AgentMessage;
      const u2: AgentMessage = { role: "user", content: "b", timestamp: 3 };
      expect(mapCustomToUserMessages([u1, custom, u2])).toEqual([u1, u2]);
    });
  });

  describe("getDefaultCustomProjector", () => {
    it("返回的 projector 是函数,签名匹配 (msg) => AgentMessage[]", () => {
      const projector = getDefaultCustomProjector();
      expect(typeof projector).toBe("function");
      const custom = {
        role: "custom",
        customType: "notification",
        title: "t",
        body: "b",
        timestamp: 1,
      } as unknown as AgentMessage;
      // 默认 projector 对未知 customType 返回 []
      expect(projector(custom)).toEqual([]);
    });

    it("非 custom 消息的 projector 调用应当不被支持(调用方需先判 role)", () => {
      // 约定:projector 只处理 custom 消息,调用方负责判 role
      // 这里只验证它对 custom 消息的默认行为
      const projector = getDefaultCustomProjector();
      const custom = {
        role: "custom",
        customType: "x",
      } as unknown as AgentMessage;
      expect(projector(custom)).toEqual([]);
    });
  });
});
