/**
 * AgentSessionRuntime — Owns the current AgentSession plus its cwd-bound services.
 *
 * Session replacement methods tear down the current runtime first, then create
 * and apply the next runtime.
 *
 * 从 pi 项目 core/agent-session-runtime.ts 抄来（V1 最小化）。
 */

import { Agent } from "@mimi/agent";
import { SessionManager } from "./session-manager.js";
import { AgentSession } from "./agent-session.js";
import type {
  AgentSessionRuntimeDiagnostic,
  AgentSessionServices,
} from "./agent-session-services.js";

// 重导出——供 SDK 使用
export type { AgentSessionRuntimeDiagnostic, AgentSessionServices };

/**
 * Result returned by runtime creation.
 *
 * The caller gets the created session, its cwd-bound services, and all
 * diagnostics collected during setup.
 */
export interface CreateAgentSessionRuntimeResult {
  /** 创建的 session */
  session: AgentSession;
  /** cwd 绑定的 services */
  services: AgentSessionServices;
  /** 诊断信息 */
  diagnostics: AgentSessionRuntimeDiagnostic[];
}

/**
 * Creates a full runtime for a target cwd and session manager.
 *
 * The factory closes over process-global fixed inputs, recreates cwd-bound
 * services for the effective cwd, resolves session options against those
 * services, and finally creates the AgentSession.
 */
export type CreateAgentSessionRuntimeFactory = (options: {
  /** 工作目录 */
  cwd: string;
  /** agent 数据目录 */
  agentDir: string;
  /** 会话管理器 */
  sessionManager: SessionManager;
}) => Promise<CreateAgentSessionRuntimeResult>;

export class AgentSessionRuntime {
  /** 当前 session */
  private _session: AgentSession;
  /** cwd 绑定的 services */
  private _services: AgentSessionServices;
  /** 运行时工厂——用于 session 替换 */
  private readonly createRuntime: CreateAgentSessionRuntimeFactory;
  /** 诊断信息 */
  private _diagnostics: AgentSessionRuntimeDiagnostic[];
  /** 模型回退警告消息 */
  private _modelFallbackMessage?: string;

  constructor(
    _session: AgentSession,
    _services: AgentSessionServices,
    createRuntime: CreateAgentSessionRuntimeFactory,
    _diagnostics: AgentSessionRuntimeDiagnostic[] = [],
    _modelFallbackMessage?: string,
  ) {
    this._session = _session;
    this._services = _services;
    this.createRuntime = createRuntime;
    this._diagnostics = _diagnostics;
    this._modelFallbackMessage = _modelFallbackMessage;
  }

  /** 获取 cwd 绑定的 services */
  get services(): AgentSessionServices { return this._services; }

  /** 获取当前 session */
  get session(): AgentSession { return this._session; }

  /** 获取当前工作目录 */
  get cwd(): string { return this._services.cwd; }

  /** 获取创建过程中收集的诊断信息 */
  get diagnostics(): readonly AgentSessionRuntimeDiagnostic[] { return this._diagnostics; }

  /** 获取模型回退警告消息 */
  get modelFallbackMessage(): string | undefined { return this._modelFallbackMessage; }

  /**
   * 创建一个新会话并替换当前 runtime 状态。
   * V1 完整实现。
   */
  async newSession(options?: {
    /** 父会话路径 */
    parentSession?: string;
    /** 新会话创建后的回调 */
    setup?: (sessionManager: SessionManager) => Promise<void>;
  }): Promise<{ cancelled: boolean }> {
    const sessionDir = process.env.MIMI_SESSION_DIR;
    const sm = this._session.sessionManager.getSessionFile()
      ? SessionManager.create(this._services.cwd, sessionDir)
      : SessionManager.inMemory(this._services.cwd);

    const agent = new Agent({
      initialState: {
        model: this._session.agent.state.model,
        thinkingLevel: this._session.agent.state.thinkingLevel,
      },
    });

    this._session = new AgentSession({
      agent,
      sessionManager: sm,
      modelRuntime: this._services.modelRuntime,
      cwd: this._services.cwd,
    });
    this._services = { ...this._services, sessionManager: sm };

    if (options?.setup) {
      await options.setup(this._session.sessionManager);
      const ctx = this._session.sessionManager.buildSessionContext();
      this._session.agent.state.messages = ctx.messages;
    }

    return { cancelled: false };
  }

  /** 释放 runtime 资源 */
  async dispose(): Promise<void> {
    // V1: SessionManager 采用自动 flush，无需显式 close
  }
}

/**
 * Create the initial runtime from a runtime factory and initial session target.
 */
export async function createAgentSessionRuntime(
  createRuntime: CreateAgentSessionRuntimeFactory,
  options: {
    /** 工作目录 */
    cwd: string;
    /** agent 数据目录 */
    agentDir: string;
    /** 会话管理器 */
    sessionManager: SessionManager;
  },
): Promise<AgentSessionRuntime> {
  const result = await createRuntime(options);
  return new AgentSessionRuntime(
    result.session,
    result.services,
    createRuntime,
    result.diagnostics,
  );
}
