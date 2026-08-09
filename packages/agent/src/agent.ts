/**
 * Agent —— 有状态的 agent-loop 包装器。
 *
 * 从 pi 项目的 `packages/agent/src/agent.ts` 完整翻译而来。
 * 持有 AgentState（messages / tools / systemPrompt / model / thinkingLevel），
 * 暴露 prompt() / continue() / abort() 入口，
 * 提供 subscribe() 事件订阅 + steer/followUp 队列管理。
 *
 * 内部调用已有的 runAgentLoop（agent-loop.ts），不重写。
 * AgentHarness 不受影响，两者独立存在（与 Pi 一致）。
 */

import type {
  AgentContext,
  AgentEvent,
  AgentLoopConfig,
  AgentMessage,
  AgentTool,
  AfterToolCallContext,
  AfterToolCallResult,
  BeforeToolCallContext,
  BeforeToolCallResult,
  AgentLoopTurnUpdate,
  PrepareNextTurnContext,
  StreamFn,
  QueueMode,
  ToolExecutionMode,
  ThinkingLevel,
} from "./types.js";
import { runAgentLoop } from "./agent-loop.js";
import type { ImageContent, TextContent, Model, Message } from "@mimi/ai";

// ── 默认 convertToLlm ──

function defaultConvertToLlm(messages: AgentMessage[]): Message[] {
  return messages.filter(
    (m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult",
  ) as Message[];
}

// ── 空用量 ──

const EMPTY_USAGE = {
  input: 0,
  output: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, total: 0 },
};

const DEFAULT_MODEL: Model<any> = {
  id: "unknown",
  name: "unknown",
  api: "openai-completions",
  provider: "unknown",
  baseUrl: "",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0 },
  contextWindow: 0,
  maxTokens: 0,
};

// ── AgentState ──

export interface AgentState {
  systemPrompt: string;
  model: Model<any>;
  thinkingLevel: ThinkingLevel;
  messages: AgentMessage[];
  tools: AgentTool<any>[];
  isStreaming: boolean;
  streamingMessage?: AgentMessage;
  pendingToolCalls: Set<string>;
  errorMessage?: string;
}

type MutableAgentState = Omit<
  AgentState,
  "isStreaming" | "streamingMessage" | "pendingToolCalls" | "errorMessage"
> & {
  isStreaming: boolean;
  streamingMessage?: AgentMessage;
  pendingToolCalls: Set<string>;
  errorMessage?: string;
};

function createMutableAgentState(
  initialState?: Partial<
    Omit<AgentState, "pendingToolCalls" | "isStreaming" | "streamingMessage" | "errorMessage">
  >,
): MutableAgentState {
  let tools = initialState?.tools?.slice() ?? [];
  let messages = initialState?.messages?.slice() ?? [];

  return {
    systemPrompt: initialState?.systemPrompt ?? "",
    model: initialState?.model ?? DEFAULT_MODEL,
    thinkingLevel: initialState?.thinkingLevel ?? "off",
    get tools() {
      return tools;
    },
    set tools(nextTools: AgentTool<any>[]) {
      tools = nextTools.slice();
    },
    get messages() {
      return messages;
    },
    set messages(nextMessages: AgentMessage[]) {
      messages = nextMessages.slice();
    },
    isStreaming: false,
    streamingMessage: undefined,
    pendingToolCalls: new Set<string>(),
    errorMessage: undefined,
  };
}

// ── AgentOptions ──

export interface AgentOptions {
  initialState?: Partial<
    Omit<AgentState, "pendingToolCalls" | "isStreaming" | "streamingMessage" | "errorMessage">
  >;
  convertToLlm?: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
  transformContext?: (
    messages: AgentMessage[],
    signal?: AbortSignal,
  ) => Promise<AgentMessage[]>;
  streamFn?: StreamFn;
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
  beforeToolCall?: (
    context: BeforeToolCallContext,
    signal?: AbortSignal,
  ) => Promise<BeforeToolCallResult | undefined>;
  afterToolCall?: (
    context: AfterToolCallContext,
    signal?: AbortSignal,
  ) => Promise<AfterToolCallResult | undefined>;
  prepareNextTurn?: (
    signal?: AbortSignal,
  ) => Promise<AgentLoopTurnUpdate | undefined> | AgentLoopTurnUpdate | undefined;
  prepareNextTurnWithContext?: (
    context: PrepareNextTurnContext,
    signal?: AbortSignal,
  ) => Promise<AgentLoopTurnUpdate | undefined> | AgentLoopTurnUpdate | undefined;
  steeringMode?: QueueMode;
  followUpMode?: QueueMode;
  sessionId?: string;
  maxRetryDelayMs?: number;
  toolExecution?: ToolExecutionMode;
}

// ── PendingMessageQueue ──

class PendingMessageQueue {
  private messages: AgentMessage[] = [];
  public mode: QueueMode;

  constructor(mode: QueueMode) {
    this.mode = mode;
  }

  enqueue(message: AgentMessage): void {
    this.messages.push(message);
  }

  hasItems(): boolean {
    return this.messages.length > 0;
  }

  drain(): AgentMessage[] {
    if (this.mode === "all") {
      const drained = this.messages.slice();
      this.messages = [];
      return drained;
    }
    const first = this.messages[0];
    if (!first) {
      return [];
    }
    this.messages = this.messages.slice(1);
    return [first];
  }

  clear(): void {
    this.messages = [];
  }
}

// ── ActiveRun ──

type ActiveRun = {
  promise: Promise<void>;
  resolve: () => void;
  abortController: AbortController;
};

// ── Agent ──

export class Agent {
  private _state: MutableAgentState;
  private readonly listeners = new Set<
    (event: AgentEvent, signal: AbortSignal) => Promise<void> | void
  >();
  private readonly steeringQueue: PendingMessageQueue;
  private readonly followUpQueue: PendingMessageQueue;

  public convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
  public transformContext?: (
    messages: AgentMessage[],
    signal?: AbortSignal,
  ) => Promise<AgentMessage[]>;
  public streamFn: StreamFn;
  public getApiKey?: (
    provider: string,
  ) => Promise<string | undefined> | string | undefined;
  public beforeToolCall?: (
    context: BeforeToolCallContext,
    signal?: AbortSignal,
  ) => Promise<BeforeToolCallResult | undefined>;
  public afterToolCall?: (
    context: AfterToolCallContext,
    signal?: AbortSignal,
  ) => Promise<AfterToolCallResult | undefined>;
  public prepareNextTurn?: (
    signal?: AbortSignal,
  ) => Promise<AgentLoopTurnUpdate | undefined> | AgentLoopTurnUpdate | undefined;
  public prepareNextTurnWithContext?: (
    context: PrepareNextTurnContext,
    signal?: AbortSignal,
  ) => Promise<AgentLoopTurnUpdate | undefined> | AgentLoopTurnUpdate | undefined;
  private activeRun?: ActiveRun;
  public sessionId?: string;
  public maxRetryDelayMs?: number;
  public toolExecution: ToolExecutionMode;

  constructor(options: AgentOptions = {}) {
    this._state = createMutableAgentState(options.initialState);
    this.convertToLlm = options.convertToLlm ?? defaultConvertToLlm;
    this.transformContext = options.transformContext;
    this.streamFn = options.streamFn ?? this._defaultStreamFn;
    this.getApiKey = options.getApiKey;
    this.beforeToolCall = options.beforeToolCall;
    this.afterToolCall = options.afterToolCall;
    this.prepareNextTurn = options.prepareNextTurn;
    this.prepareNextTurnWithContext = options.prepareNextTurnWithContext;
    this.steeringQueue = new PendingMessageQueue(options.steeringMode ?? "one-at-a-time");
    this.followUpQueue = new PendingMessageQueue(options.followUpMode ?? "one-at-a-time");
    this.sessionId = options.sessionId;
    this.maxRetryDelayMs = options.maxRetryDelayMs;
    this.toolExecution = options.toolExecution ?? "parallel";
  }

  /** 默认 streamFn：占位，构造时若未注入 streamFn 会抛错 */
  private _defaultStreamFn: StreamFn = (() => {
    throw new Error(
      "Agent.streamFn not set. Pass streamFn in Agent constructor or inject via AgentSession.",
    );
  }) as unknown as StreamFn;

  // ── 状态 ──

  get state(): AgentState {
    return this._state;
  }

  set steeringMode(mode: QueueMode) {
    this.steeringQueue.mode = mode;
  }
  get steeringMode(): QueueMode {
    return this.steeringQueue.mode;
  }

  set followUpMode(mode: QueueMode) {
    this.followUpQueue.mode = mode;
  }
  get followUpMode(): QueueMode {
    return this.followUpQueue.mode;
  }

  // ── 队列 ──

  steer(message: AgentMessage): void {
    this.steeringQueue.enqueue(message);
  }

  followUp(message: AgentMessage): void {
    this.followUpQueue.enqueue(message);
  }

  clearSteeringQueue(): void {
    this.steeringQueue.clear();
  }

  clearFollowUpQueue(): void {
    this.followUpQueue.clear();
  }

  clearAllQueues(): void {
    this.clearSteeringQueue();
    this.clearFollowUpQueue();
  }

  hasQueuedMessages(): boolean {
    return this.steeringQueue.hasItems() || this.followUpQueue.hasItems();
  }

  get signal(): AbortSignal | undefined {
    return this.activeRun?.abortController.signal;
  }

  // ── 订阅 ──

  subscribe(
    listener: (event: AgentEvent, signal: AbortSignal) => Promise<void> | void,
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ── 中止 ──

  abort(): void {
    this.activeRun?.abortController.abort();
  }

  waitForIdle(): Promise<void> {
    return this.activeRun?.promise ?? Promise.resolve();
  }

  reset(): void {
    this._state.messages = [];
    this._state.isStreaming = false;
    this._state.streamingMessage = undefined;
    this._state.pendingToolCalls = new Set<string>();
    this._state.errorMessage = undefined;
    this.clearFollowUpQueue();
    this.clearSteeringQueue();
  }

  // ── 入口 ──

  async prompt(input: string, images?: ImageContent[]): Promise<void> {
    if (this.activeRun) {
      throw new Error("Agent is already processing a prompt.");
    }
    const messages = this._normalizePromptInput(input, images);
    await this._runPromptMessages(messages);
  }

  async continue(): Promise<void> {
    if (this.activeRun) {
      throw new Error("Agent is already processing.");
    }

    const lastMessage = this._state.messages[this._state.messages.length - 1];
    if (!lastMessage) {
      throw new Error("No messages to continue from");
    }

    if (lastMessage.role === "assistant") {
      // 先检查 steer 队列
      const queuedSteering = this.steeringQueue.drain();
      if (queuedSteering.length > 0) {
        await this._runPromptMessages(queuedSteering, { skipInitialSteeringPoll: true });
        return;
      }

      const queuedFollowUps = this.followUpQueue.drain();
      if (queuedFollowUps.length > 0) {
        await this._runPromptMessages(queuedFollowUps);
        return;
      }

      throw new Error("Cannot continue from message role: assistant");
    }

    await this._runContinuation();
  }

  // ── 内部 ──

  private _normalizePromptInput(input: string, images?: ImageContent[]): AgentMessage[] {
    const content: Array<TextContent | ImageContent> = [{ type: "text", text: input }];
    if (images && images.length > 0) {
      content.push(...images);
    }
    return [{ role: "user", content, timestamp: Date.now() }];
  }

  private async _runPromptMessages(
    messages: AgentMessage[],
    options: { skipInitialSteeringPoll?: boolean } = {},
  ): Promise<void> {
    await this._runWithLifecycle(async (signal) => {
      await runAgentLoop(
        messages,
        this._createContextSnapshot(),
        this._createLoopConfig(options),
        (event) => this._processEvents(event),
        signal,
        this.streamFn,
      );
    });
  }

  private async _runContinuation(): Promise<void> {
    // 续接：传空 prompts 数组，runAgentLoop 内部按"继续模式"处理
    await this._runWithLifecycle(async (signal) => {
      await runAgentLoop(
        [],
        this._createContextSnapshot(),
        this._createLoopConfig(),
        (event) => this._processEvents(event),
        signal,
        this.streamFn,
      );
    });
  }

  private _createContextSnapshot(): AgentContext {
    return {
      systemPrompt: this._state.systemPrompt,
      messages: this._state.messages.slice(),
      tools: this._state.tools.slice(),
    };
  }

  private _createLoopConfig(
    options: { skipInitialSteeringPoll?: boolean } = {},
  ): AgentLoopConfig {
    let skipInitialSteeringPoll = options.skipInitialSteeringPoll === true;
    return {
      model: this._state.model,
      convertToLlm: this.convertToLlm,
      transformContext: this.transformContext,
      getApiKey: this.getApiKey,
      beforeToolCall: this.beforeToolCall,
      afterToolCall: this.afterToolCall,
      prepareNextTurn: this.prepareNextTurnWithContext
        ? (context) => this.prepareNextTurnWithContext!(context, this.signal)
        : this.prepareNextTurn
          ? () => this.prepareNextTurn!(this.signal)
          : undefined,
      toolExecution: this.toolExecution,
      maxRetryDelayMs: this.maxRetryDelayMs,
      getSteeringMessages: async () => {
        if (skipInitialSteeringPoll) {
          skipInitialSteeringPoll = false;
          return [];
        }
        return this.steeringQueue.drain();
      },
      getFollowUpMessages: async () => this.followUpQueue.drain(),
    };
  }

  private async _runWithLifecycle(
    executor: (signal: AbortSignal) => Promise<void>,
  ): Promise<void> {
    if (this.activeRun) {
      throw new Error("Agent is already processing.");
    }

    const abortController = new AbortController();
    let resolvePromise = () => {};
    const promise = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });
    this.activeRun = { promise, resolve: resolvePromise, abortController };

    this._state.isStreaming = true;
    this._state.streamingMessage = undefined;
    this._state.errorMessage = undefined;

    try {
      await executor(abortController.signal);
    } catch (error) {
      await this._handleRunFailure(error, abortController.signal.aborted);
    } finally {
      this._finishRun();
    }
  }

  private async _handleRunFailure(error: unknown, aborted: boolean): Promise<void> {
    const failureMessage: AgentMessage = {
      role: "assistant",
      content: [{ type: "text", text: "" }],
      api: this._state.model.api,
      provider: this._state.model.provider,
      model: this._state.model.id,
      usage: EMPTY_USAGE,
      stopReason: aborted ? "aborted" : "error",
      errorMessage: error instanceof Error ? error.message : String(error),
      timestamp: Date.now(),
    } as AgentMessage;

    await this._processEvents({ type: "message_start", message: failureMessage });
    await this._processEvents({ type: "message_end", message: failureMessage });
    await this._processEvents({
      type: "turn_end",
      message: failureMessage,
      toolResults: [],
    });
    await this._processEvents({
      type: "agent_end",
      messages: [failureMessage],
    });
  }

  private _finishRun(): void {
    this._state.isStreaming = false;
    this._state.streamingMessage = undefined;
    this._state.pendingToolCalls = new Set<string>();
    this.activeRun?.resolve();
    this.activeRun = undefined;
  }

  /**
   * 将 agent-loop 事件 Reduce 到内部状态，然后 await 所有监听器。
   *
   * agent_end 只表示不再有新 loop 事件。Run 在所有 agent_end 监听器
   * 完成 + finishRun() 清理运行时状态之后才算真正的空闲。
   */
  private async _processEvents(event: AgentEvent): Promise<void> {
    switch (event.type) {
      case "message_start":
        this._state.streamingMessage = event.message;
        break;

      case "message_update":
        this._state.streamingMessage = event.message;
        break;

      case "message_end":
        this._state.streamingMessage = undefined;
        this._state.messages.push(event.message);
        break;

      case "tool_execution_start": {
        const pendingToolCalls = new Set(this._state.pendingToolCalls);
        pendingToolCalls.add(event.toolCallId);
        this._state.pendingToolCalls = pendingToolCalls;
        break;
      }

      case "tool_execution_end": {
        const pendingToolCalls = new Set(this._state.pendingToolCalls);
        pendingToolCalls.delete(event.toolCallId);
        this._state.pendingToolCalls = pendingToolCalls;
        break;
      }

      case "turn_end":
        if (
          event.message.role === "assistant" &&
          (event.message as any).errorMessage
        ) {
          this._state.errorMessage = (event.message as any).errorMessage;
        }
        break;

      case "agent_end":
        this._state.streamingMessage = undefined;
        break;
    }

    const signal = this.activeRun?.abortController.signal;
    if (!signal) {
      throw new Error("Agent listener invoked outside active run");
    }

    for (const listener of this.listeners) {
      await listener(event, signal);
    }
  }
}
