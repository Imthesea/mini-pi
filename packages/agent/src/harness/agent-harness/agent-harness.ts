import type { Model, ImageContent, TextContent } from "@mimi/ai";
import type {
  AgentContext,
  AgentLoopConfig,
  AgentMessage,
  AgentTool,
  QueueMode,
  ThinkingLevel,
} from "../../types.js";
import { assertPhase } from "../phase.js";
import { AgentHarnessError, HarnessConfigError } from "../errors.js";
import type { AgentHarnessPhase } from "../phase.js";
import type { AgentHarnessEvent } from "../types/events.js";
import type { AgentHarnessHookContext } from "../hooks/index.js";
import { DefaultAgentHarnessHooks } from "../hooks/index.js";
import type {
  AgentHarnessOptions,
  AgentHarnessResources,
  AgentHarnessStreamOptions,
} from "../types/options.js";
import { runAgentLoop } from "../../agent-loop.js";
import { convertToLlm } from "../messages/convert.js";
import { buildSystemPrompt } from "../system-prompt/index.js";
import { formatSkillInvocation } from "../skills/format.js";
import { formatPromptTemplateInvocation } from "../prompt-templates/format.js";
import { compact as runCompact } from "../compaction/compact.js";
import { generateBranchSummary as runGenerateBranchSummary } from "../compaction/branch-summarization.js";
import type { CompactionResult } from "../compaction/types.js";
import type { Skill, SkillArgs } from "../skills/types.js";
import type { PromptTemplate, PromptTemplateArgs } from "../prompt-templates/types.js";
import type { Session } from "../session/session.js";

// ── 类型 ──
type AgentHarnessHandler = (event: any, signal?: AbortSignal) => Promise<any> | any;

export type AgentHarnessListener = (
  event: AgentHarnessEvent,
  signal?: AbortSignal,
) => void | Promise<void>;

/** 通配符:订阅所有事件类型 */
const SUBSCRIBER_EVENT_TYPE = "*";

/**
 * 回合状态快照:每轮 prompt 开头构建一次,是本轮所有读取的统一来源(对齐 pi 的 createTurnState)。
 *
 * - messages:session 持久化的历史消息(作为 context.messages,而非本轮新消息)
 * - sessionId / systemPrompt:本轮解析好的值(含 skills 块)
 */
interface AgentHarnessTurnState {
  messages: AgentMessage[];
  sessionId: string;
  systemPrompt: string;
}
// ── 主类 ──
export class AgentHarness<
  TSkill extends Skill = Skill,
  TPromptTemplate extends PromptTemplate = PromptTemplate,
  TTool extends AgentTool = AgentTool,
> {
  // ── 构造选项(保留引用,用于 streamFn / compaction 等) ──
  private options: AgentHarnessOptions<TSkill, TPromptTemplate, TTool>;

  private session: Session;
  private model: Model<any>;
  private thinkingLevel: ThinkingLevel | undefined;
  private systemPrompt: AgentHarnessOptions<TSkill, TPromptTemplate, TTool>["systemPrompt"];
  private streamOptions: AgentHarnessStreamOptions | undefined;
  private resources: AgentHarnessResources<TSkill, TPromptTemplate> | undefined;
  private tools = new Map<string, TTool>();

  // ── 阶段 + 订阅 + 钩子 ──
  private phase: AgentHarnessPhase = "idle";
  private handlers = new Map<string, Set<AgentHarnessHandler>>();
  private hooks: DefaultAgentHarnessHooks;
  private currentAbortController: AbortController | null = null;

  private steerQueue: AgentMessage[] = [];
  private followUpQueue: AgentMessage[] = [];
  private nextTurnQueue: AgentMessage[] = [];
  private steeringMode: QueueMode = "one-at-a-time";
  private followUpMode: QueueMode = "one-at-a-time";

  // ── 构造 ──
  constructor(options: AgentHarnessOptions<TSkill, TPromptTemplate, TTool>) {
    this.validateOptions(options);
    this.options = options;
    this.session = options.session;
    this.model = options.model;
    this.thinkingLevel = options.thinkingLevel;
    this.systemPrompt = options.systemPrompt;
    this.streamOptions = options.streamOptions;
    this.resources = options.resources;
    for (const tool of options.tools) {
      this.tools.set(tool.name, tool);
    }
    this.steeringMode = options.steeringMode ?? "one-at-a-time";
    this.followUpMode = options.followUpMode ?? "one-at-a-time";
    this.hooks =
      (options.hooks as DefaultAgentHarnessHooks | undefined) ??
      new DefaultAgentHarnessHooks({ context: this.buildHookContext() });
  }

  private validateOptions(
    options: AgentHarnessOptions<TSkill, TPromptTemplate, TTool>,
  ): void {
    if (!options.model) throw new HarnessConfigError("options.model 必填");
    if (!options.tools) throw new HarnessConfigError("options.tools 必填(可传空数组)");
    if (!options.env) throw new HarnessConfigError("options.env 必填");
    if (!options.session) throw new HarnessConfigError("options.session 必填");
  }

  // ── Hook context ──

  private buildHookContext(messages: AgentMessage[] = []): AgentHarnessHookContext {
    return {
      harness: this,
      session: {
        getId: () =>
          this.session.getMetadata().then((m) => m.id).catch(() => "unknown"),
        getMessages: () => this.loadSessionMessages(),
      },
      messages,
    };
  }

  private async loadSessionMessages(): Promise<AgentMessage[]> {
    try {
      const context = await this.session.buildContext();
      return context.messages;
    } catch {
      return [];
    }
  }

  private syncHookContext(messages: AgentMessage[] = []): void {
    this.hooks.setContext(this.buildHookContext(messages));
  }

  // ── Phase ──
  getPhase(): AgentHarnessPhase {
    return this.phase;
  }

  _setPhase(phase: AgentHarnessPhase): void {
    this.phase = phase;
  }

  // ── emit:一个 emitHook<T>,调用方自己控制是否 await ──

  /**
   * 派发钩子事件(走 DefaultAgentHarnessHooks 语义路由)。
   *
   * - 需要结果:`const r = await this.emitHook<T>({...})`
   * - 不需要结果:`void this.emitHook({...})`(fire-and-forget)
   *
   * as any 集中到这里:HookEvent 泛型要求字面量带 __result 字段,
   * TS 写不出来。业务方法里不再有 as any。
   */
  private async emitHook<T = unknown>(
    event: { type: string; [key: string]: unknown },
  ): Promise<T | undefined> {
    return (await this.hooks.emit(event as any)) as T | undefined;
  }

  /**
   * 派发 AgentEvent 给订阅者(遍历 "*" handlers,顺序 await)。
   * 跟 pi 的 emitAny 1:1。
   */
  private async emit(event: AgentHarnessEvent): Promise<void> {
    const handlers = this.handlers.get(SUBSCRIBER_EVENT_TYPE);
    if (!handlers) return;
    for (const handler of handlers) {
      await handler(event);
    }
  }

  // ── 订阅(push 模式,跟 pi 1:1) ──

  /** 订阅所有事件(等价于 on("*", listener)) */
  subscribe(listener: AgentHarnessListener): () => void {
    return this.on(SUBSCRIBER_EVENT_TYPE, listener);
  }

  /** 按事件类型注册 handler */
  on(type: string, handler: AgentHarnessHandler): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler);
    return () => {
      set!.delete(handler);
      if (set!.size === 0) this.handlers.delete(type);
    };
  }

  // ── 中止 ──

  abort(): void {
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }
    if (this.phase !== "idle") {
      this.phase = "idle";
    }
    void this.emitHook({ type: "abort" });
  }

  // ── Getters ──

  getModel(): Model<any> { return this.model; }
  getTools(): TTool[] { return Array.from(this.tools.values()); }
  getThinkingLevel(): ThinkingLevel | undefined { return this.thinkingLevel; }
  getSession(): Session { return this.session; }
  getResources(): AgentHarnessResources<TSkill, TPromptTemplate> | undefined { return this.resources; }
  getStreamOptions(): AgentHarnessStreamOptions | undefined { return this.streamOptions; }
  getSystemPrompt() { return this.systemPrompt; }
  getHooks(): DefaultAgentHarnessHooks { return this.hooks; }

  setModel(model: Model<any>): void {
    this.model = model;
    void this.emitHook({ type: "model_update" });
  }

  setTools(tools: TTool[]): void {
    this.tools = new Map(tools.map((t) => [t.name, t]));
  }

  setThinkingLevel(level: ThinkingLevel | undefined): void {
    this.thinkingLevel = level;
  }

  // 预留 API(pi 没有 setSession,运行时不允许切换)
  setSession(session: Session): void {
    this.session = session;
  }

  setResources(
    resources: AgentHarnessResources<TSkill, TPromptTemplate> | undefined,
  ): void {
    this.resources = resources;
  }

  setStreamOptions(options: AgentHarnessStreamOptions | undefined): void {
    this.streamOptions = options;
  }

  setSystemPrompt(
    prompt: AgentHarnessOptions<TSkill, TPromptTemplate, TTool>["systemPrompt"],
  ): void {
    this.systemPrompt = prompt;
  }

  // ── 队列模式 ──

  getSteeringMode(): QueueMode { return this.steeringMode; }
  setSteeringMode(mode: QueueMode): void { this.steeringMode = mode; }
  getFollowUpMode(): QueueMode { return this.followUpMode; }
  setFollowUpMode(mode: QueueMode): void { this.followUpMode = mode; }

  // ── 业务:prompt() ──

  /**
   * 每轮构建一次"回合状态"快照(对齐 pi 的 createTurnState):
   * session 历史 + sessionId + 拼装好的 systemPrompt(含 skills 块)。
   */
  private async createTurnState(): Promise<AgentHarnessTurnState> {
    const messages = await this.loadSessionMessages();
    let sessionId = "default";
    try {
      sessionId = (await this.session.getMetadata()).id;
    } catch {
      // session 未就绪时回落到默认 id
    }
    const systemPrompt = await buildSystemPrompt(this.systemPrompt, {
      model: this.model,
      tools: this.getTools(),
      sessionId,
      resources: this.resources,
    });
    return { messages, sessionId, systemPrompt };
  }

  /**
   * 把回合状态投影成 agent 上下文(对齐 pi 的 createContext)。
   *
   * - messages 用 .slice() 浅拷贝,避免 agent-loop 就地修改回写 turnState
   * - systemPrompt 可被 before_agent_start 钩子整体覆盖
   */
  private createContext(
    turnState: AgentHarnessTurnState,
    systemPrompt?: string,
  ): AgentContext {
    return {
      systemPrompt: systemPrompt ?? turnState.systemPrompt,
      messages: turnState.messages.slice(),
      tools: this.getTools(),
    };
  }

  async prompt(
    text: string,
    options?: { images?: Array<{ data: string; mimeType: string }> },
  ): Promise<AgentMessage[]> {
    assertPhase(this.phase, "idle", "prompt");
    this.phase = "turn";

    try {
      // 1. 每轮快照:session 历史 + sessionId + systemPrompt(本轮读取的统一来源)
      const turnState = await this.createTurnState();

      // 2. 本轮新消息:nextTurn 队列(全部消费)+ 用户消息
      const queuedMessages = await this.drainQueue(this.nextTurnQueue, "all");
      const messages: AgentMessage[] = [
        ...queuedMessages,
        {
          role: "user",
          content: this.buildUserContent(text, options?.images),
          timestamp: Date.now(),
        },
      ];

      // 3. before_agent_start 钩子:追加 messages;systemPrompt 覆盖在下方 createContext 处
      //    事件携带本轮入参(prompt / images / 已拼好的 systemPrompt / resources),对齐 pi
      const startResult = await this.emitHook<{
        messages?: AgentMessage[];
        systemPrompt?: string;
      }>({
        type: "before_agent_start",
        prompt: text,
        images: options?.images,
        systemPrompt: turnState.systemPrompt,
        resources: this.resources,
      });
      if (startResult?.messages) {
        messages.push(...startResult.messages);
      }

      // 4. 跑 agent-loop
      //    prompts = 本轮新消息;context.messages = session 历史(两处职责分离,不会重复)
      const config: AgentLoopConfig = {
        model: this.model,
        convertToLlm,
        streamFn: this.options.streamFn,
        toolExecution: "parallel",
        transformContext: this.bridgeTransformContext(),
        beforeToolCall: this.bridgeBeforeToolCall(),
        afterToolCall: this.bridgeAfterToolCall(),
        getSteeringMessages: async () =>
          this.drainQueue(this.steerQueue, this.steeringMode),
        getFollowUpMessages: async () =>
          this.drainQueue(this.followUpQueue, this.followUpMode),
      };

      return await runAgentLoop(
        messages,
        this.createContext(turnState, startResult?.systemPrompt),
        config,
        async (event) => {
          if (event.type === "message_end") {
            this.tryAppendSession(event.message);
            void this.emitHook({ type: "message_end" });
          }
          await this.emit(event);
        },
      );
    } finally {
      this.phase = "idle";
    }
  }

  // ── hooks-bridge(从 hooks-bridge.ts inline) ──

  /**
   * context 钩子桥:每次 LLM 调用前对真实 messages 做链式转换(对齐 pi 的 transformContext)。
   *
   * 先把当前 messages 同步进 hook context,让 context 链式 handler 能读到;
   * 钩子返回新 messages 时覆盖原链,否则原样返回。
   */
  private bridgeTransformContext(): AgentLoopConfig["transformContext"] {
    return async (messages) => {
      this.syncHookContext(messages);
      const result = await this.emitHook<{ messages?: AgentMessage[] }>({
        type: "context",
      });
      return result?.messages ?? messages;
    };
  }

  private bridgeBeforeToolCall(): AgentLoopConfig["beforeToolCall"] {
    return async (ctx, signal) => {
      const hookResult = (await this.hooks.emit(
        {
          type: "tool_call",
          toolCall: ctx.toolCall,
          args: ctx.args,
          context: ctx.context,
          assistantMessage: ctx.assistantMessage,
        },
        signal,
      )) as { block?: boolean; reason?: string } | undefined;

      if (hookResult?.block === true) return hookResult;
      return hookResult ?? undefined;
    };
  }

  private bridgeAfterToolCall(): AgentLoopConfig["afterToolCall"] {
    return async (_ctx, signal) => {
      const hookResult = (await this.hooks.emit(
        { type: "tool_result" },
        signal,
      )) as {
        content?: unknown;
        details?: unknown;
        isError?: boolean;
        terminate?: boolean;
      } | undefined;

      if (!hookResult) return undefined;
      return {
        content: hookResult.content as any,
        details: hookResult.details,
        isError: hookResult.isError,
        terminate: hookResult.terminate,
      };
    };
  }

  // ── helpers(从 helpers.ts inline) ──

  private buildUserContent(
    text: string,
    images?: Array<{ data: string; mimeType: string }>,
  ): string | (TextContent | ImageContent)[] {
    if (!images || images.length === 0) return text;
    const content: (TextContent | ImageContent)[] = [{ type: "text", text }];
    for (const img of images) {
      content.push({
        type: "image",
        data: img.data,
        mimeType: img.mimeType as ImageContent["mimeType"],
      });
    }
    return content;
  }

  // ── session 写入(fire-and-forget,失败只 log) ──

  private tryAppendSession(message: AgentMessage): void {
    void this.session.appendMessage(message).catch((err) => {
      console.error("[AgentHarness] session.appendMessage failed:", err);
    });
  }

  // ── 队列排空(统一逻辑,替代 3 个 _drainXxxQueue 各自重复) ──
  //
  // 与 pi 的 drainQueuedMessages 对齐:
  // - 消费后 emit queue_update(入队、出队都通知订阅者)
  // - emit 失败时回滚已取出的消息,保持队列完整

  private async drainQueue(queue: AgentMessage[], mode: QueueMode): Promise<AgentMessage[]> {
    const messages = mode === "all" ? queue.splice(0) : queue.splice(0, 1);
    if (messages.length === 0) return messages;
    try {
      await this.emitHook({ type: "queue_update" });
      return messages;
    } catch (error) {
      queue.unshift(...messages);
      throw error;
    }
  }

  // 测试用内部方法(下划线前缀)
  _drainSteerQueue(): Promise<AgentMessage[]> {
    return this.drainQueue(this.steerQueue, this.steeringMode);
  }
  _drainFollowUpQueue(): Promise<AgentMessage[]> {
    return this.drainQueue(this.followUpQueue, this.followUpMode);
  }
  _drainNextTurnQueue(): Promise<AgentMessage[]> {
    return this.drainQueue(this.nextTurnQueue, "all");
  }

  // ── 队列操作(公开 API) ──

  steer(text: string, images?: Array<{ data: string; mimeType: string }>): void {
    this.steerQueue.push({
      role: "user",
      content: this.buildUserContent(text, images),
      timestamp: Date.now(),
    });
    void this.emitHook({ type: "queue_update" });
  }

  followUp(text: string, images?: Array<{ data: string; mimeType: string }>): void {
    this.followUpQueue.push({
      role: "user",
      content: this.buildUserContent(text, images),
      timestamp: Date.now(),
    });
    void this.emitHook({ type: "queue_update" });
  }

  nextTurn(text: string, images?: Array<{ data: string; mimeType: string }>): void {
    this.nextTurnQueue.push({
      role: "user",
      content: this.buildUserContent(text, images),
      timestamp: Date.now(),
    });
    void this.emitHook({ type: "queue_update" });
  }

  // ── 业务:compact() ──

  async compact(): Promise<string | undefined> {
    assertPhase(this.phase, "idle", "compact");
    this.phase = "compaction";

    try {
      const beforeResult = await this.emitHook<{
        cancel?: boolean;
        compaction?: CompactionResult;
      }>({ type: "session_before_compact" });

      if (beforeResult?.cancel === true) return undefined;

      let result: CompactionResult;
      if (beforeResult?.compaction) {
        result = { ...beforeResult.compaction, fromHook: true };
      } else {
        result = await runCompact(
          this.session,
          this.model,
          this.options.streamFn as Parameters<typeof runCompact>[2],
        );
      }

      await this.session.appendCompaction(
        result.summary,
        result.firstKeptEntryId,
        result.tokensBefore,
        result.details,
        result.fromHook,
      );
      void this.emitHook({ type: "session_compact" });
      return result.summary;
    } finally {
      this.phase = "idle";
    }
  }

  // ── 业务:navigateTree() ──

  async navigateTree(options: {
    targetId: string | null;
  }): Promise<string | undefined> {
    assertPhase(this.phase, "idle", "navigateTree");
    this.phase = "branch_summary";

    try {
      const beforeResult = await this.emitHook<{
        cancel?: boolean;
        summary?: { summary: string; details?: unknown };
        customInstructions?: string;
        label?: string;
      }>({
        type: "session_before_tree",
        targetId: options.targetId,
      });

      if (beforeResult?.cancel === true) return undefined;

      let summary: { summary: string; details?: unknown };
      if (beforeResult?.summary) {
        summary = beforeResult.summary;
      } else {
        summary = await runGenerateBranchSummary(
          await this.session.getBranch(),
          options.targetId ?? "",
          this.model,
          this.options.streamFn as Parameters<typeof runGenerateBranchSummary>[3],
          { customInstructions: beforeResult?.customInstructions },
        );
      }

      const branchEntryId = await this.session.moveTo(options.targetId, {
        summary: summary.summary,
        details: summary.details,
        fromHook: !!beforeResult?.summary,
      });
      void this.emitHook({ type: "session_tree" });
      return branchEntryId;
    } finally {
      this.phase = "idle";
    }
  }

  // ── 业务:skill() / promptFromTemplate() ──

  async skill(
    name: string,
    args?: Record<string, string>,
  ): Promise<AgentMessage[]> {
    const skills = this.resources?.skills ?? [];
    const skill = skills.find((s) => s.name === name);
    if (!skill) {
      throw new AgentHarnessError(
        `skill "${name}" 不存在(可用: ${skills.map((s) => s.name).join(", ") || "<none>"})`,
      );
    }
    return this.prompt(formatSkillInvocation(skill, args as SkillArgs | undefined));
  }

  async promptFromTemplate(
    name: string,
    args: Record<string, string>,
  ): Promise<AgentMessage[]> {
    const templates = this.resources?.promptTemplates ?? [];
    const template = templates.find((t) => t.name === name);
    if (!template) {
      throw new AgentHarnessError(
        `prompt template "${name}" 不存在(可用: ${templates.map((t) => t.name).join(", ") || "<none>"})`,
      );
    }
    return this.prompt(
      formatPromptTemplateInvocation(template, args as PromptTemplateArgs),
    );
  }
}
