/**
 * hooks/types.ts 的类型测试。
 *
 * 覆盖:
 * - HookEvent 幻影结果泛型
 * - 8 个核心事件 + 9 个预声明事件全部存在
 * - 每个事件携带的 TResult 与 spec/plan 一致
 * - HookHandler / HookObserver / HookContext 等公共类型可被导入
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
  BeforeProviderRequestHookEvent,
  BeforeProviderPayloadHookEvent,
  AfterProviderResponseHookEvent,
  SessionCompactHookEvent,
  SessionBeforeTreeHookEvent,
  SessionTreeHookEvent,
  ThinkingLevelUpdateHookEvent,
  ResourcesUpdateHookEvent,
  ToolsUpdateHookEvent,
  QueueUpdateHookEvent,
  SavePointHookEvent,
  SettledHookEvent,
  AgentHarnessHookEvent,
  AgentHarnessHookContext,
  AgentHarnessHookContextFacade,
  SessionFacade,
  ModelFacade,
  ResultOf,
  HookContextProvider,
  AgentHarnessHookName,
} from "../../../src/harness/hooks/types.js";

describe("harness/hooks/types — 8 个核心事件", () => {
  it("context 事件:携带 { messages? } 幻影结果", () => {
    const evt: ContextHookEvent = { type: "context" };
    expect(evt.type).toBe("context");
    // 幻影结果类型
    expectTypeOf<ResultOf<ContextHookEvent>>().toEqualTypeOf<
      { messages?: AgentMessage[] } | undefined
    >();
  });

  it("before_agent_start 事件:携带 { messages?, systemPrompt? } 幻影结果", () => {
    const evt: BeforeAgentStartHookEvent = { type: "before_agent_start" };
    expect(evt.type).toBe("before_agent_start");
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
});

describe("harness/hooks/types — 9 个预声明事件", () => {
  it("before_provider_request:携带 { streamOptions? } 幻影结果", () => {
    const evt: BeforeProviderRequestHookEvent = {
      type: "before_provider_request",
    };
    expect(evt.type).toBe("before_provider_request");
    expectTypeOf<
      ResultOf<BeforeProviderRequestHookEvent>
    >().toEqualTypeOf<{ streamOptions?: unknown } | undefined>();
  });

  it("before_provider_payload:携带 { payload } 幻影结果", () => {
    const evt: BeforeProviderPayloadHookEvent = {
      type: "before_provider_payload",
    };
    expect(evt.type).toBe("before_provider_payload");
    expectTypeOf<
      ResultOf<BeforeProviderPayloadHookEvent>
    >().toEqualTypeOf<{ payload: unknown } | undefined>();
  });

  it("after_provider_response:无幻影结果", () => {
    const evt: AfterProviderResponseHookEvent = {
      type: "after_provider_response",
    };
    expect(evt.type).toBe("after_provider_response");
    expectTypeOf<
      ResultOf<AfterProviderResponseHookEvent>
    >().toEqualTypeOf<undefined>();
  });

  it("session_compact:无幻影结果", () => {
    const evt: SessionCompactHookEvent = { type: "session_compact" };
    expect(evt.type).toBe("session_compact");
    expectTypeOf<ResultOf<SessionCompactHookEvent>>().toEqualTypeOf<undefined>();
  });

  it("session_before_tree:携带 { cancel?, summary?, ... } 幻影结果", () => {
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

  it("session_tree:无幻影结果", () => {
    const evt: SessionTreeHookEvent = { type: "session_tree" };
    expect(evt.type).toBe("session_tree");
    expectTypeOf<ResultOf<SessionTreeHookEvent>>().toEqualTypeOf<undefined>();
  });

  it("thinking_level_update:无幻影结果", () => {
    const evt: ThinkingLevelUpdateHookEvent = {
      type: "thinking_level_update",
    };
    expect(evt.type).toBe("thinking_level_update");
    expectTypeOf<
      ResultOf<ThinkingLevelUpdateHookEvent>
    >().toEqualTypeOf<undefined>();
  });

  it("resources_update:无幻影结果", () => {
    const evt: ResourcesUpdateHookEvent = { type: "resources_update" };
    expect(evt.type).toBe("resources_update");
    expectTypeOf<ResultOf<ResourcesUpdateHookEvent>>().toEqualTypeOf<undefined>();
  });

  it("tools_update:无幻影结果", () => {
    const evt: ToolsUpdateHookEvent = { type: "tools_update" };
    expect(evt.type).toBe("tools_update");
    expectTypeOf<ResultOf<ToolsUpdateHookEvent>>().toEqualTypeOf<undefined>();
  });

  it("queue_update:无幻影结果", () => {
    const evt: QueueUpdateHookEvent = { type: "queue_update" };
    expect(evt.type).toBe("queue_update");
    expectTypeOf<ResultOf<QueueUpdateHookEvent>>().toEqualTypeOf<undefined>();
  });

  it("save_point:无幻影结果", () => {
    const evt: SavePointHookEvent = { type: "save_point" };
    expect(evt.type).toBe("save_point");
    expectTypeOf<ResultOf<SavePointHookEvent>>().toEqualTypeOf<undefined>();
  });

  it("settled:无幻影结果", () => {
    const evt: SettledHookEvent = { type: "settled" };
    expect(evt.type).toBe("settled");
    expectTypeOf<ResultOf<SettledHookEvent>>().toEqualTypeOf<undefined>();
  });
});

describe("harness/hooks/types — 公共类型", () => {
  it("AgentHarnessHookEvent 是所有 17 个事件的联合", () => {
    // 编译期校验:每个事件类型都是联合的成员
    const e1: AgentHarnessHookEvent = { type: "context" };
    // toolCall/args/context/assistantMessage 是必填字段,本测试只关注 type 字段
    // 用 as unknown as 跳过数据完整性校验
    const e2 = { type: "tool_call" } as unknown as AgentHarnessHookEvent;
    const e3: AgentHarnessHookEvent = { type: "save_point" };
    expect(e1.type).toBe("context");
    expect(e2.type).toBe("tool_call");
    expect(e3.type).toBe("save_point");
  });

  it("AgentHarnessHookContext 包含 harness / session / models", () => {
    // 编译期校验:字段可访问
    const ctx: AgentHarnessHookContext = {
      harness: {} as any,
      session: {} as SessionFacade,
      models: {} as ModelFacade,
      messages: [],
    };
    expect(ctx).toBeDefined();
    expectTypeOf<AgentHarnessHookContext["session"]>().toEqualTypeOf<SessionFacade>();
    expectTypeOf<AgentHarnessHookContext["models"]>().toEqualTypeOf<ModelFacade>();
  });

  it("AgentHarnessHookContextFacade 防止直接调用 harness 的方法(只读门面)", () => {
    // 编译期:facade 暴露有限方法,不暴露 setter
    const facade: AgentHarnessHookContextFacade = {
      getModel: () => null as any,
      getTools: () => [],
      getPhase: () => "idle",
    };
    expect(facade.getPhase()).toBe("idle");
  });

  it("AgentHarnessHookName 是所有事件 type 的字面量联合", () => {
    // 编译期校验
    const name: AgentHarnessHookName = "context";
    expect(name).toBe("context");
    // @ts-expect-error - "non_existent" 不是有效的事件名
    const _bad: AgentHarnessHookName = "non_existent";
    void _bad;
  });

  it("HookContextProvider 是 AsyncIterable 形状", () => {
    // 编译期:接口中 asyncIterator 方法的签名是 AsyncIterator
    type T = HookContextProvider;
    // 通过 keyof 验证 asyncIterator 字段存在
    type K = keyof T;
    expectTypeOf<K>().toEqualTypeOf<typeof Symbol.asyncIterator>();
  });
});
