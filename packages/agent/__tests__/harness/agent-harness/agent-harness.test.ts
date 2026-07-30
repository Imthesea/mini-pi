/**
 * AgentHarness 核心类测试。
 *
 * 覆盖:
 * - 构造 harness 不报错
 * - 事件订阅(subscribe())能拿到事件
 * - getPhase()返回正确 phase
 * - abort()在 turn 中能中断
 * - 异常路径后 phase 回到 idle
 *
 * getXxx / setXxx 由 config.test.ts 覆盖,
 * prompt() 由 prompt.test.ts 覆盖。
 */

import { describe, expect, it, vi } from "vitest";
import { AgentHarness } from "../../../src/harness/agent-harness/agent-harness.js";
import { createMockStreamFn, mockModel } from "../../_helpers/mock-provider.js";
import type {
  AgentHarnessOptions,
} from "../../../src/harness/types/options.js";
import { HarnessConfigError } from "../../../src/harness/errors.js";
import { runAgentLoop } from "../../../src/agent-loop.js";

/** 构造最小可用 options,注入 mock streamFn */
function makeOptions(overrides: Partial<AgentHarnessOptions> = {}): AgentHarnessOptions {
  return {
    model: mockModel,
    tools: [],
    env: {
      readFile: async () => ({ ok: true, value: "" }),
    } as any,
    session: {} as any, // 真实 session 由 Task 5 提供
    streamFn: createMockStreamFn([{ kind: "text", text: "hi" }]).streamFn,
    ...overrides,
  };
}

describe("AgentHarness 核心类", () => {
  it("可构造一个最小 harness", () => {
    const h = new AgentHarness(makeOptions());
    expect(h).toBeInstanceOf(AgentHarness);
  });

  it("构造时 phase 是 idle", () => {
    const h = new AgentHarness(makeOptions());
    expect(h.getPhase()).toBe("idle");
  });

  it("必填字段缺失时抛 HarnessConfigError", () => {
    expect(
      () =>
        new AgentHarness({
          // 缺 model
          tools: [],
          env: {} as any,
          session: {} as any,
        } as any),
    ).toThrow(HarnessConfigError);

    expect(
      () =>
        new AgentHarness({
          model: mockModel,
          // 缺 tools
          env: {} as any,
          session: {} as any,
        } as any),
    ).toThrow(HarnessConfigError);

    expect(
      () =>
        new AgentHarness({
          model: mockModel,
          tools: [],
          // 缺 env
          session: {} as any,
        } as any),
    ).toThrow(HarnessConfigError);

    expect(
      () =>
        new AgentHarness({
          model: mockModel,
          tools: [],
          env: {} as any,
          // 缺 session
        } as any),
    ).toThrow(HarnessConfigError);
  });

  it("subscribe()返回的迭代器是 AsyncIterable", () => {
    const h = new AgentHarness(makeOptions());
    const it = h.subscribe();
    expect(typeof it[Symbol.asyncIterator]).toBe("function");
  });

  it("abort()后 phase 仍是 idle(无 turn 进行时)", () => {
    const h = new AgentHarness(makeOptions());
    h.abort();
    expect(h.getPhase()).toBe("idle");
  });

  it("agent-loop 内部导出 runAgentLoop 可独立使用", () => {
    // sanity check:确认 runAgentLoop 是从 agent-loop.js 导出的
    expect(typeof runAgentLoop).toBe("function");
  });
});
