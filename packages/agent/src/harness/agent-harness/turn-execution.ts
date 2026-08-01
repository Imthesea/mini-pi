/**
 * Turn 执行逻辑。
 *
 * 职责:
 * - 构造 user 消息(+ nextTurn 前置消息)
 * - 同步钩子 context
 * - 写 user message 到 session
 * - 构造 system prompt
 * - emit context 钩子(handler 可链式改 messages)
 * - 构造 AgentContext + AgentLoopConfig(含 steer/follow-up 回调)
 * - 调 runAgentLoop,转发事件到 EventBus
 * - 在 message_end 事件时 emit 钩子 + 异步 append 到 session
 *
 * 为什么从 agent-harness.ts 拆出来:
 * - #executeTurn 是 harness 里最长的方法(~90 行)
 * - 拆成纯函数后,agent-harness.ts 瘦身,turn 逻辑可独立测
 * - 通过 ExecuteTurnArgs 接口注入依赖,保持 # 字段封装
 *
 * Task 8 增量:
 * - 接受 nextTurnMessages 参数,在 user 消息前 prepend
 * - 通过 getSteeringMessages / getFollowUpMessages 回调注入队列排空逻辑
 */

import type { Model } from "@mimi/ai";
import type {
  AgentContext,
  AgentLoopConfig,
  AgentMessage,
  AgentTool,
} from "../../types.js";
import { runAgentLoop } from "../../agent-loop.js";
import { convertToLlm } from "../messages/convert.js";
import { buildSystemPrompt } from "../system-prompt/index.js";
import type { AgentHarnessEvent } from "../types/events.js";
import type {
  AgentHarnessResources,
  AgentHarnessStreamOptions,
} from "../types/options.js";
import type { AgentHarnessOptions } from "../types/options.js";
import type { DefaultAgentHarnessHooks } from "../hooks/index.js";
import { buildUserContent, extractSessionId } from "./helpers.js";
import { bridgeAfterToolCall, bridgeBeforeToolCall } from "./hooks-bridge.js";
import type { Session } from "../session/session.js";

// ── ExecuteTurnArgs(注入依赖,保持主类 # 字段封装) ──

/**
 * executeTurn 需要的依赖。
 *
 * 设计:
 * - 由 AgentHarness 提供,不暴露 # 私有字段
 * - syncHookContext / emit 是 bound 方法引用(可调用即可)
 * - 其他字段直接是值类型
 */
export interface ExecuteTurnArgs {
  /** 运行时配置(model / tools / resources / systemPrompt) */
  runtime: {
    model: Model<any>;
    tools: AgentTool<any>[];
    resources: AgentHarnessResources | undefined;
    systemPrompt: AgentHarnessOptions["systemPrompt"];
  };
  /** 钩子系统(emit before_agent_start / context / message_end 等) */
  hooks: DefaultAgentHarnessHooks;
  /** Session(用于 append user message + assistant message) */
  session: Session<any> | undefined;
  /** Stream 函数(透传给 AgentLoopConfig) */
  streamFn: AgentHarnessOptions["streamFn"];
  /** 同步钩子 context 的回调(由 AgentHarness._syncHookContext 提供) */
  syncHookContext: () => void;
  /** 派发事件到 EventBus 的回调(由 AgentHarness.#emit 提供) */
  emit: (event: AgentHarnessEvent) => Promise<void>;
  /**
   * Task 8:steer 队列排空回调(由 AgentHarness._drainSteerQueue 提供)。
   * agent-loop 在每个 turn 工具执行完后调用,把排空的消息注入为下一轮 user 消息。
   */
  getSteeringMessages: () => Promise<AgentMessage[]>;
  /**
   * Task 8:follow-up 队列排空回调(由 AgentHarness._drainFollowUpQueue 提供)。
   * agent-loop 在 agent 原本要停时调用,让 agent 继续 turn。
   */
  getFollowUpMessages: () => Promise<AgentMessage[]>;
}

// ── executeTurn 主入口 ──

/**
 * 单次 turn 的实际执行(纯函数 + 依赖注入)。
 *
 * @param args               见 ExecuteTurnArgs
 * @param text               user 输入文本
 * @param options            可选 images
 * @param startHookResult    before_agent_start 钩子的返回(可能含 messages / systemPrompt 覆盖)
 * @param nextTurnMessages   Task 8:nextTurn 队列排空结果(在 prompt 入口消费,prepend 到 user 消息)
 * @returns                  本次 turn 产生的消息列表
 */
export async function executeTurn(
  args: ExecuteTurnArgs,
  text: string,
  options?: { images?: Array<{ data: string; mimeType: string }> },
  startHookResult?: { messages?: AgentMessage[]; systemPrompt?: string },
  nextTurnMessages: readonly AgentMessage[] = [],
): Promise<AgentMessage[]> {
  const {
    runtime,
    hooks,
    session,
    streamFn,
    syncHookContext,
    emit,
    getSteeringMessages,
    getFollowUpMessages,
  } = args;

  // 构造 user 消息
  const userMessage: AgentMessage = {
    role: "user",
    content: buildUserContent(text, options?.images),
    timestamp: Date.now(),
  };

  // ── 同步钩子 context(让 context 事件 handler 看到最新 session) ──
  syncHookContext();

  // ── Session 写入:append user message ──
  // fire-and-forget 不阻塞 turn;失败也不抛(session 写失败不阻塞对话)
  if (session) {
    void session.appendMessage(userMessage).catch((err) => {
      // session 写入失败只记日志(不阻塞 turn)
      console.error("[AgentHarness] session.appendMessage failed:", err);
    });
  }

  // 构造 system prompt(静态字符串或动态 provider)
  // 优先用 before_agent_start hook 注入的 systemPrompt,否则用 runtime 默认
  const baseSystemPrompt =
    startHookResult?.systemPrompt ?? runtime.systemPrompt;
  const systemPromptResult = buildSystemPrompt(baseSystemPrompt, {
    model: runtime.model,
    tools: runtime.tools,
    sessionId: extractSessionId(session),
    resources: runtime.resources,
  });
  const systemPrompt =
    typeof systemPromptResult === "string"
      ? systemPromptResult
      : await systemPromptResult;

  // 初始 messages:用 before_agent_start 注入的,否则用 [userMessage]
  // Task 8 增量:nextTurn 消息 prepend 到 user 消息之前(若 before_agent_start 未注入)
  const baseInitialMessages: AgentMessage[] = startHookResult?.messages ?? [
    userMessage,
  ];
  const initialMessages: AgentMessage[] = [
    ...nextTurnMessages,
    ...baseInitialMessages,
  ];

  // 构造 AgentContext
  const context: AgentContext = {
    systemPrompt,
    messages: initialMessages,
    tools: runtime.tools,
  };

  // emit context 事件(handler 可链式改 messages)
  const contextResult = (await hooks.emit({ type: "context" })) as
    | { messages?: AgentMessage[] }
    | undefined;
  if (contextResult?.messages !== undefined) {
    context.messages = contextResult.messages;
  }

  // 构造 AgentLoopConfig
  const config: AgentLoopConfig = {
    model: runtime.model,
    convertToLlm,
    streamFn,
    toolExecution: "parallel",
    // 桥接:tool_call / tool_result 事件走钩子系统
    beforeToolCall: bridgeBeforeToolCall(hooks),
    afterToolCall: bridgeAfterToolCall(hooks),
    // Task 8 增量:steer / follow-up 队列回调(agent-loop 在 turn 之间调)
    getSteeringMessages,
    getFollowUpMessages,
  };

  // 调 runAgentLoop,转发事件到 EventBus
  // message_end 事件时:
  // 1. emit 钩子系统的 message_end
  // 2. 异步 append assistant / toolResult message 到 session
  return await runAgentLoop(initialMessages, context, config, async (event) => {
    if (event.type === "message_end") {
      // fire-and-forget,不阻塞事件转发
      void hooks.emit({ type: "message_end" });
      // session 写入:append 当前结束的 message
      if (session) {
        void session.appendMessage(event.message).catch((err) => {
          console.error("[AgentHarness] session.appendMessage failed:", err);
        });
      }
    }
    await emit(event);
  });
}
