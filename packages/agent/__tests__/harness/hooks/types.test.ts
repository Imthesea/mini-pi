/**
 * hooks/types.ts 的类型测试。
 *
 * 覆盖:
 * - HookEvent 幻影结果泛型
 * - 12 个实际 emit 事件全部存在
 * - 每个事件携带的 TResult 与 spec/plan 一致
 * - HookHandler / HookObserver / SessionFacade 等公共类型可被导入
 *
 * TypeScript 编译通过即视为类型正确,这里用 expectTypeOf 显式校验。
 */

import { describe, expect, expectTypeOf, it } from "vitest";
import type { AgentMessage } from "../../../src/types.js";
import type {
  ContextHookEvent,
  BeforeAgentStartHookEvent,
  ToolCallHookEvent,
  ToolResultHookEvent,
  MessageEndHookEvent,
  SessionBeforeCompactHookEvent,
  ModelUpdateHookEvent,
  AbortHookEvent,
  SessionBeforeTreeHookEvent,
  SessionCompactHookEvent,
  SessionTreeHookEvent,
  QueueUpdateHookEvent,
  AgentHarnessHookEvent,
  AgentHarnessHookContext,
  SessionFacade,
  ResultOf,
  AgentHarnessHookName,
} from "../../../src/harness/hooks/types.js";

describe("harness/hooks/types — 12 个事件", () => {
  it("context 事件:携带 { messages? } 幻影结果", () => {
    const evt: ContextHookEvent = { type: "context" };
    expect(evt.type).toBe("context");
    expectTypeOf<ResultOf<ContextHookEvent>>().toEqualTypeOf<
      { messages?: AgentMessage[] } | undefined
    >();
  });

  it("before_agent_start 事件:携带 { messages?, systemPrompt? } 幻影结果 + 本轮入参", () => {
    const evt: BeforeAgentStartHookEvent = {
      type: "before_agent_start",
      prompt: "hi",
      systemPrompt: "base",
      resources: {},
    };
    expect(evt.type).toBe("before_agent_start");
    expect(evt.prompt).toBe("hi");
    expect(evt.systemPrompt).toBe("base");
    expectTypeOf<ResultOf<BeforeAgentStartHookEvent>>().toEqualTypeOf<
      { messages?: AgentMessage[]; systemPrompt?: string } | undefined
    >();
  });

  it("tool_call 事件:携带 { block?, reason? } 幻影结果", () => {
    // toolCall/args/context/assistantMessage 是必填字段,但本测试只关注 type + 幻影结果
    // 用 as any 跳过(测试目的是类型层,不是数据完整性)
    const evt = { type: "tool_call" } as ToolCallHookEvent;
    expect(evt.type).toBe("tool_call");
    expectTypeOf<ResultOf<ToolCallHookEvent>>().toEqualTypeOf<
      { block?: boolean; reason?: string } | undefined
    >();
  });

  it("tool_result 事件:携带 { content?, details?, isError?, terminate? } 幻影结果", () => {
    const evt: ToolResultHookEvent = { type: "tool_result" };
    expect(evt.type).toBe("tool_result");
    expectTypeOf<ResultOf<ToolResultHookEvent>>().toEqualTypeOf<
      | {
          content?: unknown;
          details?: unknown;
          isError?: boolean;
          terminate?: boolean;
        }
      | undefined
    >();
  });

  it("message_end 事件:无幻影结果(void)", () => {
    const evt: MessageEndHookEvent = { type: "message_end" };
    expect(evt.type).toBe("message_end");
    expectTypeOf<ResultOf<MessageEndHookEvent>>().toEqualTypeOf<undefined>();
  });

  it("session_before_compact 事件:携带 { cancel?, compaction? } 幻影结果", () => {
    const evt: SessionBeforeCompactHookEvent = {
      type: "session_before_compact",
    };
    expect(evt.type).toBe("session_before_compact");
    expectTypeOf<ResultOf<SessionBeforeCompactHookEvent>>().toEqualTypeOf<
      { cancel?: boolean; compaction?: unknown } | undefined
    >();
  });

  it("model_update 事件:无幻影结果(void)", () => {
    const evt: ModelUpdateHookEvent = { type: "model_update" };
    expect(evt.type).toBe("model_update");
    expectTypeOf<ResultOf<ModelUpdateHookEvent>>().toEqualTypeOf<undefined>();
  });

  it("abort 事件:无幻影结果(void)", () => {
    const evt: AbortHookEvent = { type: "abort" };
    expect(evt.type).toBe("abort");
    expectTypeOf<ResultOf<AbortHookEvent>>().toEqualTypeOf<undefined>();
  });

  it("session_before_tree 事件:携带 { cancel?, summary?, ... } 幻影结果", () => {
    const evt: SessionBeforeTreeHookEvent = { type: "session_before_tree" };
    expect(evt.type).toBe("session_before_tree");
    expectTypeOf<ResultOf<SessionBeforeTreeHookEvent>>().toEqualTypeOf<
      | {
          cancel?: boolean;
          summary?: unknown;
          customInstructions?: string;
          replaceInstructions?: string;
          label?: string;
        }
      | undefined
    >();
  });

  it("session_compact 事件:无幻影结果", () => {
    const evt: SessionCompactHookEvent = { type: "session_compact" };
    expect(evt.type).toBe("session_compact");
    expectTypeOf<ResultOf<SessionCompactHookEvent>>().toEqualTypeOf<undefined>();
  });

  it("session_tree 事件:无幻影结果", () => {
    const evt: SessionTreeHookEvent = { type: "session_tree" };
    expect(evt.type).toBe("session_tree");
    expectTypeOf<ResultOf<SessionTreeHookEvent>>().toEqualTypeOf<undefined>();
  });

  it("queue_update 事件:无幻影结果", () => {
    const evt: QueueUpdateHookEvent = { type: "queue_update" };
    expect(evt.type).toBe("queue_update");
    expectTypeOf<ResultOf<QueueUpdateHookEvent>>().toEqualTypeOf<undefined>();
  });
});

describe("harness/hooks/types — 公共类型", () => {
  it("AgentHarnessHookEvent 是所有 12 个事件的联合", () => {
    // 编译期校验:每个事件类型都是联合的成员
    const e1: AgentHarnessHookEvent = { type: "context" };
    // toolCall/args/context/assistantMessage 是必填字段,本测试只关注 type 字段
    const e2 = { type: "tool_call" } as unknown as AgentHarnessHookEvent;
    const e3: AgentHarnessHookEvent = { type: "queue_update" };
    expect(e1.type).toBe("context");
    expect(e2.type).toBe("tool_call");
    expect(e3.type).toBe("queue_update");
  });

  it("AgentHarnessHookContext 包含 harness / session / messages", () => {
    const ctx: AgentHarnessHookContext = {
      harness: {} as any,
      session: {} as SessionFacade,
      messages: [],
    };
    expect(ctx).toBeDefined();
    expectTypeOf<AgentHarnessHookContext["session"]>().toEqualTypeOf<SessionFacade>();
  });

  it("SessionFacade 只暴露只读方法", () => {
    const facade: SessionFacade = {
      getId: () => "s1",
      getMessages: () => [],
    };
    expect(facade.getId?.()).toBe("s1");
  });

  it("AgentHarnessHookName 是所有事件 type 的字面量联合", () => {
    const name: AgentHarnessHookName = "context";
    expect(name).toBe("context");
    // @ts-expect-error - "non_existent" 不是有效的事件名
    const _bad: AgentHarnessHookName = "non_existent";
    void _bad;
  });
});
