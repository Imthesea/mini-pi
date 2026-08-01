/**
 * AgentHarness 主类。
 *
 * 职责:1) 持有运行时配置(model / tools / env / session / resources / systemPrompt)
 *      2) 维护 phase 状态机(idle / turn / compaction / branch_summary)
 *      3) 暴露事件订阅接口(subscribe)、abort 能力
 *      4) 配置管理(getXxx / setXxx)
 *      5) 业务入口(prompt / compact / navigateTree / skill / promptFromTemplate)
 *      6) 钩子系统集成(emit 11 个核心事件)
 *      7) 队列操作(steer / followUp / nextTurn) + 队列模式 setter/getter
 *
 * 行数说明(Task 8 末尾实测):
 * - 本类含 8 个公开业务方法 + 9 个 setter + 8 个 getter + 完整 JSDoc
 * - 类已拆出 9 个子文件(event-bus / subscription-factory / hooks-bridge /
 *   turn-execution / hook-context-builder / compaction-ops / skill-ops /
 *   is-agent-harness / queue)
 * - 进一步拆分需突破 # 私有字段封装,反而损害可读性,故保留为单类
 *
 * 拆分文件:
 * - event-bus.ts(事件总线)、subscription-factory.ts(订阅工厂)
 * - hooks-bridge.ts(钩子 ↔ agent-loop 桥接)、turn-execution.ts(单 turn 执行)
 * - hook-context-builder.ts(钩子 context 构造)、compaction-ops.ts(压缩 + 切树)
 * - skill-ops.ts(skill / template 调起)、is-agent-harness.ts(类型守卫)
 * - queue.ts(steer / followUp / nextTurn 委托)
 *
 * 钩子事件 emit 位置(11 个核心事件):
 * - before_agent_start → prompt()
 * - context            → executeTurn() 调 runAgentLoop 前
 * - tool_call          → bridgeBeforeToolCall(AgentLoopConfig.beforeToolCall)
 * - tool_result        → bridgeAfterToolCall(AgentLoopConfig.afterToolCall)
 * - message_end        → runAgentLoop emit sink(message_end 时)
 * - model_update       → setModel() 末尾
 * - abort              → abort() 末尾
 * - session_before_compact → compact() 入口
 * - session_compact    → compact() 完成
 * - session_before_tree → navigateTree() 入口
 * - session_tree       → navigateTree() 完成
 * - queue_update       → steer() / followUp() / nextTurn() 末尾
 *
 * Task 7 增量:skill() / promptFromTemplate()(调起 skill / template 走 prompt)
 * Task 8 增量:steer() / followUp() / nextTurn()(队列操作) + QueueMode setter/getter
 */

import type { Model } from "@mimi/ai";
import type {
  AgentMessage,
  AgentTool,
  QueueMode,
  ThinkingLevel,
} from "../../types.js";
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
import { createSubscription } from "./subscription-factory.js";
import type { Session } from "../session/session.js";
import {
  runCompactOp,
  runNavigateTreeOp,
} from "./compaction-ops.js";
import { executeTurn } from "./turn-execution.js";
import {
  buildHookContext,
  loadSessionMessages,
} from "./hook-context-builder.js";
import { runSkillOp, runPromptFromTemplateOp } from "./skill-ops.js";
import {
  runSteerOp,
  runFollowUpOp,
  runNextTurnOp,
  type QueueOpDeps,
} from "./queue.js";
import { drainSteerQueue, drainFollowUpQueue } from "../queue.js";

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

  // ── 队列状态(Task 8 新增) ──

  /**
   * steer 队列:中途插入的用户消息(高优先级,中断当前 LLM 流)。
   * 调 steer(text) 时入队,agent-loop 的 getSteeringMessages 回调排空。
   */
  #steerQueue: readonly AgentMessage[] = [];

  /**
   * follow-up 队列:turn 结束后的额外用户消息(低优先级,自然延伸对话)。
   * 调 followUp(text) 时入队,agent-loop 的 getFollowUpMessages 回调排空。
   */
  #followUpQueue: readonly AgentMessage[] = [];

  /**
   * nextTurn 队列:下一轮 prompt 之前的前置消息(预置上下文)。
   * 调 nextTurn(text) 时入队,在 prompt 入口 prepend 到 user 消息。
   */
  #nextTurnQueue: readonly AgentMessage[] = [];

  /** steer 队列的排空模式("all" / "one-at-a-time"),默认 "all" */
  #steeringMode: QueueMode = "all";

  /** follow-up 队列的排空模式("all" / "one-at-a-time"),默认 "all" */
  #followUpMode: QueueMode = "all";

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

    // Task 8 增量:初始化队列模式(默认 "all",从 options 覆盖)
    this.#steeringMode = options.steeringMode ?? "all";
    this.#followUpMode = options.followUpMode ?? "all";

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
    return buildHookContext({
      harness: this,
      session,
      loadSessionMessages: (s) => this.#loadSessionMessages(s),
    });
  }

  /**
   * 从 session 加载历史消息(给 hook context 用)。
   * 内部方法:供 #buildHookContext 调用,避免每次 hook emit 时全量加载。
   * 实现委托给 hook-context-builder.ts 的 loadSessionMessages 纯函数。
   */
  async #loadSessionMessages(session: Session<any>): Promise<AgentMessage[]> {
    return loadSessionMessages(session);
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
   *
   * 实现细节见 subscription-factory.ts(纯函数,逻辑在那里)。
   */
  subscribe(): Subscription {
    return createSubscription(this.#eventBus);
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

  // ── 队列模式 getter/setter(Task 8 新增) ──

  /**
   * 获取 steer 队列的排空模式。
   *
   * - "all":每次排空点(turn 工具执行后)把队列里所有消息注入
   * - "one-at-a-time":每次排空点只注入最早一条,其余保留
   */
  getSteeringMode(): QueueMode {
    return this.#steeringMode;
  }

  /**
   * 设置 steer 队列的排空模式。
   *
   * 影响"下一次排空",不影响"当前已经在排空中的队列"。
   */
  setSteeringMode(mode: QueueMode): void {
    this.#assertNotDisposed();
    this.#steeringMode = mode;
  }

  /**
   * 获取 follow-up 队列的排空模式。
   *
   * - "all":agent 原本要停时把队列里所有消息注入
   * - "one-at-a-time":只注入最早一条,其余保留(agent 继续后下次再排空)
   */
  getFollowUpMode(): QueueMode {
    return this.#followUpMode;
  }

  /**
   * 设置 follow-up 队列的排空模式。
   */
  setFollowUpMode(mode: QueueMode): void {
    this.#assertNotDisposed();
    this.#followUpMode = mode;
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
   * 单次 turn 的实际执行(私有,委托给 turn-execution.ts)。
   *
   * Task 8 增量:在 prompt 入口 drain nextTurn 队列,把排空的消息
   * prepend 到初始 user 消息之前(预置上下文)。
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
    // Task 8 增量:消费 nextTurn 队列(一次性全部排空,prepend 到 user 消息)
    // nextTurn 消息由 nextTurn() 方法入队,只在 prompt 入口消费
    const nextTurnMessages = this._drainNextTurnQueue();

    const session = this.#options.session as Session<any> | undefined;
    return executeTurn(
      {
        runtime: this.#runtime,
        hooks: this.#hooks,
        session,
        streamFn: this.#options.streamFn,
        syncHookContext: () => this._syncHookContext(),
        emit: (event) => this.#emit(event),
        // Task 8 增量:steer / followUp 队列回调(agent-loop 在 turn 之间调用)
        getSteeringMessages: async () => this._drainSteerQueue(),
        getFollowUpMessages: async () => this._drainFollowUpQueue(),
      },
      text,
      options,
      startHookResult,
      nextTurnMessages,
    );
  }

  // ── 业务方法:compact() + navigateTree() ──

  /**
   * 手动触发压缩。
   *
   * 流程(实现细节见 compaction-ops.ts):
   * 1. 断言 phase === "idle",切到 "compaction"
   * 2. 委托 `runCompactOp` 处理钩子 + LLM + 写 session
   * 3. phase 回 idle(try/finally)
   *
   * @returns 压缩生成的 summary(若 cancel 或 session 缺失则返回 undefined)
   */
  async compact(): Promise<string | undefined> {
    this.#assertNotDisposed();
    assertPhase(this.getPhase(), "idle", "compact");
    this._setPhase("compaction");

    try {
      const session = this.#options.session as Session<any> | undefined;
      if (!session) {
        return undefined;
      }
      const result = await runCompactOp({
        session,
        model: this.#runtime.model,
        hooks: this.#hooks,
        streamFn: this.#options.streamFn,
      });
      return result?.summary;
    } finally {
      this._setPhase("idle");
    }
  }

  /**
   * 切换 leaf 到指定 entry,生成"被丢弃"分支的 summary(走 navigateTree 流程)。
   *
   * 流程(实现细节见 compaction-ops.ts):
   * 1. 断言 phase === "idle",切到 "branch_summary"
   * 2. 委托 `runNavigateTreeOp` 处理钩子 + LLM + 切 leaf
   * 3. phase 回 idle(try/finally)
   *
   * @param options.targetId  目标 entry id(null = 切到空)
   * @returns                  若写了 BranchSummaryEntry 则返回其 id,否则 undefined
   */
  async navigateTree(options: {
    targetId: string | null;
  }): Promise<string | undefined> {
    this.#assertNotDisposed();
    assertPhase(this.getPhase(), "idle", "navigateTree");
    this._setPhase("branch_summary");

    try {
      const session = this.#options.session as Session<any> | undefined;
      if (!session) {
        return undefined;
      }
      return await runNavigateTreeOp({
        session,
        model: this.#runtime.model,
        hooks: this.#hooks,
        streamFn: this.#options.streamFn,
        targetId: options.targetId,
      });
    } finally {
      this._setPhase("idle");
    }
  }

  // ── 业务方法:skill() / promptFromTemplate() ──

  /**
   * 调起一个 skill(从 resources.skills 找 skill,格式化后当 user prompt 调一次)。
   *
   * 实现细节见 skill-ops.ts(纯函数 + 依赖注入)。
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
    this.#assertNotDisposed();
    return runSkillOp(
      {
        resources: this.#runtime.resources,
        prompt: (text) => this.prompt(text),
      },
      name,
      args,
    );
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
    this.#assertNotDisposed();
    return runPromptFromTemplateOp(
      {
        resources: this.#runtime.resources,
        prompt: (text) => this.prompt(text),
      },
      name,
      args,
    );
  }

  // ── 业务方法:队列操作(Task 8 新增) ──

  /**
   * 构造队列操作需要的依赖(把 # 字段通过 getter/setter 闭包暴露)。
   *
   * 内部方法:供 steer/followUp/nextTurn 三个方法以及 turn-execution.ts 使用。
   * 不导出,外部无法直接访问。
   */
  #buildQueueOpDeps(): QueueOpDeps {
    return {
      getSteerQueue: () => this.#steerQueue,
      setSteerQueue: (q) => {
        this.#steerQueue = q;
      },
      getFollowUpQueue: () => this.#followUpQueue,
      setFollowUpQueue: (q) => {
        this.#followUpQueue = q;
      },
      getNextTurnQueue: () => this.#nextTurnQueue,
      setNextTurnQueue: (q) => {
        this.#nextTurnQueue = q;
      },
      hooks: this.#hooks,
    };
  }

  /**
   * 内部使用:排空 steer 队列(turn-execution 调)。
   *
   * 行为:按当前 steeringMode 排空,把排空结果写回 #steerQueue,
   *       返回排空的消息列表。
   *
   * @returns 排空的 steer 消息(若排空模式为 "one-at-a-time" 可能为 1 条;若为 "all" 则是全部)
   */
  _drainSteerQueue(): AgentMessage[] {
    const result = drainSteerQueue(this.#steerQueue, this.#steeringMode);
    this.#steerQueue = result.remaining;
    return result.drained;
  }

  /**
   * 内部使用:排空 follow-up 队列(turn-execution 调)。
   *
   * @returns 排空的 follow-up 消息
   */
  _drainFollowUpQueue(): AgentMessage[] {
    const result = drainFollowUpQueue(this.#followUpQueue, this.#followUpMode);
    this.#followUpQueue = result.remaining;
    return result.drained;
  }

  /**
   * 内部使用:排空 nextTurn 队列(在 prompt 入口消费)。
   *
   * nextTurn 没有 QueueMode 概念,一次性全部排空(按入队顺序 prepend 到 user 消息)。
   *
   * @returns 排空的 nextTurn 消息
   */
  _drainNextTurnQueue(): AgentMessage[] {
    const drained = [...this.#nextTurnQueue];
    this.#nextTurnQueue = [];
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
    this.#assertNotDisposed();
    runSteerOp(this.#buildQueueOpDeps(), text, images);
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
    this.#assertNotDisposed();
    runFollowUpOp(this.#buildQueueOpDeps(), text, images);
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
    this.#assertNotDisposed();
    runNextTurnOp(this.#buildQueueOpDeps(), text, images);
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
    // 清空三个队列(防止 dispose 后还有遗留消息)
    this.#steerQueue = [];
    this.#followUpQueue = [];
    this.#nextTurnQueue = [];
  }
}
