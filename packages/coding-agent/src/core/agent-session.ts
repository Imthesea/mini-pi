/**
 * AgentSession - Core abstraction for agent lifecycle and session management.
 *
 * This class is shared between all run modes (interactive, print).
 * It encapsulates:
 * - Agent state access
 * - Event subscription with automatic session persistence
 * - Model and thinking level management
 * - Compaction (manual and auto)
 *
 * Modes use this class and add their own I/O layer on top.
 *
 * 从 pi 项目 core/agent-session.ts 抄来（V1 最小化）。
 */

import type {
  Agent,
  AgentEvent,
  AgentMessage,
  AgentTool,
  ThinkingLevel,
} from "@mimi/agent";
import { isContextOverflow, isRetryableAssistantError } from "@mimi/ai";
import type { AssistantMessage, ImageContent, Model } from "@mimi/ai";
import type { SessionManager } from "./session-manager.js";
import { getLatestCompactionEntry } from "./session-manager.js";
import type { ModelRuntime } from "./model-runtime.js";
import type { SettingsManager } from "./settings-manager.js";
import { createBuiltinTools } from "./tools/index.js";
import {
  compact as runCompaction,
  prepareCompaction,
  estimateTokens,
  estimateContextTokens,
  calculateContextTokens,
  shouldCompact,
  type CompactionResult,
} from "./compaction/index.js";
import { formatNoModelSelectedMessage } from "./auth-guidance.js";
import { sleep } from "./utils/sleep.js";

// ============================================================================
// Types
// ============================================================================

/** AgentSession 配置 */
export interface AgentSessionConfig {
  /** Agent 实例 */
  agent: Agent;
  /** 会话管理器 */
  sessionManager: SessionManager;
  /** 设置管理器（自动压缩 / 重试开关与参数） */
  settingsManager: SettingsManager;
  /** 工作目录 */
  cwd: string;
  /** 标准模型/认证运行时，供 coding-agent 内部使用 */
  modelRuntime: ModelRuntime;
  /** 可供切换的模型范围（Ctrl+P 切换用）—— V1 桩 */
  scopedModels?: Array<{ model: Model<any>; thinkingLevel?: ThinkingLevel }>;
  /** 可选：限制可用内置工具名子集；空 = 全部内置工具 */
  toolNames?: string[];
  /** 可选：追加到 system prompt 末尾的文本 */
  appendSystemPrompt?: string;
  /** 可选：扩展系统注入的额外工具 */
  extraTools?: AgentTool<any>[];
}

/** 按 toolNames 过滤内置工具。空 toolNames = 返回全部 */
export function selectTools(all: AgentTool<any>[], toolNames: string[]): AgentTool<any>[] {
  if (toolNames.length === 0) return all;
  return all.filter((t) => toolNames.includes(t.name));
}

/** 过滤掉值为 null 的请求头，返回纯字符串头。未定义时原样返回 undefined */
function withoutDeletedHeaders(
  headers: Record<string, string | null> | undefined,
): Record<string, string> | undefined {
  return headers
    ? Object.fromEntries(
        Object.entries(headers).filter((entry): entry is [string, string] => entry[1] !== null),
      )
    : undefined;
}

/** 估算一组消息的总 token 数（逐条用 estimateTokens 累加） */
function estimateMessagesTokens(messages: AgentMessage[]): number {
  let tokens = 0;
  for (const message of messages) {
    tokens += estimateTokens(message);
  }
  return tokens;
}

/** AgentSession.prompt() 的选项 */
export interface PromptOptions {
  /** 图片附件 */
  images?: ImageContent[];
}

/** /session 命令的会话统计信息 */
export interface SessionStats {
  /** 会话文件路径；未持久化时为 undefined */
  sessionFile: string | undefined;
  /** 会话 ID */
  sessionId: string;
  /** 用户消息数量 */
  userMessages: number;
  /** assistant 消息数量 */
  assistantMessages: number;
  /** 工具调用数量 */
  toolCalls: number;
  /** 工具结果数量 */
  toolResults: number;
  /** 消息总数 */
  totalMessages: number;
  /** token 统计 */
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  /** 估算费用 */
  cost: number;
}

/** 扩展自核心 AgentEvent 的会话级事件 */
export type AgentSessionEvent =
  | Exclude<AgentEvent, { type: "agent_end" }>
  | {
      type: "agent_end";
      messages: AgentMessage[];
      willRetry: boolean;
    }
  | { type: "agent_settled" }
  | {
      type: "queue_update";
      steering: readonly string[];
      followUp: readonly string[];
    }
  | { type: "compaction_start"; reason: "manual" | "threshold" | "overflow" }
  | {
      type: "compaction_end";
      reason: "manual" | "threshold" | "overflow";
      result: CompactionResult | undefined;
      aborted: boolean;
      willRetry: boolean;
      errorMessage?: string;
    }
  | { type: "auto_retry_start"; attempt: number; maxAttempts: number; delayMs: number; errorMessage: string }
  | { type: "auto_retry_end"; success: boolean; attempt: number; finalError?: string };

/** 会话事件监听器 */
export type AgentSessionEventListener = (event: AgentSessionEvent) => void;

// ============================================================================
// AgentSession Class
// ============================================================================

export class AgentSession {
  /** Agent 实例 */
  readonly agent: Agent;
  /** 会话管理器 */
  readonly sessionManager: SessionManager;
  /** 设置管理器 */
  readonly settingsManager: SettingsManager;

  /** 可供切换的模型范围 */
  private _scopedModels: Array<{ model: Model<any>; thinkingLevel?: ThinkingLevel }>;

  // ── 事件订阅状态 ──

  /** agent 事件退订函数 */
  private _unsubscribeAgent?: () => void;
  /** 会话事件监听器列表 */
  private _eventListeners: AgentSessionEventListener[] = [];
  /** agent run 是否正在执行 */
  private _isAgentRunActive = false;
  /** idle 等待 promise */
  private _idleWaitPromise: Promise<void> | undefined;
  /** idle 等待 resolve 函数 */
  private _resolveIdleWait: (() => void) | undefined;

  // ── 队列状态 ──

  /** 待处理的引导消息（供 UI 显示），交付后移除 */
  private _steeringMessages: string[] = [];
  /** 待处理的后续消息（供 UI 显示），交付后移除 */
  private _followUpMessages: string[] = [];

  // ── 压缩状态 ──

  /** 压缩中止控制器 */
  private _compactionAbortController: AbortController | undefined = undefined;
  /** 自动压缩中止控制器 */
  private _autoCompactionAbortController: AbortController | undefined = undefined;
  /** 是否已尝试过 overflow 恢复 */
  private _overflowRecoveryAttempted = false;
  /** 跟踪最后一条 assistant 消息，用于 post-run 的自动压缩检查 */
  private _lastAssistantMessage: AssistantMessage | undefined = undefined;

  // ── 重试状态 —— V1 桩 ──

  /** 重试中止控制器 */
  private _retryAbortController: AbortController | undefined = undefined;
  /** 当前重试次数 */
  private _retryAttempt = 0;

  /** turn 计数 */
  private _turnIndex = 0;

  /** 工作目录 */
  private _cwd: string;
  /** 模型运行时 */
  private _modelRuntime: ModelRuntime;
  /** 内置工具名子集（空 = 全部） */
  private _toolNames: string[];
  /** 追加到 system prompt 末尾的文本 */
  private _appendSystemPrompt: string;
  /** 扩展系统注入的额外工具 */
  private _extraTools: AgentTool<any>[];

  /** 基础系统 prompt（不含扩展追加内容） */
  private _baseSystemPrompt = "";

  constructor(config: AgentSessionConfig) {
    this.agent = config.agent;
    this.sessionManager = config.sessionManager;
    this.settingsManager = config.settingsManager;
    this._scopedModels = config.scopedModels ?? [];
    this._cwd = config.cwd;
    this._modelRuntime = config.modelRuntime;
    this._toolNames = config.toolNames ?? [];
    this._appendSystemPrompt = config.appendSystemPrompt ?? "";
    this._extraTools = config.extraTools ?? [];

    // Always subscribe to agent events for internal handling
    // (session persistence, auto-compaction, retry logic)
    this._unsubscribeAgent = this.agent.subscribe(this._handleAgentEvent);
  }

  /** 获取当前 agent state（对齐 Pi：AgentSession.state → Agent.state） */
  get state() {
    return this.agent.state;
  }

  /** 获取模型运行时 */
  get modelRuntime(): ModelRuntime {
    return this._modelRuntime;
  }

  /** 当前模型 */
  get model(): Model<any> {
    return this.agent.state.model;
  }

  /** 当前思考级别 */
  get thinkingLevel(): ThinkingLevel {
    return this.agent.state.thinkingLevel;
  }

  /** 按 toolNames 过滤内置工具 */
  private _selectTools(): AgentTool<any>[] {
    return selectTools(createBuiltinTools(this._cwd), this._toolNames);
  }

  // ==========================================================================
  // 入口
  // ==========================================================================

  /** 向 agent 发送文本消息并返回结果。自动持久化到 session */
  async prompt(text: string, options?: PromptOptions): Promise<AgentMessage[]> {
    // 设置默认工具（内置工具子集 + 扩展工具）
    if (this.agent.state.tools.length === 0) {
      this.agent.state.tools = [...this._selectTools(), ...this._extraTools];
    }

    // 设置 system prompt
    if (!this._baseSystemPrompt) {
      const append = this._appendSystemPrompt ? `\n\n${this._appendSystemPrompt}` : "";
      this._baseSystemPrompt = [
        `You are mimi, an AI coding assistant.`,
        ``,
        `Working directory: ${this._cwd}`,
        ``,
        `You have access to tools for reading, writing, editing files,`,
        `executing shell commands, searching file names (find),`,
        `searching file contents (grep), and listing directories (ls).`,
        append,
      ].join("\n");
      this.agent.state.systemPrompt = this._baseSystemPrompt;
    }

    // 获取 API key
    const model = this.agent.state.model;
    try {
      const auth = await this._modelRuntime.getAuth(model);
      if (auth?.auth.apiKey) {
        this.agent.getApiKey = async () => auth.auth.apiKey!;
      }
    } catch {
      // auth 失败不阻止 prompt，让 agent 层处理
    }

    if (options?.images) {
      await this.agent.prompt(text, options.images);
    } else {
      await this.agent.prompt(text);
    }

    // post-run 检查（适配方案 A）：agent.prompt() 内部闭环结束后，
    // 在这里统一处理可重试错误 + 自动压缩 + 队列续接。
    while (await this._handlePostAgentRun()) {
      await this.agent.continue();
    }

    return this.agent.state.messages;
  }

  /**
   * 手动压缩会话转录。
   * 先中止当前 agent 运行，再对当前分支生成摘要并重载会话上下文。
   * @param customInstructions 可选的压缩摘要补充指令
   */
  async compact(customInstructions?: string): Promise<CompactionResult> {
    this._disconnectFromAgent();
    await this.abort();
    this._compactionAbortController = new AbortController();
    this._emit({ type: "compaction_start", reason: "manual" });

    try {
      if (!this.model) {
        throw new Error(formatNoModelSelectedMessage());
      }

      const { apiKey, headers, env } = await this._getSummarizationRequestAuth(this.model);

      const pathEntries = this.sessionManager.getBranch();
      const settings = this.settingsManager.getCompactionSettings();

      const preparation = prepareCompaction(pathEntries, settings);
      if (!preparation) {
        const lastEntry = pathEntries[pathEntries.length - 1];
        if (lastEntry?.type === "compaction") {
          throw new Error("Already compacted");
        }
        throw new Error("Nothing to compact (session too small)");
      }

      const result = await runCompaction(preparation, this.model, apiKey, this.agent.streamFn, {
        headers,
        customInstructions,
        signal: this._compactionAbortController.signal,
        thinkingLevel: this.thinkingLevel,
        env,
      });

      if (this._compactionAbortController.signal.aborted) {
        throw new Error("Compaction cancelled");
      }

      this.sessionManager.appendCompaction(
        result.summary,
        result.firstKeptEntryId,
        result.tokensBefore,
        result.details,
      );
      const sessionContext = this.sessionManager.buildSessionContext();
      this.agent.state.messages = sessionContext.messages;
      const estimatedTokensAfter = estimateMessagesTokens(sessionContext.messages);

      const compactionResult: CompactionResult = {
        summary: result.summary,
        firstKeptEntryId: result.firstKeptEntryId,
        tokensBefore: result.tokensBefore,
        estimatedTokensAfter,
        details: result.details,
      };
      this._emit({
        type: "compaction_end",
        reason: "manual",
        result: compactionResult,
        aborted: false,
        willRetry: false,
      });
      return compactionResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const aborted =
        message === "Compaction cancelled" || (error instanceof Error && error.name === "AbortError");
      this._emit({
        type: "compaction_end",
        reason: "manual",
        result: undefined,
        aborted,
        willRetry: false,
        errorMessage: aborted ? undefined : `Compaction failed: ${message}`,
      });
      throw error;
    } finally {
      this._compactionAbortController = undefined;
      this._reconnectToAgent();
    }
  }

  /** 中止当前 agent run */
  abort(): void {
    this.agent.abort();
  }

  // ==========================================================================
  // 事件
  // ==========================================================================

  /** 订阅 AgentSession 事件。返回退订函数 */
  subscribe(listener: AgentSessionEventListener): () => void {
    this._eventListeners.push(listener);
    return () => {
      this._eventListeners = this._eventListeners.filter((l) => l !== listener);
    };
  }

  // ==========================================================================
  // 配置
  // ==========================================================================

  /** 设置当前模型 */
  setModel(model: Model<any>): void {
    this.agent.state.model = model;
  }

  /** 设置思考级别 */
  setThinkingLevel(level: ThinkingLevel): void {
    this.agent.state.thinkingLevel = level;
  }

  // ==========================================================================
  // 状态查询
  // ==========================================================================

  /** 获取会话统计信息 */
  getStats(): SessionStats {
    const msgs = this.agent.state.messages;
    return {
      sessionFile: this.sessionManager.getSessionFile(),
      sessionId: this.sessionManager.getSessionId(),
      userMessages: msgs.filter((m) => m.role === "user").length,
      assistantMessages: msgs.filter((m) => m.role === "assistant").length,
      toolCalls: 0,
      toolResults: msgs.filter((m) => m.role === "toolResult").length,
      totalMessages: msgs.length,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      cost: 0,
    };
  }

  /** 等待 agent 进入空闲状态 */
  waitForIdle(): Promise<void> {
    return this.agent.waitForIdle();
  }

  // ==========================================================================
  // 内部：事件处理 + 持久化
  // ==========================================================================

  /** 内部 agent 事件处理器——被 subscribe 共用。
   *  在 Pi 中也负责队列清理、扩展事件转发等操作。
   */
  private _handleAgentEvent = async (event: AgentEvent): Promise<void> => {
    // Session persistence
    if (event.type === "message_end") {
      try {
        this.sessionManager.appendMessage(event.message as any);
      } catch (e) {
        console.error("Session append error:", e);
      }

      // 记录最后一条 assistant 消息，供 post-run 的自动压缩/重试检查使用
      if (event.message.role === "assistant") {
        this._lastAssistantMessage = event.message as AssistantMessage;

        const assistantMsg = event.message as AssistantMessage;
        if (assistantMsg.stopReason !== "error") {
          this._overflowRecoveryAttempted = false;
        }

        // 一旦成功得到 assistant 响应，立即清零重试计数，
        // 避免同一 turn 内多次 LLM 调用导致计数累积
        if (assistantMsg.stopReason !== "error" && this._retryAttempt > 0) {
          this._emit({
            type: "auto_retry_end",
            success: true,
            attempt: this._retryAttempt,
          });
          this._retryAttempt = 0;
        }
      }
    }

    // Notify all listeners
    this._emit(
      event.type === "agent_end"
        ? ({ ...event, willRetry: false } as AgentSessionEvent)
        : (event as AgentSessionEvent),
    );

    if (event.type === "agent_end") {
      await this._emitAgentSettled();
    }
  };

  /** 触发会话事件通知所有监听器 */
  private _emit(event: AgentSessionEvent): void {
    for (const listener of this._eventListeners) {
      listener(event);
    }
  }

  /** 获取或创建 idle 等待 promise */
  private _getIdleWaitPromise(): Promise<void> {
    if (!this._idleWaitPromise) {
      this._idleWaitPromise = new Promise((resolve) => {
        this._resolveIdleWait = resolve;
      });
    }
    return this._idleWaitPromise;
  }

  /** 检查是否可以唤醒等待者 */
  private _resolveIdleWaitIfIdle(): void {
    if (this._isAgentRunActive || !this._resolveIdleWait) return;
    const resolve = this._resolveIdleWait;
    this._idleWaitPromise = undefined;
    this._resolveIdleWait = undefined;
    resolve();
  }

  /** 标记 Agent 不再运行 */
  private async _emitAgentSettled(): Promise<void> {
    this._isAgentRunActive = false;
    try {
      this._emit({ type: "agent_settled" });
    } finally {
      this._resolveIdleWaitIfIdle();
    }
  }

  // ==========================================================================
  // 压缩 / 重试
  // ==========================================================================

  /**
   * 获取摘要（summarization）请求的认证信息。
   * 认证失败不抛错——摘要是辅助性功能，出问题时跳过/降级即可，不影响主流程。
   */
  private async _getSummarizationRequestAuth(model: Model<any>): Promise<{
    apiKey?: string;
    headers?: Record<string, string>;
    env?: Record<string, string>;
  }> {
    try {
      const result = await this._modelRuntime.getAuth(model);
      return result
        ? { apiKey: result.auth.apiKey, headers: withoutDeletedHeaders(result.auth.headers), env: result.env }
        : {};
    } catch {
      return {};
    }
  }

  /** 暂时断开与 agent 事件的连接（压缩等需要暂停事件处理的内部操作时用） */
  private _disconnectFromAgent(): void {
    if (this._unsubscribeAgent) {
      this._unsubscribeAgent();
      this._unsubscribeAgent = undefined;
    }
  }

  /** 在 _disconnectFromAgent() 之后重新连接 agent 事件。保留已有监听器 */
  private _reconnectToAgent(): void {
    if (this._unsubscribeAgent) return; // 已连接
    this._unsubscribeAgent = this.agent.subscribe(this._handleAgentEvent);
  }

  /** 判断错误是否可重试（过载/限流/服务端错误）。上下文溢出错误交给压缩处理，不重试 */
  private _isRetryableError(message: AssistantMessage): boolean {
    if (isContextOverflow(message, this.model?.contextWindow ?? 0)) return false;
    return isRetryableAssistantError(message);
  }

  /** 为可重试错误做续接准备（指数退避）。返回 true 表示调用方应继续 agent */
  private async _prepareRetry(message: AssistantMessage): Promise<boolean> {
    const settings = this.settingsManager.getRetrySettings();
    if (!settings.enabled) {
      return false;
    }

    this._retryAttempt++;

    if (this._retryAttempt > settings.maxRetries) {
      // 保留已完成的尝试次数，让 post-run 能 emit 最终失败事件
      this._retryAttempt--;
      return false;
    }

    const delayMs = settings.baseDelayMs * 2 ** (this._retryAttempt - 1);

    this._emit({
      type: "auto_retry_start",
      attempt: this._retryAttempt,
      maxAttempts: settings.maxRetries,
      delayMs,
      errorMessage: message.errorMessage || "Unknown error",
    });

    // 从 agent state 移除错误消息（session 历史仍保留），这样 continue() 能正常续接
    const messages = this.agent.state.messages;
    if (messages.length > 0 && messages[messages.length - 1].role === "assistant") {
      this.agent.state.messages = messages.slice(0, -1);
    }

    // 指数退避等待（可中止）
    this._retryAbortController = new AbortController();
    try {
      await sleep(delayMs, this._retryAbortController.signal);
    } catch {
      // 等待期间被中止——emit 结束事件让 UI 清理
      const attempt = this._retryAttempt;
      this._retryAttempt = 0;
      this._emit({
        type: "auto_retry_end",
        success: false,
        attempt,
        finalError: "Retry cancelled",
      });
      return false;
    } finally {
      this._retryAbortController = undefined;
    }

    return true;
  }

  /** 取消进行中的重试 */
  abortRetry(): void {
    this._retryAbortController?.abort();
  }

  /** 是否正在自动重试 */
  get isRetrying(): boolean {
    return this._retryAbortController !== undefined;
  }

  /** 是否启用自动重试 */
  get autoRetryEnabled(): boolean {
    return this.settingsManager.getRetryEnabled();
  }

  /** 切换自动重试开关 */
  setAutoRetryEnabled(enabled: boolean): void {
    this.settingsManager.setRetryEnabled(enabled);
  }

  /** 取消进行中的压缩（手动或自动） */
  abortCompaction(): void {
    this._compactionAbortController?.abort();
    this._autoCompactionAbortController?.abort();
  }

  /** 切换自动压缩开关 */
  setAutoCompactionEnabled(enabled: boolean): void {
    this.settingsManager.setCompactionEnabled(enabled);
  }

  /** 是否启用自动压缩 */
  get autoCompactionEnabled(): boolean {
    return this.settingsManager.getCompactionEnabled();
  }

  /**
   * 检查是否需要压缩并执行。
   * 两种触发场景：
   * 1. Overflow：LLM 返回上下文溢出错误——移除错误消息、压缩、自动重试
   * 2. Threshold：上下文超过阈值——压缩，但不自动重试（用户手动继续）
   */
  private async _checkCompaction(assistantMessage: AssistantMessage, skipAbortedCheck = true): Promise<boolean> {
    const settings = this.settingsManager.getCompactionSettings();
    if (!settings.enabled) return false;

    // 跳过被中止的消息（用户取消）——除非 skipAbortedCheck 为 false
    if (skipAbortedCheck && assistantMessage.stopReason === "aborted") return false;

    const contextWindow = this.model?.contextWindow ?? 0;

    // 消息来自不同模型时跳过溢出检查（避免小上下文模型切换到
    // 大上下文模型后，旧模型的溢出错误误触发压缩）
    const sameModel =
      this.model && assistantMessage.provider === this.model.provider && assistantMessage.model === this.model.id;

    // 若该 assistant 消息早于最近一次压缩边界，说明是压缩前的陈旧消息，跳过
    const compactionEntry = getLatestCompactionEntry(this.sessionManager.getBranch());
    const assistantIsFromBeforeCompaction =
      compactionEntry !== null && assistantMessage.timestamp <= new Date(compactionEntry.timestamp).getTime();
    if (assistantIsFromBeforeCompaction) {
      return false;
    }

    // 场景 1：溢出
    if (sameModel && isContextOverflow(assistantMessage, contextWindow)) {
      const willRetry = assistantMessage.stopReason !== "stop";

      if (!willRetry) {
        return await this._runAutoCompaction("overflow", false);
      }

      if (this._overflowRecoveryAttempted) {
        this._emit({
          type: "compaction_end",
          reason: "overflow",
          result: undefined,
          aborted: false,
          willRetry: false,
          errorMessage:
            "Context overflow recovery failed after one compact-and-retry attempt. Try reducing context or switching to a larger-context model.",
        });
        return false;
      }

      this._overflowRecoveryAttempted = true;
      // 从 agent state 移除错误消息（session 历史仍保留，但重试时不需要它进上下文）
      const messages = this.agent.state.messages;
      if (messages.length > 0 && messages[messages.length - 1].role === "assistant") {
        this.agent.state.messages = messages.slice(0, -1);
      }
      return await this._runAutoCompaction("overflow", willRetry);
    }

    // 场景 2：阈值——上下文变大
    let contextTokens: number;
    const directContextTokens = assistantMessage.usage ? calculateContextTokens(assistantMessage.usage) : 0;
    if (assistantMessage.stopReason === "error" || directContextTokens === 0) {
      const messages = this.agent.state.messages;
      const estimate = estimateContextTokens(messages);
      if (estimate.lastUsageIndex === null) return false; // 完全没有 usage 数据
      // 校验 usage 来源是压缩之后的。压缩前保留的消息带有旧（更大）上下文的
      // 陈旧 usage，会在一轮刚压缩完后误触发再次压缩。
      const usageMsg = messages[estimate.lastUsageIndex];
      if (
        compactionEntry &&
        usageMsg.role === "assistant" &&
        (usageMsg as AssistantMessage).timestamp <= new Date(compactionEntry.timestamp).getTime()
      ) {
        return false;
      }
      contextTokens = estimate.tokens;
    } else {
      contextTokens = directContextTokens;
    }
    if (shouldCompact(contextTokens, contextWindow, settings)) {
      return await this._runAutoCompaction("threshold", false);
    }
    return false;
  }

  /** 内部：执行自动压缩并派发事件 */
  private async _runAutoCompaction(reason: "overflow" | "threshold", willRetry: boolean): Promise<boolean> {
    const settings = this.settingsManager.getCompactionSettings();
    let started = false;

    try {
      if (!this.model) {
        return false;
      }

      const { apiKey, headers, env } = await this._getSummarizationRequestAuth(this.model);

      const pathEntries = this.sessionManager.getBranch();

      const preparation = prepareCompaction(pathEntries, settings);
      if (!preparation) {
        return false;
      }

      this._emit({ type: "compaction_start", reason });
      this._autoCompactionAbortController = new AbortController();
      started = true;

      const result = await runCompaction(preparation, this.model, apiKey, this.agent.streamFn, {
        headers,
        signal: this._autoCompactionAbortController.signal,
        thinkingLevel: this.thinkingLevel,
        env,
      });

      if (this._autoCompactionAbortController.signal.aborted) {
        this._emit({
          type: "compaction_end",
          reason,
          result: undefined,
          aborted: true,
          willRetry: false,
        });
        return false;
      }

      this.sessionManager.appendCompaction(
        result.summary,
        result.firstKeptEntryId,
        result.tokensBefore,
        result.details,
      );
      const sessionContext = this.sessionManager.buildSessionContext();
      this.agent.state.messages = sessionContext.messages;
      const estimatedTokensAfter = estimateMessagesTokens(sessionContext.messages);

      const compactionResult: CompactionResult = {
        summary: result.summary,
        firstKeptEntryId: result.firstKeptEntryId,
        tokensBefore: result.tokensBefore,
        estimatedTokensAfter,
        details: result.details,
      };
      this._emit({ type: "compaction_end", reason, result: compactionResult, aborted: false, willRetry });

      if (willRetry) {
        const messages = this.agent.state.messages;
        const lastMsg = messages[messages.length - 1];
        if (lastMsg?.role === "assistant" && (lastMsg as AssistantMessage).stopReason === "error") {
          this.agent.state.messages = messages.slice(0, -1);
        }
        return true;
      }

      // 自动压缩完成后，可能还有 steer/followUp 等待，续接一次以投递排队消息
      return this.agent.hasQueuedMessages();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "compaction failed";
      if (started) {
        this._emit({
          type: "compaction_end",
          reason,
          result: undefined,
          aborted: false,
          willRetry: false,
          errorMessage:
            reason === "overflow"
              ? `Context overflow recovery failed: ${errorMessage}`
              : `Auto-compaction failed: ${errorMessage}`,
        });
      }
      return false;
    } finally {
      this._autoCompactionAbortController = undefined;
    }
  }

  /** post-run 检查：agent.prompt() 返回后决定是否续接（重试 / 压缩 / 队列） */
  private async _handlePostAgentRun(): Promise<boolean> {
    const msg = this._lastAssistantMessage;
    this._lastAssistantMessage = undefined;
    if (!msg) {
      return false;
    }

    if (this._isRetryableError(msg) && (await this._prepareRetry(msg))) {
      return true;
    }

    if (msg.stopReason === "error" && this._retryAttempt > 0) {
      this._emit({
        type: "auto_retry_end",
        success: false,
        attempt: this._retryAttempt,
        finalError: msg.errorMessage,
      });
      this._retryAttempt = 0;
    }

    if (await this._checkCompaction(msg)) {
      return true;
    }

    // agent-loop 排空两个队列后才会 emit agent_end；这里剩余的排队消息需要续接
    return this.agent.hasQueuedMessages();
  }
}
