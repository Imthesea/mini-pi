/**
 * AgentHarness 主类(单文件)。
 *
 * 职责:
 * 1) 持有运行时配置(model / tools / env / session / resources / systemPrompt)
 * 2) 维护 phase 状态机(idle / turn / compaction / branch_summary)
 * 3) 暴露事件订阅接口(subscribe)、abort 能力
 * 4) 配置管理(getXxx / setXxx)
 * 5) 业务入口(prompt / compact / navigateTree / skill / promptFromTemplate)
 * 6) 钩子系统集成(emit 11 个核心事件)
 * 7) 队列操作(steer / followUp / nextTurn) + 队列模式 setter/getter
 *
 * 文件组织(对齐工程原则 § 1.2 + § 1.4):
 * - 本文件:主类单文件(估计 ~1100 行,稍超 1000 上限,符合 § 2.2
 *   "没有真独立模块 → 保持合并,在主类内用注释分章节")
 * - helpers.ts(47 行,2 个纯函数)— 真独立可测纯函数
 * - hooks-bridge.ts(135 行,2 个桥接纯函数)— 真独立可测纯函数
 *
 * 钩子事件 emit 位置(11 个核心事件)详见本文件各方法内的 `emitAsync(...)` / `emitAwait(...)` 调用。
 *
 * Task 11 重构(2026-08-02):
 * - 删 8 个 agent-harness/ 胶水子文件(反模式 5/6 违反)
 * - 业务方法直接 this.xxx 操作,不再走协作层
 * - # 字段全部改 private
 *
 * Task 12 重构(2026-08-02):见 plan § 修订记录
 * - 抽 4 个内部 helper(getSessionInternal / appendSessionMessage /
 *   emitAsync / emitAwait),删 5 处 session 强转 + 7 处 as any + 8 处 void 重复
 * - 拆 executeTurn 为 5 个命名步骤私有方法,主流程从 90 行降到 28 行
 */

import type { Model } from "@mimi/ai";
import type {
  AfterToolCallContext,
  AfterToolCallResult,
  AgentContext,
  AgentLoopConfig,
  AgentMessage,
  AgentTool,
  BeforeToolCallContext,
  BeforeToolCallResult,
  QueueMode,
  ThinkingLevel,
} from "../../types.js";
import { assertPhase } from "../phase.js";
import { AgentHarnessError, HarnessConfigError } from "../errors.js";
import type { AgentHarnessPhase } from "../phase.js";
import type { AgentHarnessEvent } from "../types/events.js";
import type {
  AgentHarnessHookContext,
  BeforeAgentStartHookEvent,
} from "../hooks/index.js";
import { DefaultAgentHarnessHooks } from "../hooks/index.js";
import type {
  AgentHarnessOptions,
  AgentHarnessResources,
  AgentHarnessStreamOptions,
} from "../types/options.js";
import { runAgentLoop } from "../../agent-loop.js";
import { convertToLlm } from "../messages/convert.js";
import { buildSystemPrompt } from "../system-prompt/index.js";
import {
  bridgeAfterToolCall,
  bridgeBeforeToolCall,
} from "./hooks-bridge.js";
import {
  buildUserContent,
  extractSessionId,
} from "./helpers.js";
import {
  formatSkillInvocation,
} from "../skills/format.js";
import {
  formatPromptTemplateInvocation,
} from "../prompt-templates/format.js";
import {
  compact as runCompact,
} from "../compaction/compact.js";
import {
  generateBranchSummary as runGenerateBranchSummary,
} from "../compaction/branch-summarization.js";
import type { CompactionResult } from "../compaction/types.js";
import type { Skill, SkillArgs } from "../skills/types.js";
import type { PromptTemplate, PromptTemplateArgs } from "../prompt-templates/types.js";
import type { Session } from "../session/session.js";

// ── 内部类型 ──

/** 内部事件订阅者 */
type Subscriber = (event: AgentHarnessEvent) => void | Promise<void>;

/** 队列排空时把 next 事件 resolve 给 for await 的回调 */
type Resolver = (event: AgentHarnessEvent | null) => void;

/** 内部订阅状态(每个 Subscription 独立) */
interface SubscriptionInternal {
  queue: AgentHarnessEvent[];
  resolveNext: Resolver | null;
  cancelled: boolean;
  unsubscribe: () => void;
}

/** 事件订阅句柄(公共 API 类型) */
export interface Subscription {
  [Symbol.asyncIterator](): AsyncIterator<AgentHarnessEvent>;
  cancel(): void;
}

/** Subscription 内部状态(WeakMap key 用,外部不导出) */
declare const SubscriptionInternalSymbol: unique symbol;

// ── AgentHarness 主类 ──

export class AgentHarness {
  // ── 私有字段(全部 private,不用 #) ──

  /** 持有构造时的 options(env / session / streamFn 等不变部分) */
  private options: AgentHarnessOptions;

  /**
   * 运行时可变配置。
   *
   * 包含:model / tools / thinkingLevel / resources / streamOptions / systemPrompt。
   * 这些字段在 harness 生命周期内可能被 setXxx 改变,
   * 影响"下一个 turn 快照",不影响"当前 turn"。
   */
  private runtime: {
    model: Model<any>;
    tools: AgentTool<any>[];
    thinkingLevel: ThinkingLevel | undefined;
    resources: AgentHarnessResources | undefined;
    streamOptions: AgentHarnessStreamOptions | undefined;
    systemPrompt: AgentHarnessOptions["systemPrompt"];
  };

  /** 当前 phase(状态机) */
  private phase: AgentHarnessPhase = "idle";

  /** 内部事件订阅者集合(由 subscribe() 创建的内部状态组成) */
  private subscribers: Set<Subscriber> = new Set();

  /**
   * 钩子系统实例。
   *
   * 持有 observe / on / emit 全部能力。
   * 在 prompt() / abort() / setModel() 等关键点 emit 8 个核心事件。
   * tool_call / tool_result 通过 hooks-bridge.ts 桥接到 AgentLoopConfig。
   */
  private hooks: DefaultAgentHarnessHooks;

  /** 当前 turn 的 AbortController(turn 开始时新建,结束时清空) */
  private currentAbortController: AbortController | null = null;

  /** 是否已经 dispose(防止重复清理) */
  private disposed = false;

  // ── 队列状态 ──

  /**
   * steer 队列:中途插入的用户消息(高优先级,中断当前 LLM 流)。
   * 调 steer(text) 时入队,agent-loop 的 getSteeringMessages 回调排空。
   */
  private steerQueue: AgentMessage[] = [];

  /**
   * follow-up 队列:turn 结束后的额外用户消息(低优先级,自然延伸对话)。
   * 调 followUp(text) 时入队,agent-loop 的 getFollowUpMessages 回调排空。
   */
  private followUpQueue: AgentMessage[] = [];

  /**
   * nextTurn 队列:下一轮 prompt 之前的前置消息(预置上下文)。
   * 调 nextTurn(text) 时入队,在 prompt 入口 prepend 到 user 消息。
   */
  private nextTurnQueue: AgentMessage[] = [];

  /** steer 队列的排空模式("all" / "one-at-a-time"),默认 "all" */
  private steeringMode: QueueMode = "all";

  /** follow-up 队列的排空模式("all" / "one-at-a-time"),默认 "all" */
  private followUpMode: QueueMode = "all";

  // ── 构造 ──

  constructor(options: AgentHarnessOptions) {
    this.validateOptions(options);
    this.options = options;

    this.runtime = {
      model: options.model,
      tools: options.tools,
      thinkingLevel: options.thinkingLevel,
      resources: options.resources,
      streamOptions: options.streamOptions,
      systemPrompt: options.systemPrompt,
    };

    // 初始化队列模式(默认 "all",从 options 覆盖)
    this.steeringMode = options.steeringMode ?? "all";
    this.followUpMode = options.followUpMode ?? "all";

    // 构造钩子系统(用户可注入自定义实现,默认用 DefaultAgentHarnessHooks)
    this.hooks =
      (options.hooks as DefaultAgentHarnessHooks | undefined) ??
      new DefaultAgentHarnessHooks({
        context: this.buildHookContext(),
      });
  }

  /** 类型守卫:值是否为 AgentHarness 实例 */
  static isAgentHarness(value: unknown): value is AgentHarness {
    return value instanceof AgentHarness;
  }

  // ── Hook context ──

  /**
   * 构造钩子系统需要的 context(由 setContext 同步更新)。
   *
   * 结构:
   * - harness: 当前 harness 实例(hook handler 调 harness API 用)
   * - session: facade{ getId, getMessages }或空对象
   * - models: facade(本 Task 不填充)
   * - messages: 空数组(handler 可读 session 时拿到真实数据)
   */
  private buildHookContext(): AgentHarnessHookContext {
    const session = this.getSessionInternal();
    return {
      harness: this,
      session: session
        ? {
            getId: () =>
              session
                .getMetadata()
                .then((m) => m.id)
                .catch(() => "unknown"),
            getMessages: () => this.loadSessionMessages(session),
          }
        : {},
      models: {},
      messages: [],
    };
  }

  /**
   * 从 session 加载历史消息(给 hook context 用)。
   *
   * 失败时返回空数组(避免 hook emit 因 session 错误崩溃)。
   */
  private async loadSessionMessages(
    session: Session<any>,
  ): Promise<AgentMessage[]> {
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
    this.hooks.setContext(this.buildHookContext());
  }

  /** 校验 options 必填字段,缺失时抛 HarnessConfigError */
  private validateOptions(options: AgentHarnessOptions): void {
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
    return this.phase;
  }

  /** 内部使用:设置 phase */
  _setPhase(phase: AgentHarnessPhase): void {
    this.phase = phase;
  }

  // ── 内部 helper(纯转发,无业务逻辑) ──

  /**
   * 取 session 实例(内部用,统一做类型断言)。
   *
   * 业务方法(executeTurn / compact / navigateTree / buildHookContext)
   * 都通过这里拿 session,避免每处都写 `as Session<any> | undefined`。
   */
  private getSessionInternal(): Session<any> | undefined {
    return this.options.session as Session<any> | undefined;
  }

  /**
   * 写消息到 session(失败只 log,不阻塞 turn)。
   *
   * session 持久化失败不应该挂掉对话,所以统一用 fire-and-forget + log。
   * 2 个调用点(executeTurn 入口的 user 消息、message_end 时的 message)。
   */
  private appendSessionMessage(
    session: Session<any> | undefined,
    message: AgentMessage,
  ): void {
    if (!session) return;
    void session.appendMessage(message).catch((err) => {
      console.error("[AgentHarness] session.appendMessage failed:", err);
    });
  }

  /**
   * 派发钩子事件(异步 fire-and-forget)。
   *
   * 包住 `void` + `as any`,所有"emit 但不关心结果"的地方都走这里。
   * 8 处调用 → 1 处 `as any`,后续如放宽 HookEvent 类型可一处清理。
   */
  private emitAsync(event: { type: string; [key: string]: unknown }): void {
    void this.hooks.emit(event as any);
  }

  /**
   * 派发钩子事件并 await handler 结果(给 session_before_* 这种需要 handler 注入结果的用)。
   *
   * 调用方提供 T 形参,声明期望的 handler 返回类型(否则 emit 返回 unknown)。
   * 例:`const r = await this.emitAwait<{ cancel?: boolean }>({ type: "session_before_compact" })`
   */
  private async emitAwait<T = unknown>(
    event: { type: string; [key: string]: unknown },
  ): Promise<T | undefined> {
    return (await this.hooks.emit(event as any)) as T | undefined;
  }

  // ── 订阅 ──

  /**
   * 订阅 harness 事件。
   *
   * 返回的 Subscription 可用 for await 迭代事件,
   * 或调 cancel() 取消订阅。
   * 多个订阅者之间互不影响。
   *
   * 实现:每个 Subscription 有独立的 queue + resolveNext + cancelled 闭包。
   * EventBus 统一管理所有订阅者,emit 时把事件分发到各 Subscription 的 queue。
   */
  subscribe(): Subscription {
    // 内部状态:每个 Subscription 独立
    const internal: SubscriptionInternal = {
      queue: [],
      resolveNext: null,
      cancelled: false,
      unsubscribe: null!,
    };

    // 注册到 EventBus(先拿到 unsubscribe,再塞进 internal,避免"先占位再填")
    internal.unsubscribe = this.addSubscriber((event) => {
      if (internal.cancelled) return;
      if (internal.resolveNext) {
        const r = internal.resolveNext;
        internal.resolveNext = null;
        r(event);
      } else {
        internal.queue.push(event);
      }
    });

    return {
      [Symbol.asyncIterator](): AsyncIterator<AgentHarnessEvent> {
        return {
          next: async (): Promise<IteratorResult<AgentHarnessEvent>> => {
            if (internal.cancelled) {
              return { value: undefined, done: true };
            }
            const next = internal.queue.shift();
            if (next) {
              return { value: next, done: false };
            }
            return new Promise((resolve) => {
              internal.resolveNext = (event) => {
                if (event === null) {
                  resolve({ value: undefined, done: true });
                } else {
                  resolve({ value: event, done: false });
                }
              };
            });
          },
          return: async (): Promise<IteratorResult<AgentHarnessEvent>> => {
            internal.cancelled = true;
            internal.unsubscribe();
            return { value: undefined, done: true };
          },
        };
      },
      cancel: () => {
        internal.cancelled = true;
        internal.unsubscribe();
        // 关键:resolve pending 的 for await,否则 cancel 后 for await 永远挂起
        if (internal.resolveNext) {
          const r = internal.resolveNext;
          internal.resolveNext = null;
          r(null);
        }
      },
    };
  }

  /** 内部:添加订阅者(返回取消订阅函数) */
  private addSubscriber(subscriber: Subscriber): () => void {
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  /** 派发事件给所有订阅者(并行) */
  private async emit(event: AgentHarnessEvent): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const sub of this.subscribers) {
      const result = sub(event);
      if (result instanceof Promise) {
        promises.push(result);
      }
    }
    if (promises.length > 0) {
      await Promise.all(promises);
    }
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
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }
    if (this.phase !== "idle") {
      this.phase = "idle";
    }
    // emit abort(不 await,避免阻塞主流程;fire-and-forget 语义)
    this.emitAsync({ type: "abort" });
  }

  // ── 配置:Getters ──

  getModel(): Model<any> {
    return this.runtime.model;
  }

  getTools(): AgentTool<any>[] {
    return this.runtime.tools;
  }

  getThinkingLevel(): ThinkingLevel | undefined {
    return this.runtime.thinkingLevel;
  }

  getSession(): any {
    return this.options.session;
  }

  getResources(): AgentHarnessResources | undefined {
    return this.runtime.resources;
  }

  getStreamOptions(): AgentHarnessStreamOptions | undefined {
    return this.runtime.streamOptions;
  }

  getSystemPrompt(): AgentHarnessOptions["systemPrompt"] {
    return this.runtime.systemPrompt;
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
    return this.hooks;
  }

  // ── 配置:Setters ──
  // disposed 的 harness 调用 setter 抛错,防止误用

  setModel(model: Model<any>): void {
    this.assertNotDisposed();
    this.runtime.model = model;
    // emit model_update(fire-and-forget)
    this.emitAsync({ type: "model_update" });
  }

  setTools(tools: AgentTool<any>[]): void {
    this.assertNotDisposed();
    this.runtime.tools = tools;
  }

  setThinkingLevel(level: ThinkingLevel | undefined): void {
    this.assertNotDisposed();
    this.runtime.thinkingLevel = level;
  }

  setSession(session: Session<any> | undefined): void {
    this.assertNotDisposed();
    this.options.session = session;
  }

  setResources(resources: AgentHarnessResources | undefined): void {
    this.assertNotDisposed();
    this.runtime.resources = resources;
  }

  setStreamOptions(options: AgentHarnessStreamOptions | undefined): void {
    this.assertNotDisposed();
    this.runtime.streamOptions = options;
  }

  setSystemPrompt(
    prompt: AgentHarnessOptions["systemPrompt"],
  ): void {
    this.assertNotDisposed();
    this.runtime.systemPrompt = prompt;
  }

  // ── 队列模式 getter/setter ──

  /**
   * 获取 steer 队列的排空模式。
   *
   * - "all":每次排空点(turn 工具执行后)把队列里所有消息注入
   * - "one-at-a-time":每次排空点只注入最早一条,其余保留
   */
  getSteeringMode(): QueueMode {
    return this.steeringMode;
  }

  /**
   * 设置 steer 队列的排空模式。
   *
   * 影响"下一次排空",不影响"当前已经在排空中的队列"。
   */
  setSteeringMode(mode: QueueMode): void {
    this.assertNotDisposed();
    this.steeringMode = mode;
  }

  /**
   * 获取 follow-up 队列的排空模式。
   *
   * - "all":agent 原本要停时把队列里所有消息注入
   * - "one-at-a-time":只注入最早一条,其余保留(agent 继续后下次再排空)
   */
  getFollowUpMode(): QueueMode {
    return this.followUpMode;
  }

  /**
   * 设置 follow-up 队列的排空模式。
   */
  setFollowUpMode(mode: QueueMode): void {
    this.assertNotDisposed();
    this.followUpMode = mode;
  }

  /** disposed 检查(私有,供 setter 调用) */
  private assertNotDisposed(): void {
    if (this.disposed) {
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
    const startResult = (await this.hooks.emit({
      type: "before_agent_start",
    } satisfies BeforeAgentStartHookEvent)) as
      | { messages?: AgentMessage[]; systemPrompt?: string }
      | undefined;

    // 1. 断言 phase 是 idle(非 idle 说明上一次 turn 没结束)
    assertPhase(this.getPhase(), "idle", "prompt");

    // 2. 切到 turn(在 try 外,断言失败时 phase 不变)
    this._setPhase("turn");

    try {
      return await this.executeTurn(text, options, startResult);
    } finally {
      // 3. 不管成功失败,phase 回 idle
      this._setPhase("idle");
    }
  }

  /**
   * 单次 turn 的实际执行(私有方法)。
   *
   * 流程(每个步骤是一个命名私有方法,这里只做编排):
   * 1. `_prepareTurnInput`     准备 nextTurn 队列 + user 消息
   * 2. `_syncSessionForTurn`   同步钩子 context + 写 user 消息
   * 3. `_buildTurnPrompt`      构造 system prompt + 初始 messages
   * 4. `_buildTurnContext`     构造 AgentContext + emit context 钩子
   * 5. `_runAgentLoopAndForward` 跑 agent-loop,转发事件到订阅者
   *
   * @param text              user 输入文本
   * @param options           可选 images
   * @param startHookResult   before_agent_start 钩子的返回
   */
  private async executeTurn(
    text: string,
    options?: { images?: Array<{ data: string; mimeType: string }> },
    startHookResult?: { messages?: AgentMessage[]; systemPrompt?: string },
  ): Promise<AgentMessage[]> {
    // 1. 准备输入(nextTurn 队列 + user 消息)
    const { userMessage, nextTurnMessages } = this._prepareTurnInput(
      text,
      options?.images,
    );

    // 2. 同步 session 状态(让 handler 看到最新 session + 写 user 消息)
    this._syncSessionForTurn(userMessage);

    // 3. 构造 prompt(system prompt + 初始 messages)
    const systemPrompt = await this._buildTurnPrompt(startHookResult);
    const initialMessages = this._combineInitialMessages(
      nextTurnMessages,
      userMessage,
      startHookResult,
    );

    // 4. 构造 AgentContext + 走 context 钩子(handler 可改 messages)
    const context = await this._buildTurnContext(initialMessages, systemPrompt);

    // 5. 跑 agent-loop,转发事件
    return await this._runAgentLoopAndForward(initialMessages, context);
  }

  /** 步骤 1:准备 turn 输入(drain nextTurn + 构造 user 消息) */
  private _prepareTurnInput(
    text: string,
    images?: Array<{ data: string; mimeType: string }>,
  ): { userMessage: AgentMessage; nextTurnMessages: AgentMessage[] } {
    const nextTurnMessages = this._drainNextTurnQueue();
    const userMessage = this.buildUserMessage(text, images);
    return { userMessage, nextTurnMessages };
  }

  /** 步骤 2:同步 session 状态(同步钩子 context + 写 user 消息) */
  private _syncSessionForTurn(userMessage: AgentMessage): void {
    this._syncHookContext();
    this.appendSessionMessage(this.getSessionInternal(), userMessage);
  }

  /** 步骤 3a:构造 system prompt(优先用 before_agent_start 注入的) */
  private async _buildTurnPrompt(
    startHookResult?: { messages?: AgentMessage[]; systemPrompt?: string },
  ): Promise<string> {
    const baseSystemPrompt =
      startHookResult?.systemPrompt ?? this.runtime.systemPrompt;
    const result = buildSystemPrompt(baseSystemPrompt, {
      model: this.runtime.model,
      tools: this.runtime.tools,
      sessionId: extractSessionId(this.getSessionInternal()),
      resources: this.runtime.resources,
    });
    return typeof result === "string" ? result : await result;
  }

  /** 步骤 3b:合并 nextTurn + user + before_agent_start 注入的消息为初始 messages */
  private _combineInitialMessages(
    nextTurnMessages: AgentMessage[],
    userMessage: AgentMessage,
    startHookResult?: { messages?: AgentMessage[]; systemPrompt?: string },
  ): AgentMessage[] {
    // 用 before_agent_start 注入的,否则用 [userMessage]
    const baseInitial = startHookResult?.messages ?? [userMessage];
    // nextTurn 消息 prepend 到 user 消息之前
    return [...nextTurnMessages, ...baseInitial];
  }

  /** 步骤 4:构造 AgentContext + emit context 钩子(handler 可改 messages) */
  private async _buildTurnContext(
    initialMessages: AgentMessage[],
    systemPrompt: string,
  ): Promise<AgentContext> {
    const context: AgentContext = {
      systemPrompt,
      messages: initialMessages,
      tools: this.runtime.tools,
    };
    const result = await this.emitAwait<{ messages?: AgentMessage[] }>({
      type: "context",
    });
    if (result?.messages !== undefined) {
      context.messages = result.messages;
    }
    return context;
  }

  /** 步骤 5:跑 agent-loop,把事件转发到订阅者,message_end 时额外处理钩子+持久化 */
  private async _runAgentLoopAndForward(
    initialMessages: AgentMessage[],
    context: AgentContext,
  ): Promise<AgentMessage[]> {
    const session = this.getSessionInternal();
    const config: AgentLoopConfig = {
      model: this.runtime.model,
      convertToLlm,
      streamFn: this.options.streamFn,
      toolExecution: "parallel",
      // 桥接:tool_call / tool_result 事件走钩子系统
      beforeToolCall: bridgeBeforeToolCall(this.hooks),
      afterToolCall: bridgeAfterToolCall(this.hooks),
      // 队列回调(agent-loop 在 turn 之间调用)
      getSteeringMessages: async () => this._drainSteerQueue(),
      getFollowUpMessages: async () => this._drainFollowUpQueue(),
    };
    return await runAgentLoop(
      initialMessages,
      context,
      config,
      async (event) => {
        if (event.type === "message_end") {
          this.emitAsync({ type: "message_end" });
          this.appendSessionMessage(session, event.message);
        }
        await this.emit(event);
      },
    );
  }

  // ── 业务方法:compact() + navigateTree() ──

  /**
   * 手动触发压缩。
   *
   * 流程:
   * 1. 断言 phase === "idle",切到 "compaction"
   * 2. emit `session_before_compact` 钩子(handler 可 cancel / 注入已有结果)
   * 3. 决定 result:优先用 hook 注入,否则调 LLM
   * 4. 写 CompactionEntry 到 session
   * 5. emit `session_compact` 钩子
   * 6. phase 回 idle(try/finally)
   *
   * @returns 压缩生成的 summary(若 cancel 或 session 缺失则返回 undefined)
   */
  async compact(): Promise<string | undefined> {
    this.assertNotDisposed();
    assertPhase(this.getPhase(), "idle", "compact");
    this._setPhase("compaction");

    try {
      const session = this.getSessionInternal();
      if (!session) {
        return undefined;
      }

      // 1. emit session_before_compact(handler 可 cancel / 注入结果)
      const beforeResult = await this.emitAwait<{
        cancel?: boolean;
        compaction?: CompactionResult;
      }>({
        type: "session_before_compact",
      });

      if (beforeResult?.cancel === true) {
        return undefined;
      }

      // 2. 决定 result:优先用 hook 注入,否则调 LLM
      let result: CompactionResult;
      if (beforeResult?.compaction) {
        result = { ...beforeResult.compaction, fromHook: true };
      } else {
        result = await runCompact(
          session,
          this.runtime.model,
          this.options.streamFn as Parameters<typeof runCompact>[2],
        );
      }

      // 3. 写 CompactionEntry
      await session.appendCompaction(
        result.summary,
        result.firstKeptEntryId,
        result.tokensBefore,
        result.details,
        result.fromHook,
      );

      // 4. emit session_compact(fire-and-forget)
      this.emitAsync({ type: "session_compact" });

      return result.summary;
    } finally {
      this._setPhase("idle");
    }
  }

  /**
   * 切换 leaf 到指定 entry,生成"被丢弃"分支的 summary(走 navigateTree 流程)。
   *
   * 流程:
   * 1. 断言 phase === "idle",切到 "branch_summary"
   * 2. emit `session_before_tree` 钩子(handler 可 cancel / 注入已有 summary)
   * 3. 决定 summary:优先用 hook 注入,否则调 LLM
   * 4. 调 session.moveTo 切 leaf + 写 BranchSummaryEntry
   * 5. emit `session_tree` 钩子
   * 6. phase 回 idle(try/finally)
   *
   * @param options.targetId  目标 entry id(null = 切到空)
   * @returns                  若写了 BranchSummaryEntry 则返回其 id,否则 undefined
   */
  async navigateTree(options: {
    targetId: string | null;
  }): Promise<string | undefined> {
    this.assertNotDisposed();
    assertPhase(this.getPhase(), "idle", "navigateTree");
    this._setPhase("branch_summary");

    try {
      const session = this.getSessionInternal();
      if (!session) {
        return undefined;
      }

      // 1. emit session_before_tree(handler 可 cancel / 注入 summary)
      const beforeResult = await this.emitAwait<{
        cancel?: boolean;
        summary?: { summary: string; details?: unknown };
        customInstructions?: string;
        label?: string;
      }>({
        type: "session_before_tree",
        targetId: options.targetId,
      });

      if (beforeResult?.cancel === true) {
        return undefined;
      }

      // 2. 决定 summary:优先用 hook 注入,否则调 LLM
      let summary: { summary: string; details?: unknown };
      if (beforeResult?.summary) {
        summary = beforeResult.summary;
      } else {
        const generated = await runGenerateBranchSummary(
          await session.getBranch(),
          options.targetId ?? "",
          this.runtime.model,
          this.options.streamFn as Parameters<typeof runGenerateBranchSummary>[3],
          { customInstructions: beforeResult?.customInstructions },
        );
        summary = generated;
      }

      // 3. 调 session.moveTo 切 leaf + 写 BranchSummaryEntry
      const branchEntryId = await session.moveTo(options.targetId, {
        summary: summary.summary,
        details: summary.details,
        fromHook: !!beforeResult?.summary,
      });

      // 4. emit session_tree(fire-and-forget)
      this.emitAsync({ type: "session_tree" });

      return branchEntryId;
    } finally {
      this._setPhase("idle");
    }
  }

  // ── 业务方法:skill() / promptFromTemplate() ──

  /**
   * 调起一个 skill(从 resources.skills 找 skill,格式化后当 user prompt 调一次)。
   *
   * @param name  skill 名(小写字母+短横线)
   * @param args  可选占位符参数
   * @returns     prompt() 的返回值(本 turn 产生的消息列表)
   * @throws      若 skill 不存在
   */
  async skill(
    name: string,
    args?: Record<string, string>,
  ): Promise<AgentMessage[]> {
    this.assertNotDisposed();
    const skills = this.runtime.resources?.skills ?? [];
    const skill: Skill | undefined = skills.find((s) => s.name === name);
    if (!skill) {
      throw new AgentHarnessError(
        `skill "${name}" 不存在(可用: ${skills.map((s) => s.name).join(", ") || "<none>"})`,
      );
    }
    const text = formatSkillInvocation(skill, args as SkillArgs | undefined);
    return this.prompt(text);
  }

  /**
   * 用 prompt template 生成 prompt(替换 {{key}} 占位符后调 prompt)。
   *
   * @param name  模板名
   * @param args  占位符参数
   * @returns     prompt() 的返回值
   * @throws      若 template 不存在
   */
  async promptFromTemplate(
    name: string,
    args: Record<string, string>,
  ): Promise<AgentMessage[]> {
    this.assertNotDisposed();
    const templates = this.runtime.resources?.promptTemplates ?? [];
    const template: PromptTemplate | undefined = templates.find(
      (t) => t.name === name,
    );
    if (!template) {
      throw new AgentHarnessError(
        `prompt template "${name}" 不存在(可用: ${templates.map((t) => t.name).join(", ") || "<none>"})`,
      );
    }
    const text = formatPromptTemplateInvocation(template, args as PromptTemplateArgs);
    return this.prompt(text);
  }

  // ── 业务方法:队列操作 ──

  /**
   * 排空 steer 队列(agent-loop 的 getSteeringMessages 回调)。
   *
   * 内联实现:直接读 `this.steerQueue` + 写 `this.steerQueue`,不走纯函数 + 借/还模式。
   * - mode === "all":drained = 全部,this.steerQueue 清空
   * - mode === "one-at-a-time":drained = 第一条,this.steerQueue 保留剩余
   *
   * 内部方法(下划线前缀),测试可调,外部不应直接访问。
   *
   * @returns 排空的 steer 消息
   */
  _drainSteerQueue(): AgentMessage[] {
    if (this.steeringMode === "all") {
      const drained = [...this.steerQueue];
      this.steerQueue = [];
      return drained;
    }
    // mode === "one-at-a-time"
    if (this.steerQueue.length === 0) return [];
    const [first, ...rest] = this.steerQueue;
    this.steerQueue = rest;
    return [first];
  }

  /**
   * 排空 follow-up 队列(agent-loop 的 getFollowUpMessages 回调)。
   *
   * 内联实现:同 _drainSteerQueue,直接读 `this.followUpQueue` + 写。
   * - mode === "all":drained = 全部,this.followUpQueue 清空
   * - mode === "one-at-a-time":drained = 第一条,this.followUpQueue 保留剩余
   *
   * 内部方法,测试可调。
   *
   * @returns 排空的 follow-up 消息
   */
  _drainFollowUpQueue(): AgentMessage[] {
    if (this.followUpMode === "all") {
      const drained = [...this.followUpQueue];
      this.followUpQueue = [];
      return drained;
    }
    // mode === "one-at-a-time"
    if (this.followUpQueue.length === 0) return [];
    const [first, ...rest] = this.followUpQueue;
    this.followUpQueue = rest;
    return [first];
  }

  /**
   * 排空 nextTurn 队列(在 prompt 入口消费,一次性全部)。
   *
   * 内部方法,测试可调。
   * nextTurn 没有 QueueMode 概念。
   *
   * @returns 排空的 nextTurn 消息
   */
  _drainNextTurnQueue(): AgentMessage[] {
    const drained = [...this.nextTurnQueue];
    this.nextTurnQueue = [];
    return drained;
  }

  /**
   * 中途插入用户消息(steer 队列)。
   *
   * 行为:把消息入队 + emit `queue_update` 钩子。
   * 实际投递由 agent-loop 的 getSteeringMessages 回调负责
   * (在每个 turn 工具执行完后排空,注入为下一轮 user 消息)。
   *
   * 不处理 phase:可在任意 phase 调,即使在 turn 中也行。
   *
   * @param text    user 文本
   * @param images  可选图片
   */
  steer(
    text: string,
    images?: Array<{ data: string; mimeType: string }>,
  ): void {
    this.assertNotDisposed();
    this.steerQueue.push(this.buildUserMessage(text, images));
    // fire-and-forget,失败由钩子系统内部 log,不影响主流程
    this.emitAsync({ type: "queue_update" });
  }

  /**
   * 排队一个用户消息,等当前 turn 自然结束再投递(follow-up 队列)。
   *
   * 行为:把消息入队 + emit `queue_update` 钩子。
   * 实际投递由 agent-loop 的 getFollowUpMessages 回调负责
   * (在 agent 原本要停时排空,让 agent 继续 turn)。
   *
   * 不处理 phase。
   *
   * @param text    user 文本
   * @param images  可选图片
   */
  followUp(
    text: string,
    images?: Array<{ data: string; mimeType: string }>,
  ): void {
    this.assertNotDisposed();
    this.followUpQueue.push(this.buildUserMessage(text, images));
    this.emitAsync({ type: "queue_update" });
  }

  /**
   * 在下一轮 user 消息之前插入前置消息(nextTurn 队列)。
   *
   * 行为:把消息入队 + emit `queue_update` 钩子。
   * 实际消费:下一次 harness.prompt() 入口会把 nextTurn 队列全部消息
   *         按入队顺序 prepend 到 user 消息之前,然后清空队列。
   *
   * 不处理 phase。
   *
   * 用途:在 prompt 之间预置上下文(例如附上历史状态、当前时间、附件说明等)。
   *
   * @param text    user 文本
   * @param images  可选图片
   */
  nextTurn(
    text: string,
    images?: Array<{ data: string; mimeType: string }>,
  ): void {
    this.assertNotDisposed();
    this.nextTurnQueue.push(this.buildUserMessage(text, images));
    this.emitAsync({ type: "queue_update" });
  }

  /** 构造 user 消息(私有,steer/followUp/nextTurn 共用) */
  private buildUserMessage(
    text: string,
    images?: Array<{ data: string; mimeType: string }>,
  ): AgentMessage {
    return {
      role: "user",
      content: buildUserContent(text, images),
      timestamp: Date.now(),
    };
  }

  // ── 内部方法 ──

  /** 设置/获取 currentAbortController(后续 Task 接入 LLM 流时用) */
  _setCurrentAbortController(controller: AbortController | null): void {
    this.currentAbortController = controller;
  }

  /** 检查 harness 是否已 dispose */
  _isDisposed(): boolean {
    return this.disposed;
  }

  // ── 生命周期:dispose ──

  /** 标记为已 dispose 并清理资源 */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abort();
    this.subscribers.clear();
    // 清空三个队列(防止 dispose 后还有遗留消息)
    this.steerQueue = [];
    this.followUpQueue = [];
    this.nextTurnQueue = [];
  }
}
