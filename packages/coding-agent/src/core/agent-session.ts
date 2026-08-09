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
  ThinkingLevel,
} from "@mimi/agent";
import type { ImageContent, Model } from "@mimi/ai";
import type { SessionManager } from "./session-manager.js";
import type { ModelRuntime } from "./model-runtime.js";
import { createBuiltinTools } from "./tools/index.js";

// ============================================================================
// Types
// ============================================================================

/** AgentSession 配置 */
export interface AgentSessionConfig {
  /** Agent 实例 */
  agent: Agent;
  /** 会话管理器 */
  sessionManager: SessionManager;
  /** 工作目录 */
  cwd: string;
  /** 标准模型/认证运行时，供 coding-agent 内部使用 */
  modelRuntime: ModelRuntime;
  /** 可供切换的模型范围（Ctrl+P 切换用）—— V1 桩 */
  scopedModels?: Array<{ model: Model<any>; thinkingLevel?: ThinkingLevel }>;
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
    };

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

  /** 基础系统 prompt（不含扩展追加内容） */
  private _baseSystemPrompt = "";

  constructor(config: AgentSessionConfig) {
    this.agent = config.agent;
    this.sessionManager = config.sessionManager;
    this._scopedModels = config.scopedModels ?? [];
    this._cwd = config.cwd;
    this._modelRuntime = config.modelRuntime;

    // Always subscribe to agent events for internal handling
    // (session persistence, auto-compaction, retry logic)
    this._unsubscribeAgent = this.agent.subscribe(this._handleAgentEvent);
  }

  /** 获取模型运行时 */
  get modelRuntime(): ModelRuntime {
    return this._modelRuntime;
  }

  // ==========================================================================
  // 入口
  // ==========================================================================

  /** 向 agent 发送文本消息并返回结果。自动持久化到 session */
  async prompt(text: string, options?: PromptOptions): Promise<AgentMessage[]> {
    // 设置默认工具
    if (this.agent.state.tools.length === 0) {
      this.agent.state.tools = createBuiltinTools(this._cwd);
    }

    // 设置 system prompt
    if (!this._baseSystemPrompt) {
      this._baseSystemPrompt = [
        `You are mimi, an AI coding assistant.`,
        ``,
        `Working directory: ${this._cwd}`,
        ``,
        `You have access to tools for reading, writing, editing files,`,
        `executing shell commands, searching file names (find),`,
        `searching file contents (grep), and listing directories (ls).`,
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

    return this.agent.state.messages;
  }

  /**
   * 压缩会话转录。
   * V1 桩——Task 7 补全
   */
  async compact(): Promise<any> {
    throw new Error("compact: not yet implemented");
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
}
