# coding-agent V1 Implementation Plan (Phase 03)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **本文档配套文档**:
> - 设计 Spec: [2026-08-09-phase03-coding-agent-design.md](../specs/2026-08-09-phase03-coding-agent-design.md)
> - 上游 Agent Spec: [2026-07-30-phase02-agent-design.md](../specs/2026-07-30-phase02-agent-design.md)
> - 上游 AI Spec: [2026-07-29-phase01-ai-core-design.md](../specs/2026-07-29-phase01-ai-core-design.md)
> - 工程原则: [2026-07-30-phase02-engineering-principles.md](../specs/2026-07-30-phase02-engineering-principles.md)

**Goal:** 搭建 `packages/coding-agent` 包，提供 `mimi` CLI 命令，严格对齐 Pi 三层架构。

**Architecture:** 照抄 Pi 的 `Agent` 类包装 `runAgentLoop` → `AgentSession` 包装 `Agent` 提供持久化/压缩 → `modes/` 提供 print + interactive 两种模式。

**Tech Stack:** TypeScript 5.9+ / Node.js 22+ / pnpm / vitest / tsx / Node.js 内置 `readline/promises` / `fs/promises` / `child_process`

## Global Constraints

- TypeScript 5.9+, `erasableSyntaxOnly`, ES2022 target, Node16 模块
- 所有注释、文档使用中文
- vitest 用于单元测试，`examples/*.sh` 用于真实跑通
- 每个 Task 完成后必须: vitest 通过 + `tsc --noEmit` 通过
- 严格 TDD: 测试先写
- 每个 Task 提交一次 commit（feat/fix/chore 前缀）
- 零外部依赖（除 workspace 内的 @mimi/ai, @mimi/agent）
- Agent 类照抄 Pi，适配现有 runAgentLoop 签名
- 8 个工具全部实现，路径安全检查强制 cwd 不逃逸
- Session 路径: `<cwd>/.mimi/sessions/<id>.jsonl`
- 默认模型: `deepseek-chat`

---

### Task 1: Agent 类（packages/agent/src/agent.ts）

**Files:**
- Create: `packages/agent/src/agent.ts`
- Modify: `packages/agent/src/index.ts` (add export)

**Interfaces:**
- Consumes: `runAgentLoop` from `./agent-loop.js`, `AgentContext`, `AgentLoopConfig`, `AgentMessage`, `AgentTool`, `AgentEvent`, `StreamFn`, `QueueMode`, `ToolExecutionMode`, `ThinkingLevel`, `BeforeToolCallContext`, `BeforeToolCallResult`, `AfterToolCallContext`, `AfterToolCallResult`, `PrepareNextTurnContext`, `AgentLoopTurnUpdate` from `./types.js`
- Consumes: `ImageContent`, `TextContent`, `Message`, `Model` from `@mimi/ai`
- Consumes: `AssistantMessageEventStream` from `@mimi/ai`
- Produces: `Agent` class, `AgentState`, `AgentOptions`

- [ ] **Step 1: 写 agent.test.ts**

```ts
// packages/agent/__tests__/agent.test.ts
import { describe, it, expect, vi } from "vitest";
import { Agent } from "../src/agent.js";
import type { AgentMessage, AgentTool } from "../src/types.js";
import { Type } from "@sinclair/typebox";

// 构造一个 mock streamFn，返回一个可控制的 EventStream
function mockStreamFn() {
  const eventStream = {
    async *[Symbol.asyncIterator]() {
      yield {
        type: "start",
        partial: {
          role: "assistant",
          content: [],
          api: "openai-completions",
          provider: "deepseek",
          model: "deepseek-chat",
          usage: { input: 0, output: 0, totalTokens: 0, cost: { input: 0, output: 0, total: 0 } },
          stopReason: "stop",
          timestamp: Date.now(),
        },
      };
      yield {
        type: "text_delta",
        contentIndex: 0,
        delta: "你好！",
        partial: {
          role: "assistant",
          content: [{ type: "text", text: "你好！" }],
          api: "openai-completions",
          provider: "deepseek",
          model: "deepseek-chat",
          usage: { input: 10, output: 2, totalTokens: 12, cost: { input: 0, output: 0, total: 0 } },
          stopReason: "stop",
          timestamp: Date.now(),
        },
      };
      yield {
        type: "done",
        reason: "stop",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "你好！" }],
          api: "openai-completions",
          provider: "deepseek",
          model: "deepseek-chat",
          usage: { input: 10, output: 2, totalTokens: 12, cost: { input: 0, output: 0, total: 0 } },
          stopReason: "stop",
          timestamp: Date.now(),
        },
      };
    },
    result: async () => [] as AgentMessage[],
  };
  return vi.fn().mockReturnValue(eventStream);
}

describe("Agent", () => {
  it("构造后 state 可访问", () => {
    const agent = new Agent();
    expect(agent.state.messages).toEqual([]);
    expect(agent.state.tools).toEqual([]);
  });

  it("prompt() 后 messages 包含 assistant 回复", async () => {
    const agent = new Agent({
      initialState: {
        model: {
          id: "deepseek-chat",
          name: "DeepSeek Chat",
          api: "openai-completions",
          provider: "deepseek",
          baseUrl: "https://api.deepseek.com",
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0 },
          contextWindow: 128000,
          maxTokens: 8192,
        },
      },
      streamFn: mockStreamFn(),
    });

    const events: any[] = [];
    agent.subscribe((event) => events.push(event));

    await agent.prompt("你好");

    // prompt 后应至少有一条 assistant 消息
    const lastMsg = agent.state.messages[agent.state.messages.length - 1];
    expect(lastMsg?.role).toBe("assistant");
    // 应有 agent_end 事件
    expect(events.some((e) => e.type === "agent_end")).toBe(true);
  });

  it("abort() 中断当前 run", async () => {
    const agent = new Agent({
      initialState: {
        model: {
          id: "deepseek-chat",
          name: "DeepSeek Chat",
          api: "openai-completions",
          provider: "deepseek",
          baseUrl: "https://api.deepseek.com",
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0 },
          contextWindow: 128000,
          maxTokens: 8192,
        },
      },
      streamFn: mockStreamFn(),
    });

    // 同时 prompt + abort
    const promptPromise = agent.prompt("你好");
    agent.abort();
    await promptPromise;

    expect(agent.state.errorMessage).toBeDefined();
  });

  it("steer() 入队后可被 drain", () => {
    const agent = new Agent();
    agent.steer({ role: "user", content: "补充", timestamp: Date.now() });
    // steer 队列内部有消息
    expect(agent.hasQueuedMessages()).toBe(true);
  });

  it("subscribe 返回退订函数", () => {
    const agent = new Agent();
    const calls: any[] = [];
    const unsub = agent.subscribe(() => calls.push(1));
    unsub();
    // 退订后不再收到事件（通过间接验证）
    expect(typeof unsub).toBe("function");
  });
});
```

- [ ] **Step 2: 跑测试验证失败**

```bash
cd packages/agent && npx vitest run __tests__/agent.test.ts
```
Expected: FAIL — `Agent` not found

- [ ] **Step 3: 从 Pi 照抄 Agent 类，适配现有类型**

创建 `packages/agent/src/agent.ts`:

```ts
/**
 * Agent —— 有状态的 agent-loop 包装器。
 *
 * 从 pi 项目的 `packages/agent/src/agent.ts` 完整翻译。
 * 持有 AgentState（messages / tools / systemPrompt / model / thinkingLevel），
 * 暴露 prompt() / continue() / abort() 入口，
 * 提供 subscribe() 事件订阅 + steer/followUp 队列管理。
 *
 * 内部调用已有的 runAgentLoop（agent-loop.ts），不重写。
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
  PrepareNextTurnContext,
  AgentLoopTurnUpdate,
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

type MutableAgentState = Omit<AgentState, "isStreaming" | "streamingMessage" | "pendingToolCalls" | "errorMessage"> & {
  isStreaming: boolean;
  streamingMessage?: AgentMessage;
  pendingToolCalls: Set<string>;
  errorMessage?: string;
};

function createMutableAgentState(
  initialState?: Partial<Omit<AgentState, "pendingToolCalls" | "isStreaming" | "streamingMessage" | "errorMessage">>,
): MutableAgentState {
  let tools = initialState?.tools?.slice() ?? [];
  let messages = initialState?.messages?.slice() ?? [];

  return {
    systemPrompt: initialState?.systemPrompt ?? "",
    model: initialState?.model ?? DEFAULT_MODEL,
    thinkingLevel: initialState?.thinkingLevel ?? "off",
    get tools() { return tools; },
    set tools(nextTools: AgentTool<any>[]) { tools = nextTools.slice(); },
    get messages() { return messages; },
    set messages(nextMessages: AgentMessage[]) { messages = nextMessages.slice(); },
    isStreaming: false,
    streamingMessage: undefined,
    pendingToolCalls: new Set<string>(),
    errorMessage: undefined,
  };
}

// ── AgentOptions ──

export interface AgentOptions {
  initialState?: Partial<Omit<AgentState, "pendingToolCalls" | "isStreaming" | "streamingMessage" | "errorMessage">>;
  convertToLlm?: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
  transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;
  streamFn?: StreamFn;
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
  beforeToolCall?: (context: BeforeToolCallContext, signal?: AbortSignal) => Promise<BeforeToolCallResult | undefined>;
  afterToolCall?: (context: AfterToolCallContext, signal?: AbortSignal) => Promise<AfterToolCallResult | undefined>;
  prepareNextTurn?: (signal?: AbortSignal) => Promise<AgentLoopTurnUpdate | undefined> | AgentLoopTurnUpdate | undefined;
  prepareNextTurnWithContext?: (context: PrepareNextTurnContext, signal?: AbortSignal) => Promise<AgentLoopTurnUpdate | undefined> | AgentLoopTurnUpdate | undefined;
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

  constructor(mode: QueueMode) { this.mode = mode; }

  enqueue(message: AgentMessage): void { this.messages.push(message); }
  hasItems(): boolean { return this.messages.length > 0; }

  drain(): AgentMessage[] {
    if (this.mode === "all") {
      const drained = this.messages.slice();
      this.messages = [];
      return drained;
    }
    const first = this.messages[0];
    if (!first) return [];
    this.messages = this.messages.slice(1);
    return [first];
  }

  clear(): void { this.messages = []; }
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
  private readonly listeners = new Set<(event: AgentEvent, signal: AbortSignal) => Promise<void> | void>();
  private readonly steeringQueue: PendingMessageQueue;
  private readonly followUpQueue: PendingMessageQueue;

  public convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
  public transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;
  public streamFn: StreamFn;
  public getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
  public beforeToolCall?: (context: BeforeToolCallContext, signal?: AbortSignal) => Promise<BeforeToolCallResult | undefined>;
  public afterToolCall?: (context: AfterToolCallContext, signal?: AbortSignal) => Promise<AfterToolCallResult | undefined>;
  public prepareNextTurn?: (signal?: AbortSignal) => Promise<AgentLoopTurnUpdate | undefined> | AgentLoopTurnUpdate | undefined;
  public prepareNextTurnWithContext?: (context: PrepareNextTurnContext, signal?: AbortSignal) => Promise<AgentLoopTurnUpdate | undefined> | AgentLoopTurnUpdate | undefined;
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

  /** 默认 streamFn：使用 AI 层 Models.stream */
  private _defaultStreamFn: StreamFn = (() => {
    // 占位：Agent 构造时若未注入 streamFn，后续 AgentSession 会注入
    throw new Error("Agent.streamFn not set. Inject via AgentSession or pass in constructor.");
  }) as unknown as StreamFn;

  // ── 状态 ──

  get state(): AgentState { return this._state; }

  set steeringMode(mode: QueueMode) { this.steeringQueue.mode = mode; }
  get steeringMode(): QueueMode { return this.steeringQueue.mode; }

  set followUpMode(mode: QueueMode) { this.followUpQueue.mode = mode; }
  get followUpMode(): QueueMode { return this.followUpQueue.mode; }

  // ── 队列 ──

  steer(message: AgentMessage): void { this.steeringQueue.enqueue(message); }
  followUp(message: AgentMessage): void { this.followUpQueue.enqueue(message); }
  clearSteeringQueue(): void { this.steeringQueue.clear(); }
  clearFollowUpQueue(): void { this.followUpQueue.clear(); }
  clearAllQueues(): void { this.clearSteeringQueue(); this.clearFollowUpQueue(); }
  hasQueuedMessages(): boolean { return this.steeringQueue.hasItems() || this.followUpQueue.hasItems(); }

  get signal(): AbortSignal | undefined { return this.activeRun?.abortController.signal; }

  // ── 订阅 ──

  subscribe(listener: (event: AgentEvent, signal: AbortSignal) => Promise<void> | void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ── 中止 ──

  abort(): void { this.activeRun?.abortController.abort(); }

  waitForIdle(): Promise<void> { return this.activeRun?.promise ?? Promise.resolve(); }

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
    if (!lastMessage) throw new Error("No messages to continue from");
    if (lastMessage.role === "assistant") {
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
    if (images && images.length > 0) content.push(...images);
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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async _runContinuation(): Promise<void> {
    // 续接：传空 prompts 数组，runAgentLoop 内部处理
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

  private _createLoopConfig(options: { skipInitialSteeringPoll?: boolean } = {}): AgentLoopConfig {
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
        if (skipInitialSteeringPoll) { skipInitialSteeringPoll = false; return []; }
        return this.steeringQueue.drain();
      },
      getFollowUpMessages: async () => this.followUpQueue.drain(),
    };
  }

  private async _runWithLifecycle(executor: (signal: AbortSignal) => Promise<void>): Promise<void> {
    if (this.activeRun) throw new Error("Agent is already processing.");

    const abortController = new AbortController();
    let resolvePromise = () => {};
    const promise = new Promise<void>((resolve) => { resolvePromise = resolve; });
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
    await this._processEvents({ type: "turn_end", message: failureMessage, toolResults: [] });
    await this._processEvents({ type: "agent_end", messages: [failureMessage] });
  }

  private _finishRun(): void {
    this._state.isStreaming = false;
    this._state.streamingMessage = undefined;
    this._state.pendingToolCalls = new Set<string>();
    this.activeRun?.resolve();
    this.activeRun = undefined;
  }

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
        if (event.message.role === "assistant" && (event.message as any).errorMessage) {
          this._state.errorMessage = (event.message as any).errorMessage;
        }
        break;
      case "agent_end":
        this._state.streamingMessage = undefined;
        break;
    }

    const signal = this.activeRun?.abortController.signal;
    if (!signal) throw new Error("Agent listener invoked outside active run");
    for (const listener of this.listeners) {
      await listener(event, signal);
    }
  }
}
```

- [ ] **Step 4: 跑测试验证通过**

```bash
cd packages/agent && npx vitest run __tests__/agent.test.ts
```
Expected: PASS (all 5 tests)

- [ ] **Step 5: 从 agent/src/index.ts 导出 Agent**

在 `packages/agent/src/index.ts` 中添加:

```ts
export { Agent, type AgentState, type AgentOptions } from "./agent.js";
```

- [ ] **Step 6: tsc 类型检查**

```bash
cd packages/agent && npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 7: Commit**

```bash
git add packages/agent/src/agent.ts packages/agent/src/index.ts packages/agent/__tests__/agent.test.ts
git commit -m "feat(agent): add Agent class (from pi, wraps runAgentLoop)"
```

---

### Task 2: coding-agent 包骨架 + 所有空壳文件

**Files:**
- Create: `packages/coding-agent/package.json`
- Create: `packages/coding-agent/tsconfig.json`
- Create: `packages/coding-agent/vitest.config.ts`
- Create: `packages/coding-agent/.env.example`
- Create: `packages/coding-agent/src/config.ts`
- Create: `packages/coding-agent/src/index.ts`
- Create: `packages/coding-agent/src/bin/mimi.mjs`
- Create: `packages/coding-agent/src/core/index.ts`
- Create: `packages/coding-agent/src/core/agent-session.ts` （空壳）
- Create: `packages/coding-agent/src/core/agent-session-runtime.ts` （空壳）
- Create: `packages/coding-agent/src/core/agent-session-services.ts` （空壳）
- Create: `packages/coding-agent/src/core/sdk.ts` （空壳）
- Create: `packages/coding-agent/src/core/session-manager.ts` （空壳）
- Create: `packages/coding-agent/src/core/model-runtime.ts` （空壳）
- Create: `packages/coding-agent/src/core/model-registry.ts` （空壳）
- Create: `packages/coding-agent/src/core/model-resolver.ts` （空壳）
- Create: `packages/coding-agent/src/core/system-prompt.ts` （空壳）
- Create: `packages/coding-agent/src/core/messages.ts` （空壳）
- Create: `packages/coding-agent/src/core/bash-executor.ts` （空壳）
- Create: `packages/coding-agent/src/core/defaults.ts`
- Create: `packages/coding-agent/src/core/event-bus.ts` （空壳）
- Create: `packages/coding-agent/src/core/compaction/index.ts` （空壳）
- Create: `packages/coding-agent/src/core/compaction/compaction.ts` （空壳）
- Create: `packages/coding-agent/src/core/tools/index.ts` （空壳）
- Create: `packages/coding-agent/src/core/tools/read.ts` （空壳）
- Create: `packages/coding-agent/src/core/tools/write.ts` （空壳）
- Create: `packages/coding-agent/src/core/tools/edit.ts` （空壳）
- Create: `packages/coding-agent/src/core/tools/edit-diff.ts` （空壳）
- Create: `packages/coding-agent/src/core/tools/bash.ts` （空壳）
- Create: `packages/coding-agent/src/core/tools/find.ts` （空壳）
- Create: `packages/coding-agent/src/core/tools/grep.ts` （空壳）
- Create: `packages/coding-agent/src/core/tools/ls.ts` （空壳）
- Create: `packages/coding-agent/src/core/extensions/index.ts` （空壳）
- Create: `packages/coding-agent/src/core/extensions/types.ts` （空壳）
- Create: `packages/coding-agent/src/modes/index.ts` （空壳）
- Create: `packages/coding-agent/src/modes/print-mode.ts` （空壳）
- Create: `packages/coding-agent/src/modes/interactive/interactive-mode.ts` （空壳）
- Create: `packages/coding-agent/src/utils/ansi.ts` （空壳）
- Create: `packages/coding-agent/src/utils/paths.ts` （空壳）
- Create: `packages/coding-agent/src/utils/shell.ts` （空壳）
- Create: `packages/coding-agent/src/cli.ts` （空壳）
- Create: `packages/coding-agent/src/main.ts` （空壳）

**Interfaces:**
- Produces: `config.ts` 导出 `APP_NAME`, `VERSION`, `getAgentDir()`, `getPackageDir()`
- Produces: `defaults.ts` 导出 `DEFAULT_MODEL`, `DEFAULT_THINKING_LEVEL`
- Produces: `index.ts` 作为公共 API 入口（暂空，后续 Task 补）

- [ ] **Step 1: 写 package.json**

```json
{
  "name": "@mimi/coding-agent",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "mimi": "./dist/bin/mimi.mjs"
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  },
  "dependencies": {
    "@mimi/agent": "workspace:*",
    "@mimi/ai": "workspace:*",
    "@sinclair/typebox": "^0.34.0"
  },
  "devDependencies": {
    "typescript": "^5.9.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: 写 tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "references": [
    { "path": "../agent" },
    { "path": "../ai" }
  ]
}
```

- [ ] **Step 3: 写 vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: 写 .env.example**

```
# mimi 默认模型
MIMI_MODEL=deepseek-chat

# API Keys（至少配置一个）
MIMI_API_KEY_DEEPSEEK=sk-xxx
MIMI_API_KEY_ANTHROPIC=sk-ant-xxx
MIMI_API_KEY_OPENAI=sk-xxx

# 默认 thinking level
MIMI_THINKING=medium

# Session 存储目录（默认 <cwd>/.mimi/sessions）
# MIMI_SESSION_DIR=
```

- [ ] **Step 5: 写 config.ts**

```ts
// coding-agent 全局常量
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const APP_NAME = "mimi";
export const APP_TITLE = "mimi - AI Coding Assistant";
export const VERSION = "0.1.0";
export const CONFIG_DIR_NAME = ".mimi";

export function getPackageDir(): string {
  return join(__dirname, "..");
}

export function getAgentDir(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  return join(home, CONFIG_DIR_NAME);
}

export function getDocsPath(): string {
  return join(getPackageDir(), "docs");
}
```

- [ ] **Step 6: 写 defaults.ts**

```ts
import type { ThinkingLevel } from "@mimi/agent";

export const DEFAULT_MODEL = "deepseek-chat";
export const DEFAULT_THINKING_LEVEL: ThinkingLevel = "medium";

export const DEFAULT_SESSION_DIR_NAME = ".mimi/sessions";

export const BASH_DEFAULT_TIMEOUT_MS = 30_000;
export const BASH_DEFAULT_MAX_OUTPUT_BYTES = 50_000;
```

- [ ] **Step 7: 写 bin/mimi.mjs**

```js
#!/usr/bin/env node
import("../dist/cli.js").then(m => m.main(process.argv.slice(2), {
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  env: process.env,
  cwd: process.cwd(),
  exit: (code) => process.exit(code),
})).catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 8: 写所有空壳文件**

每个空壳文件只需要导出注释:

```ts
// 示例: src/core/session-manager.ts
/**
 * Session 文件 CRUD 操作。
 * TODO: Task 3 实现
 */
export class SessionManager {
  // TODO
}
```

所有空壳文件列表（按上述 Files 列表创建，每个文件内容为 stub 导出）。

- [ ] **Step 9: 写 index.ts 公共入口**

```ts
/**
 * @mimi/coding-agent —— mimi CLI 产品层。
 *
 * 严格对齐 pi 项目架构。
 */
// 公共 API 随各 Task 逐步补全
```

- [ ] **Step 10: 安装依赖 + 编译验证**

```bash
cd packages/coding-agent && pnpm install && pnpm build
```
Expected: build success（即使有空壳）

- [ ] **Step 11: Commit**

```bash
git add packages/coding-agent/
git commit -m "feat(coding-agent): package skeleton + all stub files"
```

---

### Task 3: SessionManager

**Files:**
- Create: `packages/coding-agent/src/core/session-manager.ts`
- Create: `packages/coding-agent/src/__tests__/session-manager.test.ts`

**Interfaces:**
- Consumes: `JsonlSessionStorage`, `JsonlSessionRepo`, `Session`, `SessionEntry` from `@mimi/agent`
- Consumes: `DEFAULT_SESSION_DIR_NAME` from `../defaults.js`
- Produces: `SessionManager` class with static: `create`, `open`, `continueRecent`, `inMemory`, `list`, `listAll`; instance: `id`, `path`, `appendEntry`, `close`

- [ ] **Step 1: 写 session-manager.test.ts**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionManager } from "../src/core/session-manager.js";

describe("SessionManager", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), "mimi-test-")); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("create 新建 session 目录和文件", () => {
    const sm = SessionManager.create(tmpDir, join(tmpDir, "sessions"), { id: "test-1" });
    expect(sm.id).toBe("test-1");
    expect(sm.path).toContain("test-1.jsonl");
    sm.close();
  });

  it("open 打开已有 session 文件", () => {
    const sm1 = SessionManager.create(tmpDir, join(tmpDir, "sessions"), { id: "test-2" });
    sm1.close();
    const sm2 = SessionManager.open(sm1.path!, join(tmpDir, "sessions"));
    expect(sm2.id).toBe("test-2");
    sm2.close();
  });

  it("continueRecent 无 session 时新建", () => {
    const sm = SessionManager.continueRecent(tmpDir, join(tmpDir, "sessions"));
    expect(sm.id).toBeDefined();
    sm.close();
  });

  it("continueRecent 有 24h 内 session 时续接", () => {
    const sm1 = SessionManager.create(tmpDir, join(tmpDir, "sessions"), { id: "recent-test" });
    sm1.close();
    const sm2 = SessionManager.continueRecent(tmpDir, join(tmpDir, "sessions"));
    expect(sm2.id).toBe("recent-test");
    sm2.close();
  });

  it("inMemory 不创建文件", () => {
    const sm = SessionManager.inMemory(tmpDir, { id: "mem-1" });
    expect(sm.id).toBe("mem-1");
    expect(sm.path).toBeUndefined();
    sm.close();
  });

  it("appendEntry 写 JSONL", async () => {
    const sm = SessionManager.create(tmpDir, join(tmpDir, "sessions"));
    await sm.appendEntry({ type: "message", role: "user", content: "hello", timestamp: Date.now() });
    sm.close();
    // 验证文件存在且不为空
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(sm.path!, "utf-8");
    expect(content).toContain("hello");
  });
});
```

- [ ] **Step 2: 跑测试验证失败**

```bash
cd packages/coding-agent && npx vitest run src/__tests__/session-manager.test.ts
```
Expected: FAIL

- [ ] **Step 3: 实现 SessionManager**

```ts
// packages/coding-agent/src/core/session-manager.ts
/**
 * SessionManager —— Session 文件 CRUD 操作。
 *
 * 对齐 pi 的 SessionManager。底层复用 @mimi/agent 的 JSONL 存储。
 */

import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { JsonlSessionStorage, type SessionEntry, type Session } from "@mimi/agent";
import { v7 as uuidv7 } from "../../session/uuidv7.js"; // 复用 agent 层的 uuidv7
// 注意：如果 agent 层未导出 uuidv7，内联一个简单的:
function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const SESSION_FILE_EXT = ".jsonl";
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

export interface SessionInfo {
  id: string;
  path: string;
  cwd: string;
  mtime: number;
}

export class SessionManager {
  private _storage: JsonlSessionStorage | null;
  private _session: Session | null;
  private _id: string;
  private _path: string | undefined;
  private _cwd: string;

  private constructor(cwd: string, id: string, path?: string, storage?: JsonlSessionStorage) {
    this._cwd = cwd;
    this._id = id;
    this._path = path;
    this._storage = storage ?? null;
    this._session = null;
  }

  // ── 静态工厂 ──

  static create(cwd: string, sessionDir?: string, options?: { id?: string }): SessionManager {
    const dir = sessionDir ?? join(cwd, ".mimi", "sessions");
    const id = options?.id ?? generateId();
    mkdirSync(dir, { recursive: true });

    const filePath = join(dir, `${id}${SESSION_FILE_EXT}`);
    const storage = new JsonlSessionStorage(filePath);
    return new SessionManager(cwd, id, filePath, storage);
  }

  static open(filePath: string, _sessionDir?: string): SessionManager {
    if (!existsSync(filePath)) {
      throw new Error(`Session file not found: ${filePath}`);
    }
    const id = basename(filePath, SESSION_FILE_EXT);
    const storage = new JsonlSessionStorage(filePath);
    return new SessionManager(id, id, filePath, storage);
  }

  static continueRecent(cwd: string, sessionDir?: string): SessionManager {
    const dir = sessionDir ?? join(cwd, ".mimi", "sessions");
    if (!existsSync(dir)) {
      return SessionManager.create(cwd, sessionDir);
    }

    const files = readdirSync(dir)
      .filter((f) => f.endsWith(SESSION_FILE_EXT))
      .map((f) => ({
        id: basename(f, SESSION_FILE_EXT),
        path: join(dir, f),
      }));

    if (files.length === 0) {
      return SessionManager.create(cwd, sessionDir);
    }

    // 找 mtime 最新的
    let latest = files[0];
    let latestMtime = statSync(latest.path).mtimeMs;
    for (const f of files.slice(1)) {
      const mtime = statSync(f.path).mtimeMs;
      if (mtime > latestMtime) {
        latest = f;
        latestMtime = mtime;
      }
    }

    if (Date.now() - latestMtime < RECENT_WINDOW_MS) {
      return SessionManager.open(latest.path, sessionDir);
    }

    return SessionManager.create(cwd, sessionDir);
  }

  static inMemory(_cwd: string, options?: { id?: string }): SessionManager {
    return new SessionManager(_cwd, options?.id ?? generateId());
  }

  static list(cwd: string, sessionDir?: string): SessionInfo[] {
    const dir = sessionDir ?? join(cwd, ".mimi", "sessions");
    if (!existsSync(dir)) return [];

    return readdirSync(dir)
      .filter((f) => f.endsWith(SESSION_FILE_EXT))
      .map((f) => {
        const path = join(dir, f);
        const stat = statSync(path);
        return { id: basename(f, SESSION_FILE_EXT), path, cwd, mtime: stat.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
  }

  static listAll(sessionDir?: string): SessionInfo[] {
    // V1: 只在当前 cwd 下查找，后续实现跨项目搜索
    return [];
  }

  // ── 实例 ──

  get id(): string { return this._id; }
  get path(): string | undefined { return this._path; }

  async appendEntry(entry: SessionEntry): Promise<void> {
    if (this._storage) {
      await this._storage.append(entry);
    }
  }

  close(): void {
    this._storage?.close();
  }
}
```

- [ ] **Step 4: 跑测试验证通过**

```bash
cd packages/coding-agent && npx vitest run src/__tests__/session-manager.test.ts
```
Expected: PASS

- [ ] **Step 5: 从 core/index.ts 导出**

```ts
export { SessionManager, type SessionInfo } from "./session-manager.js";
```

- [ ] **Step 6: Commit**

```bash
git add packages/coding-agent/src/core/session-manager.ts packages/coding-agent/src/core/index.ts packages/coding-agent/src/__tests__/session-manager.test.ts
git commit -m "feat(coding-agent): session-manager (create/open/continueRecent/list)"
```

---

### Task 4: ModelRuntime + ModelRegistry + ModelResolver

**Files:**
- Create: `packages/coding-agent/src/core/model-registry.ts`
- Create: `packages/coding-agent/src/core/model-runtime.ts`
- Create: `packages/coding-agent/src/core/model-resolver.ts`
- Create: `packages/coding-agent/src/__tests__/model-runtime.test.ts`

**Interfaces:**
- Consumes: `Model`, `Provider`, `createModels`, `anthropicProvider`, `openaiProvider`, `deepseekProvider` from `@mimi/ai`
- Consumes: `DEFAULT_MODEL` from `../defaults.js`
- Produces: `ModelRegistry` class, `ModelRuntime` class, `resolveModel()` function

- [ ] **Step 1: 写 model-runtime.test.ts**

```ts
import { describe, it, expect } from "vitest";
import { ModelRegistry } from "../src/core/model-registry.js";
import { ModelRuntime } from "../src/core/model-runtime.js";
import { anthropicProvider, openaiProvider, deepseekProvider } from "@mimi/ai";

describe("ModelRegistry", () => {
  it("注册 provider 后可查找模型", () => {
    const registry = new ModelRegistry();
    registry.register(deepseekProvider());
    const model = registry.getModel("deepseek", "deepseek-chat");
    expect(model).toBeDefined();
    expect(model!.provider).toBe("deepseek");
  });

  it("list 返回所有模型", () => {
    const registry = new ModelRegistry();
    registry.register(deepseekProvider());
    registry.register(openaiProvider());
    expect(registry.list().length).toBeGreaterThanOrEqual(2);
  });

  it("findByProvider 筛选", () => {
    const registry = new ModelRegistry();
    registry.register(deepseekProvider());
    const ds = registry.findByProvider("deepseek");
    expect(ds.every((m) => m.provider === "deepseek")).toBe(true);
  });
});

describe("ModelRuntime", () => {
  it("getAuth 从环境变量读 key", async () => {
    const registry = new ModelRegistry();
    registry.register(deepseekProvider());
    const runtime = new ModelRuntime(registry);

    process.env.MIMI_API_KEY_DEEPSEEK = "sk-test";
    const model = registry.getModel("deepseek", "deepseek-chat")!;
    const auth = await runtime.getAuth(model);
    expect(auth.apiKey).toBe("sk-test");
    delete process.env.MIMI_API_KEY_DEEPSEEK;
  });

  it("isUsingOAuth V1 永远返回 false", () => {
    const runtime = new ModelRuntime(new ModelRegistry());
    expect(runtime.isUsingOAuth("anthropic")).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试验证失败**

```bash
cd packages/coding-agent && npx vitest run src/__tests__/model-runtime.test.ts
```
Expected: FAIL

- [ ] **Step 3: 实现 ModelRegistry**

```ts
// packages/coding-agent/src/core/model-registry.ts
import type { Model, Provider } from "@mimi/ai";

export class ModelRegistry {
  private providers = new Map<string, Provider>();

  register(provider: Provider): void {
    this.providers.set(provider.id, provider);
  }

  getModel(providerId: string, modelId: string): Model<any> | undefined {
    return this.providers.get(providerId)?.getModel(modelId);
  }

  findByProvider(providerId: string): Model<any>[] {
    const p = this.providers.get(providerId);
    return p ? [...p.getModels()] : [];
  }

  list(): Model<any>[] {
    const all: Model<any>[] = [];
    for (const p of this.providers.values()) {
      all.push(...p.getModels());
    }
    return all;
  }
}
```

- [ ] **Step 4: 实现 ModelRuntime**

```ts
// packages/coding-agent/src/core/model-runtime.ts
import type { Model } from "@mimi/ai";
import { ModelRegistry } from "./model-registry.js";

const PROVIDER_ENV_MAP: Record<string, string> = {
  anthropic: "MIMI_API_KEY_ANTHROPIC",
  openai: "MIMI_API_KEY_OPENAI",
  deepseek: "MIMI_API_KEY_DEEPSEEK",
};

export class ModelRuntime {
  private registry: ModelRegistry;

  constructor(registry: ModelRegistry) {
    this.registry = registry;
  }

  getModel(id: string): Model<any> | undefined {
    // 遍历所有 provider 查找
    for (const model of this.registry.list()) {
      if (model.id === id) return model;
    }
    return undefined;
  }

  resolveModel(input: string): Model<any> | undefined {
    return this.getModel(input);
  }

  async getAuth(model: Model<any>): Promise<{ apiKey: string }> {
    const envVar = PROVIDER_ENV_MAP[model.provider];
    if (envVar) {
      const key = process.env[envVar];
      if (key) return { apiKey: key };
    }
    // fallback: 走 provider 自己的 env
    throw new Error(`No API key found for provider '${model.provider}'. Set ${envVar ?? "appropriate env var"}.`);
  }

  isUsingOAuth(_provider: string): boolean {
    return false; // V1: 永远 false
  }
}
```

- [ ] **Step 5: 实现 ModelResolver**

```ts
// packages/coding-agent/src/core/model-resolver.ts
import type { Model } from "@mimi/ai";
import { ModelRuntime } from "./model-runtime.js";

export function resolveModel(input: string | undefined, runtime: ModelRuntime, defaultModel: string): Model<any> {
  const id = input ?? process.env.MIMI_MODEL ?? defaultModel;
  const model = runtime.getModel(id);
  if (!model) {
    throw new Error(`Unknown model: "${id}". Check MIMI_MODEL or --model flag.`);
  }
  return model;
}
```

- [ ] **Step 6: 跑测试验证通过**

```bash
cd packages/coding-agent && npx vitest run src/__tests__/model-runtime.test.ts
```
Expected: PASS

- [ ] **Step 7: 从 core/index.ts 导出**

```ts
export { ModelRegistry } from "./model-registry.js";
export { ModelRuntime } from "./model-runtime.js";
export { resolveModel } from "./model-resolver.js";
```

- [ ] **Step 8: Commit**

```bash
git add packages/coding-agent/src/core/model-registry.ts packages/coding-agent/src/core/model-runtime.ts packages/coding-agent/src/core/model-resolver.ts packages/coding-agent/src/core/index.ts packages/coding-agent/src/__tests__/model-runtime.test.ts
git commit -m "feat(coding-agent): model-runtime + model-registry + model-resolver"
```

---

### Task 5: 8 个内置工具

**Files:**
- Create: `packages/coding-agent/src/core/tools/read.ts`
- Create: `packages/coding-agent/src/core/tools/write.ts`
- Create: `packages/coding-agent/src/core/tools/edit.ts`
- Create: `packages/coding-agent/src/core/tools/edit-diff.ts`
- Create: `packages/coding-agent/src/core/tools/bash.ts`
- Create: `packages/coding-agent/src/core/tools/find.ts`
- Create: `packages/coding-agent/src/core/tools/grep.ts`
- Create: `packages/coding-agent/src/core/tools/ls.ts`
- Create: `packages/coding-agent/src/core/tools/index.ts`
- Create: `packages/coding-agent/src/__tests__/tools/read.test.ts`
- Create: `packages/coding-agent/src/__tests__/tools/write.test.ts`
- Create: `packages/coding-agent/src/__tests__/tools/bash.test.ts`

**Interfaces:**
- Consumes: `AgentTool`, `AgentToolResult` from `@mimi/agent`
- Consumes: `Type` from `@sinclair/typebox`
- Produces: 8 个 `AgentTool` 实例 + `BUILTIN_TOOLS` 数组

- [ ] **Step 1: 写 read.test.ts**

```ts
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readFileTool } from "../src/core/tools/read.js";

describe("read_file", () => {
  const cwd = join(tmpdir(), "mimi-test-read");
  const testFile = join(cwd, "hello.txt");

  beforeEach(() => { mkdirSync(cwd, { recursive: true }); writeFileSync(testFile, "hello world"); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it("读 cwd 下文件成功", async () => {
    process.env.MIMI_CWD = cwd;
    const result = await readFileTool.execute("c1", { path: "hello.txt" });
    const text = result.content[0];
    expect(text.type).toBe("text");
    if (text.type === "text") expect(text.text).toContain("hello world");
  });

  it("路径越界返回错误", async () => {
    process.env.MIMI_CWD = cwd;
    const result = await readFileTool.execute("c1", { path: "/etc/hostname" });
    expect(result.details).toBeDefined();
  });
});
```

- [ ] **Step 2: 跑 read 测试验证失败**

```bash
cd packages/coding-agent && npx vitest run src/__tests__/tools/read.test.ts
```
Expected: FAIL

- [ ] **Step 3: 实现 read.ts**

```ts
// packages/coding-agent/src/core/tools/read.ts
import type { AgentTool } from "@mimi/agent";
import { Type, type Static } from "@sinclair/typebox";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { ok, err } from "@mimi/agent"; // Result helpers

const ReadParams = Type.Object({
  path: Type.String(),
  offset: Type.Optional(Type.Number()),
  limit: Type.Optional(Type.Number()),
});

type ReadParams = Static<typeof ReadParams>;

function isPathSafe(cwd: string, inputPath: string): boolean {
  const resolved = resolve(cwd, inputPath);
  return resolved.startsWith(cwd + sep) || resolved === cwd;
}

export const readFileTool: AgentTool<typeof ReadParams> = {
  name: "read_file",
  label: "Read File",
  description: "Read the contents of a file. All paths are relative to the project root.",
  parameters: ReadParams,
  async execute(_toolCallId, params) {
    const cwd = process.env.MIMI_CWD ?? process.cwd();
    if (!isPathSafe(cwd, params.path)) {
      return {
        content: [{ type: "text", text: `Error: Path escapes cwd: ${params.path}` }],
        details: { isError: true },
      };
    }
    try {
      let content = await readFile(resolve(cwd, params.path), "utf-8");
      if (params.offset !== undefined || params.limit !== undefined) {
        const lines = content.split("\n");
        const start = params.offset ?? 0;
        const end = params.limit !== undefined ? start + params.limit : undefined;
        content = lines.slice(start, end).join("\n");
      }
      return { content: [{ type: "text", text: content }], details: { size: content.length } };
    } catch (e: any) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }], details: { isError: true } };
    }
  },
};
```

- [ ] **Step 4: 跑 read 测试验证通过**

```bash
cd packages/coding-agent && npx vitest run src/__tests__/tools/read.test.ts
```
Expected: PASS

- [ ] **Step 5-12: 实现其余 7 个工具 + 测试**

（write / edit / edit-diff / bash / find / grep / ls，遵循同上 TDD 模式）

每个工具结构一致：
1. TypeBox schema 定义参数
2. `isPathSafe(cwd, inputPath)` 路径安全检查（文件工具）
3. `execute(toolCallId, params)` → `AgentToolResult`
4. 错误不抛，编码到 `content` + `details.isError`

**write.ts:**
```ts
// write 工具核心逻辑
export const writeFileTool: AgentTool<typeof WriteParams> = {
  name: "write_file",
  label: "Write File",
  description: "Write content to a file. Creates parent directories if needed.",
  parameters: Type.Object({ path: Type.String(), content: Type.String() }),
  async execute(_toolCallId, params) {
    const cwd = process.env.MIMI_CWD ?? process.cwd();
    if (!isPathSafe(cwd, params.path)) {
      return { content: [{ type: "text", text: `Error: Path escapes cwd: ${params.path}` }], details: { isError: true } };
    }
    const { writeFile, mkdir: mkdirp } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    const fullPath = resolve(cwd, params.path);
    await mkdirp(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, params.content, "utf-8");
    return { content: [{ type: "text", text: `Wrote ${params.content.length} bytes to ${params.path}` }], details: { size: params.content.length } };
  },
};
```

**edit.ts:**
```ts
// edit 工具核心逻辑：读文件 → 精确替换 old_string → new_string → 写回
export const editTool: AgentTool<typeof EditParams> = {
  name: "edit",
  label: "Edit File",
  description: "Replace exact text in a file.",
  parameters: Type.Object({
    path: Type.String(),
    old_string: Type.String(),
    new_string: Type.String(),
    replace_all: Type.Optional(Type.Boolean()),
  }),
  async execute(_toolCallId, params) {
    const cwd = process.env.MIMI_CWD ?? process.cwd();
    if (!isPathSafe(cwd, params.path)) {
      return { content: [{ type: "text", text: `Error: Path escapes cwd: ${params.path}` }], details: { isError: true } };
    }
    const { readFile, writeFile } = await import("node:fs/promises");
    const fullPath = resolve(cwd, params.path);
    let content = await readFile(fullPath, "utf-8");
    if (params.replace_all) {
      content = content.replaceAll(params.old_string, params.new_string);
    } else {
      content = content.replace(params.old_string, params.new_string);
    }
    await writeFile(fullPath, content, "utf-8");
    return { content: [{ type: "text", text: `Edited ${params.path}` }], details: {} };
  },
};
```

**bash.ts:**
```ts
// bash 工具核心逻辑：child_process.exec + 超时 + 输出截断
export const bashTool: AgentTool<typeof BashParams> = {
  name: "bash",
  label: "Bash",
  description: "Execute a shell command.",
  parameters: Type.Object({
    command: Type.String(),
    timeoutMs: Type.Optional(Type.Number()),
    maxOutputBytes: Type.Optional(Type.Number()),
  }),
  async execute(_toolCallId, params) {
    const cwd = process.env.MIMI_CWD ?? process.cwd();
    const timeout = params.timeoutMs ?? BASH_DEFAULT_TIMEOUT_MS;
    const maxBytes = params.maxOutputBytes ?? BASH_DEFAULT_MAX_OUTPUT_BYTES;
    const { exec } = await import("node:child_process");
    return new Promise((resolve) => {
      exec(params.command, { cwd, timeout, maxBuffer: maxBytes * 2 }, (error, stdout, stderr) => {
        let output = stdout;
        if (stderr) output += "\n[stderr]\n" + stderr;
        if (output.length > maxBytes) output = output.slice(0, maxBytes) + "\n... (truncated)";
        if (error) {
          resolve({ content: [{ type: "text", text: `Exit ${error.code}: ${output}` }], details: { exitCode: error.code, isError: true } });
        } else {
          resolve({ content: [{ type: "text", text: output }], details: { exitCode: 0 } });
        }
      });
    });
  },
};
```

**find.ts / grep.ts / ls.ts:** 同上模式，参数用 TypeBox schema，execute 返回 `AgentToolResult`。

- [ ] **Step 13: 写 tools/index.ts**

```ts
import { readFileTool } from "./read.js";
import { writeFileTool } from "./write.js";
import { editTool } from "./edit.js";
import { editDiffTool } from "./edit-diff.js";
import { bashTool } from "./bash.js";
import { findTool } from "./find.js";
import { grepTool } from "./grep.js";
import { lsTool } from "./ls.js";
import type { AgentTool } from "@mimi/agent";

export const BUILTIN_TOOLS: AgentTool<any>[] = [
  readFileTool,
  writeFileTool,
  editTool,
  editDiffTool,
  bashTool,
  findTool,
  grepTool,
  lsTool,
];

export { readFileTool, writeFileTool, editTool, editDiffTool, bashTool, findTool, grepTool, lsTool };
```

- [ ] **Step 14: 全量工具测试通过**

```bash
cd packages/coding-agent && npx vitest run src/__tests__/tools/
```
Expected: PASS (min 15 tests)

- [ ] **Step 15: Commit**

```bash
git add packages/coding-agent/src/core/tools/ packages/coding-agent/src/__tests__/tools/
git commit -m "feat(coding-agent): 8 built-in tools (read/write/edit/edit-diff/bash/find/grep/ls)"
```

---

### Task 6: AgentSession + Runtime + Services + SDK

**Files:**
- Create: `packages/coding-agent/src/core/agent-session-services.ts`
- Create: `packages/coding-agent/src/core/agent-session.ts`
- Create: `packages/coding-agent/src/core/agent-session-runtime.ts`
- Create: `packages/coding-agent/src/core/sdk.ts`
- Create: `packages/coding-agent/src/__tests__/agent-session.test.ts`

**Interfaces:**
- Consumes: `Agent`, `AgentState`, `AgentMessage`, `AgentEvent`, `ThinkingLevel` from `@mimi/agent`
- Consumes: `Model` from `@mimi/ai`
- Consumes: `SessionManager` from `./session-manager.js`
- Consumes: `ModelRuntime`, `ModelRegistry` from `./model-runtime.js` / `./model-registry.js`
- Consumes: `BUILTIN_TOOLS` from `./tools/index.js`
- Produces: `AgentSession`, `AgentSessionConfig`, `AgentSessionRuntime`, `AgentSessionServices`, `createAgentSession()`

- [ ] **Step 1: 写 agent-session.test.ts**

```ts
import { describe, it, expect, vi } from "vitest";
import { Agent } from "@mimi/agent";
import { SessionManager } from "../src/core/session-manager.js";
import { ModelRegistry } from "../src/core/model-registry.js";
import { ModelRuntime } from "../src/core/model-runtime.js";
import { AgentSession } from "../src/core/agent-session.js";
import { deepseekProvider } from "@mimi/ai";

function mockStreamFn() {
  const eventStream = {
    async *[Symbol.asyncIterator]() {
      yield { type: "start", partial: { role: "assistant", content: [], api: "openai-completions", provider: "deepseek", model: "deepseek-chat", usage: { input: 0, output: 0, totalTokens: 0, cost: { input: 0, output: 0, total: 0 } }, stopReason: "stop", timestamp: Date.now() } };
      yield { type: "done", reason: "stop", message: { role: "assistant", content: [{ type: "text", text: "ok" }], api: "openai-completions", provider: "deepseek", model: "deepseek-chat", usage: { input: 0, output: 1, totalTokens: 1, cost: { input: 0, output: 0, total: 0 } }, stopReason: "stop", timestamp: Date.now() } };
    },
    result: async () => [],
  };
  return vi.fn().mockReturnValue(eventStream);
}

describe("AgentSession", () => {
  it("构造 + prompt 调用 agent.prompt", async () => {
    const registry = new ModelRegistry();
    registry.register(deepseekProvider());
    const runtime = new ModelRuntime(registry);
    const sm = SessionManager.inMemory("/tmp");

    const agent = new Agent({
      streamFn: mockStreamFn(),
      initialState: { model: registry.getModel("deepseek", "deepseek-chat")! },
    });

    const session = new AgentSession({ agent, sessionManager: sm, modelRuntime: runtime, cwd: "/tmp" });
    const events: any[] = [];
    session.subscribe((e) => events.push(e));

    process.env.MIMI_API_KEY_DEEPSEEK = "sk-test";
    await session.prompt("hello");
    delete process.env.MIMI_API_KEY_DEEPSEEK;

    expect(events.length).toBeGreaterThan(0);
  });

  it("abort 调 agent.abort", () => {
    const agent = new Agent();
    const sm = SessionManager.inMemory("/tmp");
    const runtime = new ModelRuntime(new ModelRegistry());
    const session = new AgentSession({ agent, sessionManager: sm, modelRuntime: runtime, cwd: "/tmp" });

    session.abort();
    // agent.abort 被调（此处只验证不抛错）
  });
});
```

- [ ] **Step 2: 跑测试验证失败**

```bash
cd packages/coding-agent && npx vitest run src/__tests__/agent-session.test.ts
```
Expected: FAIL

- [ ] **Step 3: 实现 AgentSessionServices**

```ts
// packages/coding-agent/src/core/agent-session-services.ts
import type { ModelRuntime } from "./model-runtime.js";
import type { SessionManager } from "./session-manager.js";

export interface AgentSessionServices {
  cwd: string;
  agentDir: string;
  sessionDir: string;
  modelRuntime: ModelRuntime;
  sessionManager: SessionManager;
}
```

- [ ] **Step 4: 实现 AgentSession**

```ts
// packages/coding-agent/src/core/agent-session.ts
import type { Agent, AgentMessage, AgentEvent, ThinkingLevel, AgentSessionEventListener, AgentSessionEvent } from "@mimi/agent";
import type { Model } from "@mimi/ai";
import type { SessionManager } from "./session-manager.js";
import type { ModelRuntime } from "./model-runtime.js";
import { BUILTIN_TOOLS } from "./tools/index.js";
import { buildSystemPrompt } from "./system-prompt.js";

export interface AgentSessionConfig {
  agent: Agent;
  sessionManager: SessionManager;
  modelRuntime: ModelRuntime;
  cwd: string;
}

export interface PromptOptions {
  images?: Array<{ data: string; mimeType: string }>;
}

export interface SessionStats {
  sessionId: string;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  totalMessages: number;
}

export class AgentSession {
  readonly agent: Agent;
  readonly sessionManager: SessionManager;
  readonly modelRuntime: ModelRuntime;
  private _cwd: string;
  private _listeners: Array<(event: AgentSessionEvent) => void> = [];
  private _unsubscribeAgent?: () => void;

  constructor(config: AgentSessionConfig) {
    this.agent = config.agent;
    this.sessionManager = config.sessionManager;
    this.modelRuntime = config.modelRuntime;
    this._cwd = config.cwd;

    // 订阅 Agent 事件 → 自动持久化 + 转发给 session 订阅者
    this._unsubscribeAgent = this.agent.subscribe((event, _signal) => {
      this._handleAgentEvent(event);
    });
  }

  // ── 入口 ──

  async prompt(text: string, options?: PromptOptions): Promise<AgentMessage[]> {
    // 设置工具
    if (this.agent.state.tools.length === 0) {
      this.agent.state.tools = [...BUILTIN_TOOLS];
    }

    // 设置 system prompt
    if (!this.agent.state.systemPrompt) {
      this.agent.state.systemPrompt = buildSystemPrompt({ cwd: this._cwd });
    }

    // 获取 API key
    const model = this.agent.state.model;
    try {
      const auth = await this.modelRuntime.getAuth(model);
      this.agent.getApiKey = async () => auth.apiKey;
    } catch {
      // auth 失败不阻止 prompt，让 agent 层处理
    }

    // streamFn：用 AI 层的 Models.stream
    // (由 AgentSessionRuntime 在构造时注入)

    await this.agent.prompt(text, options?.images);
    return this.agent.state.messages;
  }

  async compact(): Promise<any> {
    // TODO: Task 7 补全
    throw new Error("compact: not yet implemented (Task 7)");
  }

  abort(): void {
    this.agent.abort();
  }

  // ── 事件 ──

  subscribe(listener: (event: AgentSessionEvent) => void): () => void {
    this._listeners.push(listener);
    return () => {
      this._listeners = this._listeners.filter((l) => l !== listener);
    };
  }

  // ── 配置 ──

  setModel(model: Model<any>): void {
    this.agent.state.model = model;
  }

  setThinkingLevel(level: ThinkingLevel): void {
    this.agent.state.thinkingLevel = level;
  }

  // ── 状态 ──

  getStats(): SessionStats {
    const msgs = this.agent.state.messages;
    return {
      sessionId: this.sessionManager.id,
      userMessages: msgs.filter((m) => m.role === "user").length,
      assistantMessages: msgs.filter((m) => m.role === "assistant").length,
      toolCalls: 0,
      totalMessages: msgs.length,
    };
  }

  waitForIdle(): Promise<void> {
    return this.agent.waitForIdle();
  }

  // ── 内部 ──

  private _handleAgentEvent(event: AgentEvent): void {
    // 自动持久化：fire-and-forget
    if (event.type === "message_end") {
      this.sessionManager.appendEntry({
        type: "message",
        role: (event.message as any).role ?? "assistant",
        content: JSON.stringify((event.message as any).content ?? ""),
        timestamp: Date.now(),
      } as any).catch((e) => console.error("Session append error:", e));
    }

    // 转成 AgentSessionEvent 转发给订阅者
    for (const listener of this._listeners) {
      listener(event as AgentSessionEvent);
    }
  }
}
```

- [ ] **Step 5: 实现 AgentSessionRuntime**

```ts
// packages/coding-agent/src/core/agent-session-runtime.ts
import type { AgentSession } from "./agent-session.js";
import type { AgentSessionServices } from "./agent-session-services.js";
import type { ModelRuntime } from "./model-runtime.js";
import type { SessionManager } from "./session-manager.js";

export interface AgentSessionRuntimeDiagnostic {
  type: "error" | "warning";
  message: string;
}

export class AgentSessionRuntime {
  private _session: AgentSession;
  private _services: AgentSessionServices;
  private _diagnostics: AgentSessionRuntimeDiagnostic[];

  constructor(session: AgentSession, services: AgentSessionServices, diagnostics?: AgentSessionRuntimeDiagnostic[]) {
    this._session = session;
    this._services = services;
    this._diagnostics = diagnostics ?? [];
  }

  get session(): AgentSession { return this._session; }
  get services(): AgentSessionServices { return this._services; }
  get diagnostics(): readonly AgentSessionRuntimeDiagnostic[] { return this._diagnostics; }

  async dispose(): Promise<void> {
    this._services.sessionManager.close();
  }

  async newSession(_options?: any): Promise<void> {
    throw new Error("newSession: not yet implemented (needs SDK integration)");
  }
}
```

- [ ] **Step 6: 实现 SDK（sdk.ts）**

```ts
// packages/coding-agent/src/core/sdk.ts
import { Agent } from "@mimi/agent";
import { ModelRegistry } from "./model-registry.js";
import { ModelRuntime } from "./model-runtime.js";
import { SessionManager } from "./session-manager.js";
import { AgentSession, type AgentSessionConfig } from "./agent-session.js";
import { AgentSessionRuntime, type AgentSessionRuntimeDiagnostic } from "./agent-session-runtime.js";
import { resolveModel } from "./model-resolver.js";
import { DEFAULT_MODEL } from "./defaults.js";
import type { AgentSessionServices } from "./agent-session-services.js";
import { anthropicProvider, openaiProvider, deepseekProvider } from "@mimi/ai";

export interface CreateAgentSessionOptions {
  cwd?: string;
  model?: string;
  thinkingLevel?: string;
  sessionManager?: SessionManager;
  noSession?: boolean;
}

export interface CreateAgentSessionResult {
  session: AgentSession;
  runtime: AgentSessionRuntime;
  services: AgentSessionServices;
  diagnostics: AgentSessionRuntimeDiagnostic[];
}

export async function createAgentSession(options: CreateAgentSessionOptions): Promise<CreateAgentSessionResult> {
  const cwd = options.cwd ?? process.cwd();
  const diagnostics: AgentSessionRuntimeDiagnostic[] = [];

  // 1. 注册模型
  const registry = new ModelRegistry();
  registry.register(deepseekProvider());
  registry.register(openaiProvider());
  registry.register(anthropicProvider());

  const modelRuntime = new ModelRuntime(registry);

  // 2. 解析模型
  const model = resolveModel(options.model, modelRuntime, DEFAULT_MODEL);

  // 3. 创建 SessionManager
  const sessionDir = process.env.MIMI_SESSION_DIR;
  const sm = options.sessionManager ?? (options.noSession
    ? SessionManager.inMemory(cwd)
    : SessionManager.continueRecent(cwd, sessionDir));

  // 4. 创建 Agent
  const agent = new Agent({
    initialState: {
      model,
      thinkingLevel: (options.thinkingLevel as any) ?? "medium",
    },
  });

  // 5. 创建 AgentSession
  const session = new AgentSession({
    agent,
    sessionManager: sm,
    modelRuntime,
    cwd,
  });

  // 6. 组装 services
  const services: AgentSessionServices = {
    cwd,
    agentDir: cwd,
    sessionDir: sessionDir ?? `${cwd}/.mimi/sessions`,
    modelRuntime,
    sessionManager: sm,
  };

  const runtime = new AgentSessionRuntime(session, services, diagnostics);

  return { session, runtime, services, diagnostics };
}
```

- [ ] **Step 7: 跑测试验证通过**

```bash
cd packages/coding-agent && npx vitest run src/__tests__/agent-session.test.ts
```
Expected: PASS

- [ ] **Step 8: 从 core/index.ts 导出**

```ts
export { AgentSession, type AgentSessionConfig, type PromptOptions, type SessionStats } from "./agent-session.js";
export { AgentSessionRuntime, type AgentSessionRuntimeDiagnostic } from "./agent-session-runtime.js";
export type { AgentSessionServices } from "./agent-session-services.js";
export { createAgentSession, type CreateAgentSessionOptions, type CreateAgentSessionResult } from "./sdk.js";
```

- [ ] **Step 9: Commit**

```bash
git add packages/coding-agent/src/core/agent-session.ts packages/coding-agent/src/core/agent-session-runtime.ts packages/coding-agent/src/core/agent-session-services.ts packages/coding-agent/src/core/sdk.ts packages/coding-agent/src/core/index.ts packages/coding-agent/src/__tests__/agent-session.test.ts
git commit -m "feat(coding-agent): agentsession + runtime + services + sdk"
```

---

### Task 7: Compaction + Messages + SystemPrompt + BashExecutor

**Files:**
- Create: `packages/coding-agent/src/core/compaction/compaction.ts`
- Create: `packages/coding-agent/src/core/compaction/index.ts`
- Create: `packages/coding-agent/src/core/system-prompt.ts`
- Create: `packages/coding-agent/src/core/messages.ts`
- Create: `packages/coding-agent/src/core/bash-executor.ts`
- Create: `packages/coding-agent/src/core/event-bus.ts`

**Interfaces:**
- Consumes: Agent 层的 `compact`, `shouldCompact`, `generateSummary`, `estimateTokens`
- Consumes: `AgentMessage`, `Message` 类型
- Produces: `compact()` 编排函数, `buildSystemPrompt()`, `convertToLlm()` (薄包装), `executeBash()` (薄包装), `EventBus` (桩)

- [ ] **Step 1: 写 compaction/compaction.ts**

```ts
// packages/coding-agent/src/core/compaction/compaction.ts
import {
  compact as agentCompact,
  shouldCompact,
  type CompactionResult,
  type CompactionSettings,
} from "@mimi/agent";
import type { Model, StreamFn } from "@mimi/ai";
import type { SessionManager } from "../session-manager.js";

export { type CompactionResult, type CompactionSettings };

export async function compact(
  sessionManager: SessionManager,
  model: Model<any>,
  streamFn: StreamFn,
  settings?: CompactionSettings,
): Promise<CompactionResult | undefined> {
  // 读取 session messages，判断是否需要压缩，执行压缩，写入结果
  // V1: 走 agent 层已有的 compact 逻辑
  throw new Error("compact: full implementation pending (wiring to session)");
}
```

- [ ] **Step 2: 写 compaction/index.ts**

```ts
export { compact, type CompactionResult, type CompactionSettings } from "./compaction.js";
```

- [ ] **Step 3: 写 system-prompt.ts**

```ts
// packages/coding-agent/src/core/system-prompt.ts
export interface BuildSystemPromptOptions {
  cwd: string;
  model?: string;
}

export function buildSystemPrompt(options: BuildSystemPromptOptions): string {
  return [
    `You are mimi, an AI coding assistant.`,
    ``,
    `Working directory: ${options.cwd}`,
    ``,
    `You have access to the following tools:`,
    `- read_file: Read file contents`,
    `- write_file: Write file contents`,
    `- edit: Edit file with exact string replacement`,
    `- bash: Execute shell commands`,
    `- find: Search for files by name pattern`,
    `- grep: Search file contents`,
    `- ls: List directory contents`,
    ``,
    `Always use absolute or relative paths within the working directory.`,
    `Be concise and helpful.`,
  ].join("\n");
}
```

- [ ] **Step 4: 写 messages.ts**

```ts
// packages/coding-agent/src/core/messages.ts
import type { AgentMessage, Message } from "@mimi/agent";

/**
 * 默认的 AgentMessage → LLM Message 转换。
 * 过滤掉非标准 role 的自定义消息。
 */
export function convertToLlm(messages: AgentMessage[]): Message[] {
  return messages.filter(
    (m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult",
  ) as Message[];
}
```

- [ ] **Step 5: 写 bash-executor.ts**

```ts
// packages/coding-agent/src/core/bash-executor.ts
import { exec } from "node:child_process";
import { BASH_DEFAULT_TIMEOUT_MS, BASH_DEFAULT_MAX_OUTPUT_BYTES } from "./defaults.js";

export interface BashOptions {
  command: string;
  cwd: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface BashResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  truncated: boolean;
}

export async function executeBash(options: BashOptions): Promise<BashResult> {
  const { command, cwd, timeoutMs = BASH_DEFAULT_TIMEOUT_MS, maxOutputBytes = BASH_DEFAULT_MAX_OUTPUT_BYTES } = options;

  return new Promise((resolve) => {
    exec(command, { cwd, timeout: timeoutMs, maxBuffer: maxOutputBytes * 2 }, (error, stdout, stderr) => {
      let output = stdout;
      let errOutput = stderr;
      let truncated = false;
      if (output.length > maxOutputBytes) { output = output.slice(0, maxOutputBytes); truncated = true; }
      if (errOutput.length > maxOutputBytes) { errOutput = errOutput.slice(0, maxOutputBytes); truncated = true; }
      resolve({ stdout: output, stderr: errOutput, exitCode: error?.code ?? 0, truncated });
    });
  });
}
```

- [ ] **Step 6: 写 event-bus.ts（桩）**

```ts
// packages/coding-agent/src/core/event-bus.ts
// V1: 桩。后续扩展系统用。
export class EventBus {
  // TODO 🔴 后续实现
}
```

- [ ] **Step 7: 从 core/index.ts 导出**

```ts
export { compact, type CompactionResult, type CompactionSettings } from "./compaction/index.js";
export { buildSystemPrompt, type BuildSystemPromptOptions } from "./system-prompt.js";
export { convertToLlm } from "./messages.js";
export { executeBash, type BashOptions, type BashResult } from "./bash-executor.js";
export { EventBus } from "./event-bus.js";
```

- [ ] **Step 8: Commit**

```bash
git add packages/coding-agent/src/core/compaction/ packages/coding-agent/src/core/system-prompt.ts packages/coding-agent/src/core/messages.ts packages/coding-agent/src/core/bash-executor.ts packages/coding-agent/src/core/event-bus.ts packages/coding-agent/src/core/index.ts
git commit -m "feat(coding-agent): compaction + system-prompt + messages + bash-executor"
```

---

### Task 8: Print Mode + Interactive Mode + main.ts + cli.ts

**Files:**
- Create: `packages/coding-agent/src/modes/print-mode.ts`
- Create: `packages/coding-agent/src/modes/interactive/interactive-mode.ts`
- Create: `packages/coding-agent/src/modes/index.ts`
- Create: `packages/coding-agent/src/utils/ansi.ts`
- Create: `packages/coding-agent/src/utils/paths.ts`
- Create: `packages/coding-agent/src/utils/shell.ts`
- Modify: `packages/coding-agent/src/main.ts` (空壳 → 完整实现)
- Modify: `packages/coding-agent/src/cli.ts` (空壳 → 完整实现)

**Interfaces:**
- Consumes: `AgentSessionRuntime`, `AgentSession` from core
- Consumes: `createAgentSession` from `./core/sdk.js`
- Consumes: `config.ts`, `defaults.ts`
- Produces: `runPrintMode()`, `InteractiveMode`, `main()`

- [ ] **Step 1: 写 utils/ansi.ts**

```ts
// packages/coding-agent/src/utils/ansi.ts
export const ANSI = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[36m",
  gray: "\x1b[90m",
};

let _isTty: boolean | null = null;
function isTty(): boolean {
  if (_isTty === null) _isTty = process.stdout.isTTY === true;
  return _isTty;
}

export function color(text: string, code: keyof typeof ANSI): string {
  return isTty() ? `${ANSI[code]}${text}${ANSI.reset}` : text;
}
```

- [ ] **Step 2: 写 utils/paths.ts**

```ts
import { resolve, isAbsolute } from "node:path";
export function normalizePath(input: string, cwd: string): string {
  return isAbsolute(input) ? input : resolve(cwd, input);
}
```

- [ ] **Step 3: 写 utils/shell.ts（桩）**

```ts
// V1 桩。后续用于 SIGTERM 时 kill detached children。
export function killTrackedDetachedChildren(): void {}
```

- [ ] **Step 4: 写 print-mode.ts**

```ts
// packages/coding-agent/src/modes/print-mode.ts
import type { AgentSessionRuntime } from "../core/agent-session-runtime.js";
import type { AgentSessionEvent } from "@mimi/agent";

export interface PrintModeOptions {
  mode: "text" | "json";
  initialMessage: string;
  images?: Array<{ data: string; mimeType: string }>;
}

export async function runPrintMode(runtime: AgentSessionRuntime, options: PrintModeOptions): Promise<number> {
  const { mode, initialMessage, images } = options;
  const session = runtime.session;
  let exitCode = 0;

  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    if (mode === "json") {
      process.stdout.write(JSON.stringify(event) + "\n");
    } else if (event.type === "agent_end") {
      // text mode: print last assistant message
      const msgs = (event as any).messages ?? [];
      for (const msg of msgs) {
        if (msg.role === "assistant" && msg.content) {
          for (const block of msg.content) {
            if (block.type === "text") {
              process.stdout.write(block.text + "\n");
            }
          }
        }
      }
    }
  });

  const signalHandler = () => {
    session.abort();
    exitCode = 130;
  };
  process.on("SIGINT", signalHandler);

  try {
    await session.prompt(initialMessage, { images });
    await session.waitForIdle();
  } catch (err: any) {
    process.stderr.write(`Error: ${err.message}\n`);
    exitCode = 1;
  } finally {
    process.off("SIGINT", signalHandler);
    unsubscribe();
    await runtime.dispose();
  }

  return exitCode;
}
```

- [ ] **Step 5: 写 interactive-mode.ts**

```ts
// packages/coding-agent/src/modes/interactive/interactive-mode.ts
import * as readline from "node:readline/promises";
import type { AgentSessionRuntime } from "../../core/agent-session-runtime.js";
import type { AgentSessionEvent } from "@mimi/agent";
import { color } from "../../utils/ansi.js";

export class InteractiveMode {
  static async start(runtime: AgentSessionRuntime): Promise<number> {
    const session = runtime.session;
    let exitCode = 0;

    // 订阅事件 → 文本渲染
    const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
      switch (event.type) {
        case "text_delta":
          process.stdout.write((event as any).delta ?? "");
          break;
        case "text_end":
          process.stdout.write("\n");
          break;
        case "thinking_delta":
          process.stdout.write(color(`🤔 ${(event as any).delta ?? ""}`, "gray"));
          break;
        case "thinking_end":
          process.stdout.write("\n");
          break;
        case "toolcall_start":
          process.stdout.write(color(`🔧 ${(event as any).toolName ?? ""}(`, "blue"));
          break;
        case "toolcall_end":
          process.stdout.write(color(")", "blue") + "\n");
          break;
        case "tool_execution_end": {
          const e = event as any;
          const success = !e.isError;
          const icon = success ? "✓" : "✗";
          const code = success ? "green" : "red" as const;
          process.stdout.write(color(`${icon} done`, code) + "\n");
          break;
        }
        case "turn_end":
          process.stdout.write("\n");
          break;
        case "error":
          process.stdout.write(color(`Error: ${(event as any).message ?? ""}`, "red") + "\n");
          break;
      }
    });

    console.log(color(`mimi v0.1.0`, "green"));
    console.log(color(`Session: ${runtime.services.sessionManager.id}`, "gray"));
    console.log();

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: "mimi> ",
    });

    const sigintHandler = () => {
      session.abort();
    };
    process.on("SIGINT", sigintHandler);

    try {
      while (true) {
        const line = await rl.question("").catch(() => null);
        if (line === null || line === "exit" || line === "quit") break;
        if (line.trim() === "") continue;
        rl.setPrompt("");
        await session.prompt(line);
        rl.setPrompt("mimi> ");
      }
    } catch (err: any) {
      process.stderr.write(color(`Error: ${err.message}`, "red") + "\n");
      exitCode = 1;
    } finally {
      process.off("SIGINT", sigintHandler);
      rl.close();
      unsubscribe();
      await runtime.dispose();
    }

    return exitCode;
  }
}
```

- [ ] **Step 6: 写 modes/index.ts**

```ts
export { runPrintMode, type PrintModeOptions } from "./print-mode.js";
export { InteractiveMode } from "./interactive/interactive-mode.js";
```

- [ ] **Step 7: 写 main.ts**

```ts
// packages/coding-agent/src/main.ts
import { createAgentSession } from "./core/sdk.js";
import { runPrintMode } from "./modes/print-mode.js";
import { InteractiveMode } from "./modes/interactive/interactive-mode.js";
import { VERSION, APP_NAME } from "./config.js";

interface MainOptions {
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  env: NodeJS.ProcessEnv;
  cwd: string;
  exit: (code: number) => void;
}

interface ParsedArgs {
  print?: string;
  model?: string;
  thinking?: string;
  resume?: boolean;
  continue?: boolean;
  session?: string;
  cwd?: string;
  noSession?: boolean;
  help?: boolean;
  version?: boolean;
  mode?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "-p": case "--print": args.print = argv[++i] ?? ""; break;
      case "--model": args.model = argv[++i]; break;
      case "--thinking": args.thinking = argv[++i]; break;
      case "--resume": args.resume = true; break;
      case "--continue": args.continue = true; break;
      case "--session": args.session = argv[++i]; break;
      case "--cwd": args.cwd = argv[++i]; break;
      case "--no-session": args.noSession = true; break;
      case "--help": args.help = true; break;
      case "--version": args.version = true; break;
      case "--mode": args.mode = argv[++i]; break;
      default:
        if (!a.startsWith("-")) args.print = a;
    }
  }
  return args;
}

async function readPipedStdin(stdin: NodeJS.ReadableStream): Promise<string | undefined> {
  if ((stdin as any).isTTY) return undefined;
  return new Promise((resolve) => {
    let data = "";
    stdin.setEncoding("utf8");
    stdin.on("data", (chunk) => { data += chunk; });
    stdin.on("end", () => { resolve(data.trim() || undefined); });
    stdin.resume();
  });
}

function printHelp(out: NodeJS.WritableStream): void {
  out.write([
    `${APP_NAME} v${VERSION} - AI Coding Assistant`,
    ``,
    `Usage:`,
    `  mimi "your prompt"            Single-shot mode`,
    `  mimi                          REPL mode`,
    `  mimi --resume                 Resume a session`,
    ``,
    `Options:`,
    `  -p, --print <prompt>   Single-shot mode`,
    `  --model <id>           Model to use (default: deepseek-chat)`,
    `  --thinking <level>     Thinking level (off/minimal/low/medium/high)`,
    `  --resume               Pick a session to resume`,
    `  --continue             Continue most recent session`,
    `  --session <id>         Open a specific session`,
    `  --cwd <path>           Working directory`,
    `  --no-session           Don't persist session`,
    `  --help                 Show help`,
    `  --version              Show version`,
    ``,
    `Environment:`,
    `  MIMI_MODEL             Default model`,
    `  MIMI_API_KEY_DEEPSEEK  DeepSeek API key`,
    `  MIMI_API_KEY_ANTHROPIC Anthropic API key`,
    `  MIMI_API_KEY_OPENAI    OpenAI API key`,
    `  MIMI_THINKING          Default thinking level`,
    `  MIMI_SESSION_DIR       Session storage directory`,
    ``,
  ].join("\n") + "\n");
}

export async function main(argv: string[], options: MainOptions): Promise<void> {
  const parsed = parseArgs(argv);

  // --help
  if (parsed.help) { printHelp(options.stdout); options.exit(0); return; }

  // --version
  if (parsed.version) { options.stdout.write(`${VERSION}\n`); options.exit(0); return; }

  // 设置环境变量
  if (parsed.cwd) process.env.MIMI_CWD = parsed.cwd;

  // 读取 pipe stdin
  const stdinContent = await readPipedStdin(options.stdin);
  const promptText = parsed.print ?? stdinContent;

  // 判断模式
  const isTty = (options.stdin as any).isTTY && (options.stdout as any).isTTY;
  const isPrint = !!promptText || !isTty;

  try {
    const result = await createAgentSession({
      cwd: parsed.cwd ?? options.cwd,
      model: parsed.model,
      thinkingLevel: parsed.thinking,
      noSession: parsed.noSession,
    });

    if (isPrint && promptText) {
      const code = await runPrintMode(result.runtime, {
        mode: parsed.mode === "json" ? "json" : "text",
        initialMessage: promptText,
      });
      options.exit(code);
    } else {
      const code = await InteractiveMode.start(result.runtime);
      options.exit(code);
    }
  } catch (err: any) {
    options.stderr.write(`Error: ${err.message}\n`);
    options.exit(1);
  }
}
```

- [ ] **Step 8: 写 cli.ts**

```ts
#!/usr/bin/env node
import { main } from "./main.js";

process.title = "mimi";
process.env.MIMI_CODING_AGENT = "true";

main(process.argv.slice(2), {
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  env: process.env,
  cwd: process.cwd(),
  exit: (code) => process.exit(code),
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 9: 写 index.ts 总入口**

```ts
export { main } from "./main.js";
export { createAgentSession, type CreateAgentSessionOptions, type CreateAgentSessionResult } from "./core/sdk.js";
export { SessionManager, type SessionInfo } from "./core/session-manager.js";
export { AgentSession, type AgentSessionConfig, type PromptOptions } from "./core/agent-session.js";
export { AgentSessionRuntime, type AgentSessionRuntimeDiagnostic } from "./core/agent-session-runtime.js";
export { ModelRegistry } from "./core/model-registry.js";
export { ModelRuntime } from "./core/model-runtime.js";
export { InteractiveMode } from "./modes/interactive/interactive-mode.js";
export { runPrintMode, type PrintModeOptions } from "./modes/print-mode.js";
```

- [ ] **Step 10: tsc 编译 + 端到端验证**

```bash
cd packages/coding-agent && pnpm build && npx mimi --help
```
Expected: 看到帮助文本

- [ ] **Step 11: Commit**

```bash
git add packages/coding-agent/src/
git commit -m "feat(coding-agent): print mode + interactive mode + cli entry"
```

---

## 总验证清单

```bash
# 全量类型检查
cd packages/agent && npx tsc --noEmit
cd packages/coding-agent && npx tsc --noEmit

# 全量单元测试
cd packages/agent && npx vitest run
cd packages/coding-agent && npx vitest run

# 端到端
cd packages/coding-agent && pnpm build
npx mimi --help
npx mimi --version
```
