/**
 * AgentHarness 主类。
 *
 * 职责:
 * 1. 持有运行时配置(model / tools / env / session / resources / systemPrompt)
 * 2. 维护 phase 状态机(idle / turn / compaction / ...)
 * 3. 暴露事件订阅接口(subscribe)
 * 4. 提供 abort 能力
 * 5. 配置管理(getXxx / setXxx)
 * 6. 业务入口(prompt)
 * 7. 钩子系统集成(emit 8 个核心事件:见 hooks-bridge.ts)
 *
 * 设计说明:
 * - 字段用 # 私有修饰符,严格封装
 * - 内部方法用 _ 前缀(约定,非强制),供同模块测试调用
 * - 后续 Task 增量(skill / compact / steer 等)直接在本文件加方法
 * - 拆分出去的文件:event-bus.ts(事件总线)、helpers.ts(纯函数辅助)、
 *   hooks-bridge.ts(钩子 ↔ agent-loop 桥接)
 *
 * 钩子事件 emit 位置:
 * | 事件                | emit 位置                                |
 * |---------------------|------------------------------------------|
 * | before_agent_start  | prompt() 入口                            |
 * | context             | executeTurn() 调 runAgentLoop 前         |
 * | tool_call           | bridgeBeforeToolCall(通过 AgentLoopConfig.beforeToolCall) |
 * | tool_result         | bridgeAfterToolCall(通过 AgentLoopConfig.afterToolCall)  |
 * | message_end         | runAgentLoop emit sink(message_end 时)   |
 * | model_update        | setModel() 末尾                          |
 * | abort               | abort() 末尾                             |
 * | session_before_compact | (Task 6 接入,本 Task 不 emit)         |
 */

import type { Model } from "@mimi/ai";
import type {
  AgentContext,
  AgentLoopConfig,
  AgentMessage,
  AgentTool,
  ThinkingLevel,
} from "../../types.js";
import { runAgentLoop } from "../../agent-loop.js";
import { convertToLlm } from "../messages/convert.js";
import { buildSystemPrompt } from "../system-prompt/index.js";
import { assertPhase } from "../phase.js";
import { AgentHarnessError, HarnessConfigError } from "../errors.js";
import type { AgentHarnessPhase } from "../phase.js";
import type { AgentHarnessEvent } from "../types/events.js";
import type {
  AgentHarnessOptions,
  AgentHarnessResources,
  AgentHarnessStreamOptions,
} from "../types/options.js";
import { DefaultAgentHarnessHooks } from "../hooks/index.js";
import type {
  AgentHarnessHookContext,
  BeforeAgentStartHookEvent,
} from "../hooks/index.js";
import { EventBus } from "./event-bus.js";
import type { Subscription } from "./event-bus.js";
import { buildUserContent, extractSessionId } from "./helpers.js";
import { bridgeAfterToolCall, bridgeBeforeToolCall } from "./hooks-bridge.js";
import type { Session } from "../session/session.js";

// ── AgentHarness 主类 ──

export class AgentHarness {
  // ── 私有字段 ──

  /** 持有构造时的 options(env / session / streamFn 等不变部分) */
  #options: AgentHarnessOptions;

  /**
   * 运行时可变配置。
   *
   * 包含:model / tools / thinkingLevel / resources / streamOptions / systemPrompt。
   * 这些字段在 harness 生命周期内可能被 setXxx 改变,
   * 影响"下一个 turn 快照",不影响"当前 turn"。
   */
  #runtime: {
    model: Model<any>;
    tools: AgentTool<any>[];
    thinkingLevel: ThinkingLevel | undefined;
    resources: AgentHarnessResources | undefined;
    streamOptions: AgentHarnessStreamOptions | undefined;
    systemPrompt: AgentHarnessOptions["systemPrompt"];
  };

  /** 当前 phase(状态机) */
  #phase: AgentHarnessPhase = "idle";

  /** 内部事件总线 */
  readonly #eventBus: EventBus = new EventBus();

  /**
   * 钩子系统实例。
   *
   * 持有 observe / on / emit 全部能力。
   * 在 prompt() / abort() / setModel() 等关键点 emit 8 个核心事件。
   * tool_call / tool_result 通过 hooks-bridge.ts 桥接到 AgentLoopConfig。
   */
  readonly #hooks: DefaultAgentHarnessHooks;

  /** 当前 turn 的 AbortController(turn 开始时新建,结束时清空) */
  #currentAbortController: AbortController | null = null;

  /** 是否已经 dispose(防止重复清理) */
  #disposed = false;

  // ── 构造 ──

  constructor(options: AgentHarnessOptions) {
    this.#validateOptions(options);
    this.#options = options;

    this.#runtime = {
      model: options.model,
      tools: options.tools,
      thinkingLevel: options.thinkingLevel,
      resources: options.resources,
      streamOptions: options.streamOptions,
      systemPrompt: options.systemPrompt,
    };

    // 构造钩子系统(用户可注入自定义实现,默认用 DefaultAgentHarnessHooks)
    this.#hooks =
      (options.hooks as DefaultAgentHarnessHooks | undefined) ??
      new DefaultAgentHarnessHooks({
        context: this.#buildHookContext(),
      });
  }

  /** 构造钩子系统需要的 context(由 setContext 同步更新) */
  #buildHookContext(): AgentHarnessHookContext {
    const session = this.#options.session as Session<any> | undefined;
    return {
      harness: this,
      // session facade:Task 5 接入后填充真正的 session 引用
      // 提供 getId / getMessages(handler 用 facade 拿数据,不必直接 import Session)
      // getId 返回 Promise<id>:因为 Session.getMetadata() 是 async
      session: session
        ? {
            getId: () =>
              session
                .getMetadata()
                .then((m) => m.id)
                .catch(() => "unknown"),
            getMessages: () => this.#loadSessionMessages(session),
          }
        : {},
      // models facade:Task 后续接入后填充
      models: {},
      // messages:从 session 加载历史消息(handler 可读)
      messages: [],
    };
  }

  /**
   * 从 session 加载历史消息(给 hook context 用)。
   * 内部方法:供 #buildHookContext 调用,避免每次 hook emit 时全量加载。
   */
  async #loadSessionMessages(session: Session<any>): Promise<AgentMessage[]> {
    try {
      const context = await session.buildContext();
      return context.messages;
    } catch {
      return [];
    }
  }

  /**
   * 同步钩子 context(在每次 setSession / setModel 后调用,
   * 让 handler 看到最新状态)。
   *
   * 内部方法:Task 5 接入 session 后,会在 prompt 入口调一次同步历史 messages。
   */
  _syncHookContext(): void {
    this.#hooks.setContext(this.#buildHookContext());
  }

  /** 校验 options 必填字段,缺失时抛 HarnessConfigError */
  #validateOptions(options: AgentHarnessOptions): void {
    if (!options.model) {
      throw new HarnessConfigError("options.model 必填");
    }
    if (!options.tools) {
      throw new HarnessConfigError("options.tools 必填(可传空数组)");
    }
    if (!options.env) {
      throw new HarnessConfigError("options.env 必填");
    }
    if (!options.session) {
      throw new HarnessConfigError("options.session 必填");
    }
  }

  // ── Phase(状态机) ──

  /** 获取当前 phase */
  getPhase(): AgentHarnessPhase {
    return this.#phase;
  }

  /** 内部使用:设置 phase */
  _setPhase(phase: AgentHarnessPhase): void {
    this.#phase = phase;
  }

  // ── 订阅 ──

  /**
   * 订阅 harness 事件。
   *
   * 返回的 Subscription 可用 for await 迭代事件,
   * 或调 cancel() 取消订阅。
   * 多个订阅者之间互不影响。
   */
  subscribe(): Subscription {
    const queue: AgentHarnessEvent[] = [];
    let resolveNext: ((event: AgentHarnessEvent | null) => void) | null = null;
    let cancelled = false;

    const unsubscribe = this.#eventBus.subscribe((event) => {
      if (cancelled) return;
      if (resolveNext) {
        const r = resolveNext;
        resolveNext = null;
        r(event);
      } else {
        queue.push(event);
      }
    });

    return {
      [Symbol.asyncIterator](): AsyncIterator<AgentHarnessEvent> {
        return {
          next: async (): Promise<IteratorResult<AgentHarnessEvent>> => {
            if (cancelled) {
              return { value: undefined, done: true };
            }
            const next = queue.shift();
            if (next) {
              return { value: next, done: false };
            }
            return new Promise((resolve) => {
              resolveNext = (event) => {
                if (event === null) {
                  resolve({ value: undefined, done: true });
                } else {
                  resolve({ value: event, done: false });
                }
              };
            });
          },
          return: async (): Promise<IteratorResult<AgentHarnessEvent>> => {
            cancelled = true;
            unsubscribe();
            return { value: undefined, done: true };
          },
        };
      },
      cancel: () => {
        cancelled = true;
        unsubscribe();
        // 关键:resolve pending 的 for await,否则 cancel 后 for await 永远挂起
        if (resolveNext) {
          const r = resolveNext;
          resolveNext = null;
          r(null);
        }
      },
    };
  }

  // ── 中止 ──

  /**
   * 中止当前 turn。
   *
   * 注意:这里直接把 phase 设回 idle,绕过了 phase.ts 的 canTransition 检查。
   * 这是有意为之 -- abort 是"状态机逃生舱",允许从任意 phase 强制回 idle。
   * 如果不回 idle,一个被中断的 harness 会永远卡在 turn 状态无法使用。
   *
   * 同时 emit `abort` 钩子事件(异步 fire-and-forget,不阻塞 abort 本身)。
   */
  abort(): void {
    if (this.#currentAbortController) {
      this.#currentAbortController.abort();
      this.#currentAbortController = null;
    }
    if (this.#phase !== "idle") {
      this.#phase = "idle";
    }
    // emit abort(不 await,避免阻塞主流程;fire-and-forget 语义)
    void this.#hooks.emit({ type: "abort" });
  }

  // ── 配置:Getters ──

  getModel(): Model<any> {
    return this.#runtime.model;
  }

  getTools(): AgentTool<any>[] {
    return this.#runtime.tools;
  }

  getThinkingLevel(): ThinkingLevel | undefined {
    return this.#runtime.thinkingLevel;
  }

  getSession(): any {
    return this.#options.session;
  }

  getResources(): AgentHarnessResources | undefined {
    return this.#runtime.resources;
  }

  getStreamOptions(): AgentHarnessStreamOptions | undefined {
    return this.#runtime.streamOptions;
  }

  getSystemPrompt(): AgentHarnessOptions["systemPrompt"] {
    return this.#runtime.systemPrompt;
  }

  /**
   * 获取钩子系统实例。
   *
   * 用法:
   * ```ts
   * const hooks = harness.getHooks();
   * hooks.on("tool_call", (e) => ({ block: true, reason: "禁止" }));
   * hooks.observe((e) => console.log(e.type));
   * ```
   */
  getHooks(): DefaultAgentHarnessHooks {
    return this.#hooks;
  }

  // ── 配置:Setters ──
  // disposed 的 harness 调用 setter 抛错,防止误用

  setModel(model: Model<any>): void {
    this.#assertNotDisposed();
    this.#runtime.model = model;
    // emit model_update(fire-and-forget)
    void this.#hooks.emit({ type: "model_update" });
  }

  setTools(tools: AgentTool<any>[]): void {
    this.#assertNotDisposed();
    this.#runtime.tools = tools;
  }

  setThinkingLevel(level: ThinkingLevel | undefined): void {
    this.#assertNotDisposed();
    this.#runtime.thinkingLevel = level;
  }

  setSession(session: any): void {
    this.#assertNotDisposed();
    this.#options.session = session;
  }

  setResources(resources: AgentHarnessResources | undefined): void {
    this.#assertNotDisposed();
    this.#runtime.resources = resources;
  }

  setStreamOptions(options: AgentHarnessStreamOptions | undefined): void {
    this.#assertNotDisposed();
    this.#runtime.streamOptions = options;
  }

  setSystemPrompt(
    prompt: AgentHarnessOptions["systemPrompt"],
  ): void {
    this.#assertNotDisposed();
    this.#runtime.systemPrompt = prompt;
  }

  /** disposed 检查(私有,供 setter 调用) */
  #assertNotDisposed(): void {
    if (this.#disposed) {
      throw new AgentHarnessError("harness 已 dispose,无法修改配置");
    }
  }

  // ── 业务方法:prompt() ──

  /**
   * 启动一次 LLM turn。
   *
   * 流程:
   * 1. emit `before_agent_start` 钩子(handler 可改 messages / systemPrompt)
   * 2. 断言 phase === "idle",然后切到 "turn"
   * 3. 构造 user 消息 + system prompt + AgentContext
   * 4. emit `context` 钩子(handler 可链式改 messages)
   * 5. 调 runAgentLoop,转发事件到订阅者
   *    - message_end 事件时同时 emit `message_end` 钩子
   * 6. 无论成功失败,phase 回 idle(try/finally)
   */
  async prompt(
    text: string,
    options?: { images?: Array<{ data: string; mimeType: string }> },
  ): Promise<AgentMessage[]> {
    // 0. emit before_agent_start(handler 可改 messages / systemPrompt,fire-and-forget)
    const startResult = (await this.#hooks.emit({
      type: "before_agent_start",
    } satisfies BeforeAgentStartHookEvent)) as
      | { messages?: AgentMessage[]; systemPrompt?: string }
      | undefined;

    // 1. 断言 phase 是 idle(非 idle 说明上一次 turn 没结束)
    assertPhase(this.getPhase(), "idle", "prompt");

    // 2. 切到 turn(在 try 外,断言失败时 phase 不变)
    this._setPhase("turn");

    try {
      return await this.#executeTurn(text, options, startResult);
    } finally {
      // 3. 不管成功失败,phase 回 idle
      this._setPhase("idle");
    }
  }

  /**
   * 单次 turn 的实际执行(私有)。
   *
   * @param text              user 输入文本
   * @param options           可选 images
   * @param startHookResult   before_agent_start 钩子的返回(可能含 messages / systemPrompt 覆盖)
   */
  async #executeTurn(
    text: string,
    options?: { images?: Array<{ data: string; mimeType: string }> },
    startHookResult?: { messages?: AgentMessage[]; systemPrompt?: string },
  ): Promise<AgentMessage[]> {
    const runtime = this.#runtime;
    const session = this.#options.session as Session<any> | undefined;

    // 构造 user 消息
    const userMessage: AgentMessage = {
      role: "user",
      content: buildUserContent(text, options?.images),
      timestamp: Date.now(),
    };

    // ── 同步钩子 context(让 context 事件 handler 看到最新 session) ──
    this._syncHookContext();

    // ── Session 写入:append user message(Task 5 接入) ──
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

    // 构造 AgentContext
    // 初始 messages:用 before_agent_start 注入的,否则用 [userMessage]
    const initialMessages: AgentMessage[] = startHookResult?.messages ?? [
      userMessage,
    ];

    // 构造 AgentContext
    const context: AgentContext = {
      systemPrompt,
      messages: initialMessages,
      tools: runtime.tools,
    };

    // emit context 事件(handler 可链式改 messages)
    const contextResult = (await this.#hooks.emit({ type: "context" })) as
      | { messages?: AgentMessage[] }
      | undefined;
    if (contextResult?.messages !== undefined) {
      context.messages = contextResult.messages;
    }

    // 构造 AgentLoopConfig
    const config: AgentLoopConfig = {
      model: runtime.model,
      convertToLlm,
      streamFn: this.#options.streamFn,
      toolExecution: "parallel",
      // 桥接:tool_call / tool_result 事件走钩子系统
      beforeToolCall: bridgeBeforeToolCall(this.#hooks),
      afterToolCall: bridgeAfterToolCall(this.#hooks),
    };

    // 调 runAgentLoop,转发事件到 EventBus
    // message_end 事件时:
    // 1. emit 钩子系统的 message_end
    // 2. 异步 append assistant / toolResult message 到 session
    return await runAgentLoop(initialMessages, context, config, async (event) => {
      if (event.type === "message_end") {
        // fire-and-forget,不阻塞事件转发
        void this.#hooks.emit({ type: "message_end" });
        // session 写入:append 当前结束的 message
        if (session) {
          void session.appendMessage(event.message).catch((err) => {
            console.error("[AgentHarness] session.appendMessage failed:", err);
          });
        }
      }
      await this.#emit(event);
    });
  }

  // ── 内部方法 ──

  /** 派发事件到所有订阅者 */
  async #emit(event: AgentHarnessEvent): Promise<void> {
    await this.#eventBus.emit(event);
  }

  /** 设置/获取 currentAbortController(后续 Task 接入 LLM 流时用) */
  _setCurrentAbortController(controller: AbortController | null): void {
    this.#currentAbortController = controller;
  }

  /** 检查 harness 是否已 dispose */
  _isDisposed(): boolean {
    return this.#disposed;
  }

  // ── 生命周期:dispose ──

  /** 标记为已 dispose 并清理资源 */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.abort();
    this.#eventBus.clear();
  }
}

// ── 静态类型守卫 ──

/** 运行时检查:是否 AgentHarness 实例 */
export function isAgentHarness(value: unknown): value is AgentHarness {
  return value instanceof AgentHarness;
}
