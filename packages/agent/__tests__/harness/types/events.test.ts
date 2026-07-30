/**
 * harness/types/events.ts 的类型测试。
 *
 * Task 3 阶段:AgentHarnessEvent 只需是 AgentEvent 的超集占位。
 * Task 4 会增量 8 个核心 harness 私有事件 + 9 个预声明事件。
 */

import { describe, expect, it } from "vitest";
import type { AgentHarnessEvent } from "../../../src/harness/types/events.js";
import type { AgentEvent } from "../../../src/types.js";

describe("harness/types/events", () => {
  it("AgentHarnessEvent 当前阶段等于 AgentEvent 联合(占位)", () => {
    // Task 3 暂时只有 AgentEvent 一个来源,Task 4 再扩展 harness 私有事件
    // 编译期校验:类型系统把 AgentHarnessEvent 当作 AgentEvent 的同义联合
    const evt: AgentHarnessEvent = {
      type: "agent_start",
    };
    expect(evt.type).toBe("agent_start");
  });

  it("AgentHarnessEvent 能容纳 AgentEvent 的所有变体", () => {
    // 编译期校验通过即视为覆盖
    const events: AgentHarnessEvent[] = [
      { type: "agent_start" },
      { type: "agent_end", messages: [] },
      { type: "turn_start" },
      {
        type: "turn_end",
        message: {
          role: "user",
          content: [{ type: "text", text: "hi" }],
          timestamp: 1,
        },
        toolResults: [],
      },
    ];
    expect(events.length).toBe(4);
  });

  it("AgentHarnessEvent 至少是 AgentEvent 的子集(可赋值给 AgentEvent)", () => {
    const evt: AgentHarnessEvent = { type: "turn_start" };
    // 编译期:AgentHarnessEvent 应当可赋值给 AgentEvent(因为它是后者的扩展)
    const agentEvt: AgentEvent = evt;
    expect(agentEvt.type).toBe("turn_start");
  });
});
