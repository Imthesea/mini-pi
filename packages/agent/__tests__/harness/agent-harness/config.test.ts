/**
 * AgentHarness 配置管理测试。
 *
 * 覆盖 getXxx / setXxx 行为:
 * - getModel / getTools / getThinkingLevel / getSession / getResources / getStreamOptions
 * - setModel / setTools / setThinkingLevel / setResources / setStreamOptions
 * - setter 立即生效,影响下一个 turn,不影响当前 turn
 * - setter 不会抛错(已构造的 harness)
 * - Task 8:QueueMode getter / setter(steeringMode / followUpMode)
 */

import { describe, expect, it } from "vitest";
import { AgentHarness } from "../../../src/harness/agent-harness/agent-harness.js";
import { createMockStreamFn, mockModel } from "../../_helpers/mock-provider.js";
import type {
  AgentHarnessOptions,
} from "../../../src/harness/types/options.js";
import type { Model } from "@mimi/ai";
import type { Skill } from "../../../src/harness/types/harness.js";

function makeOptions(overrides: Partial<AgentHarnessOptions> = {}): AgentHarnessOptions {
  return {
    model: mockModel,
    tools: [],
    env: { readFile: async () => ({ ok: true, value: "" }) } as any,
    session: { id: "sess-1" } as any,
    thinkingLevel: "medium",
    ...overrides,
  };
}

describe("AgentHarness config", () => {
  describe("getters", () => {
    it("getModel 返回构造时的 model", () => {
      const h = new AgentHarness(makeOptions());
      expect(h.getModel()).toBe(mockModel);
    });

    it("getTools 返回构造时的 tools", () => {
      const tools = [
        { name: "echo", label: "Echo", description: "x", parameters: {} as any, execute: async () => ({ content: [], details: {} }) },
      ];
      const h = new AgentHarness(makeOptions({ tools }));
      expect(h.getTools()).toBe(tools);
    });

    it("getThinkingLevel 返回构造时的 thinkingLevel", () => {
      const h = new AgentHarness(makeOptions({ thinkingLevel: "high" }));
      expect(h.getThinkingLevel()).toBe("high");
    });

    it("getSession 返回构造时的 session", () => {
      const session = { id: "test-session" } as any;
      const h = new AgentHarness(makeOptions({ session }));
      expect(h.getSession()).toBe(session);
    });

    it("getResources 返回构造时的 resources(可空)", () => {
      const h = new AgentHarness(makeOptions());
      // 未传 resources → 返回 undefined 或空对象
      const r = h.getResources();
      expect(r === undefined || (r && !r.skills && !r.promptTemplates)).toBe(true);
    });

    it("getStreamOptions 返回构造时的 streamOptions", () => {
      const h = new AgentHarness(
        makeOptions({ streamOptions: { temperature: 0.5, maxTokens: 100 } }),
      );
      expect(h.getStreamOptions()?.temperature).toBe(0.5);
      expect(h.getStreamOptions()?.maxTokens).toBe(100);
    });

    it("getSystemPrompt 返回构造时的 systemPrompt", () => {
      const h = new AgentHarness(
        makeOptions({ systemPrompt: "你是助手。" }),
      );
      expect(h.getSystemPrompt()).toBe("你是助手。");
    });
  });

  describe("setters", () => {
    it("setModel 立即生效,后续 getModel 返回新值", () => {
      const h = new AgentHarness(makeOptions());
      const newModel: Model<any> = { ...mockModel, id: "new-model" };
      h.setModel(newModel);
      expect(h.getModel()).toBe(newModel);
    });

    it("setTools 立即生效,后续 getTools 返回新数组", () => {
      const h = new AgentHarness(makeOptions());
      const tools = [
        { name: "t1", label: "T1", description: "d", parameters: {} as any, execute: async () => ({ content: [], details: {} }) },
      ];
      h.setTools(tools);
      expect(h.getTools()).toBe(tools);
    });

    it("setThinkingLevel 立即生效", () => {
      const h = new AgentHarness(makeOptions({ thinkingLevel: "low" }));
      h.setThinkingLevel("high");
      expect(h.getThinkingLevel()).toBe("high");
    });

    it("setResources 立即生效,后续 getResources 返回新值", () => {
      const h = new AgentHarness(makeOptions());
      const skills: Skill[] = [
        { name: "s1", description: "d1", content: "c1" },
      ];
      h.setResources({ skills });
      expect(h.getResources()?.skills).toBe(skills);
    });

    it("setStreamOptions 立即生效", () => {
      const h = new AgentHarness(makeOptions());
      h.setStreamOptions({ temperature: 0.9 });
      expect(h.getStreamOptions()?.temperature).toBe(0.9);
    });
  });

  describe("setter 语义", () => {
    it("setter 不影响当前 turn 状态(getPhase 仍为 idle)", () => {
      const h = new AgentHarness(makeOptions());
      h.setModel({ ...mockModel, id: "x" });
      h.setTools([]);
      h.setThinkingLevel("off");
      expect(h.getPhase()).toBe("idle");
    });

    it("setter 不抛错(已 dispose 的 harness 抛错,正常 harness 不抛)", () => {
      const h = new AgentHarness(makeOptions());
      expect(() => h.setModel(mockModel)).not.toThrow();
      expect(() => h.setTools([])).not.toThrow();
      expect(() => h.setThinkingLevel("low")).not.toThrow();
      expect(() => h.setResources({})).not.toThrow();
      expect(() => h.setStreamOptions({})).not.toThrow();
    });
  });

  // ── Task 8 增量:QueueMode getter / setter ──

  describe("QueueMode 默认值", () => {
    it("getSteeringMode 默认 'all'", () => {
      const h = new AgentHarness(makeOptions());
      expect(h.getSteeringMode()).toBe("all");
    });

    it("getFollowUpMode 默认 'all'", () => {
      const h = new AgentHarness(makeOptions());
      expect(h.getFollowUpMode()).toBe("all");
    });

    it("steeringMode 构造时设置,getter 立即生效", () => {
      const h = new AgentHarness(makeOptions({ steeringMode: "one-at-a-time" }));
      expect(h.getSteeringMode()).toBe("one-at-a-time");
    });

    it("followUpMode 构造时设置,getter 立即生效", () => {
      const h = new AgentHarness(makeOptions({ followUpMode: "one-at-a-time" }));
      expect(h.getFollowUpMode()).toBe("one-at-a-time");
    });
  });

  describe("QueueMode setter", () => {
    it("setSteeringMode 改变 mode,getter 读到新值", () => {
      const h = new AgentHarness(makeOptions());
      h.setSteeringMode("one-at-a-time");
      expect(h.getSteeringMode()).toBe("one-at-a-time");
      h.setSteeringMode("all");
      expect(h.getSteeringMode()).toBe("all");
    });

    it("setFollowUpMode 改变 mode,getter 读到新值", () => {
      const h = new AgentHarness(makeOptions());
      h.setFollowUpMode("one-at-a-time");
      expect(h.getFollowUpMode()).toBe("one-at-a-time");
      h.setFollowUpMode("all");
      expect(h.getFollowUpMode()).toBe("all");
    });

    it("setSteeringMode 不影响 followUpMode(各自独立)", () => {
      const h = new AgentHarness(makeOptions());
      h.setSteeringMode("one-at-a-time");
      expect(h.getFollowUpMode()).toBe("all");
    });

    it("setFollowUpMode 不影响 steeringMode(各自独立)", () => {
      const h = new AgentHarness(makeOptions());
      h.setFollowUpMode("one-at-a-time");
      expect(h.getSteeringMode()).toBe("all");
    });
  });

  describe("dispose 后 setter 抛错", () => {
    it("dispose 后 setSteeringMode 抛 AgentHarnessError", () => {
      const h = new AgentHarness(makeOptions());
      h.dispose();
      expect(() => h.setSteeringMode("one-at-a-time")).toThrow(/dispose/i);
    });

    it("dispose 后 setFollowUpMode 抛 AgentHarnessError", () => {
      const h = new AgentHarness(makeOptions());
      h.dispose();
      expect(() => h.setFollowUpMode("one-at-a-time")).toThrow(/dispose/i);
    });
  });
});
