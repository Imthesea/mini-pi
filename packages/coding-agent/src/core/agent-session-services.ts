/**
 * AgentSessionServices —— 依赖工厂类型与创建逻辑。
 *
 * 从 pi 项目 core/agent-session-services.ts 抄来（V1 最小化）。
 */

import { Agent } from "@mimi/agent";
import { getAgentDir } from "../config.js";
import { ModelRegistry } from "./model-registry.js";
import { ModelRuntime } from "./model-runtime.js";
import { resolveModel } from "./model-resolver.js";
import { DEFAULT_MODEL } from "../defaults.js";
import { anthropicProvider, openaiProvider, deepseekProvider } from "@mimi/ai";
import type { SessionManager } from "./session-manager.js";
import { AgentSession } from "./agent-session.js";

// ═══════════════════════════════════════════
// 类型
// ═══════════════════════════════════════════

/** 创建过程中收集到的诊断信息（非致命问题） */
export interface AgentSessionRuntimeDiagnostic {
  /** 诊断类型 */
  type: "info" | "warning" | "error";
  /** 诊断消息 */
  message: string;
}

/**
 * 一致的、绑定到 cwd 的运行时服务。
 * 这是基础设施级别的接口，AgentSession 在此之上单独创建。
 */
export interface AgentSessionServices {
  /** 当前生效的工作目录 */
  cwd: string;
  /** agent 数据目录 */
  agentDir: string;
  /** 模型运行时：管理 provider 注册、模型解析与认证 */
  modelRuntime: ModelRuntime;
  /** 会话管理器 */
  sessionManager: SessionManager;
  /** 创建过程中收集到的诊断信息 */
  diagnostics: AgentSessionRuntimeDiagnostic[];
}

/** 创建 cwd 绑定运行时服务的输入参数 */
export interface CreateAgentSessionServicesOptions {
  /** 工作目录 */
  cwd: string;
  /** agent 数据目录（存放 auth.json、models.json 等的 .mimi 目录），不传则用默认值 */
  agentDir?: string;
  /** 模型运行时（负责 provider 注册与模型解析），不传则在 SDK 中自动创建 */
  modelRuntime?: ModelRuntime;
}

/** 从已创建 services 创建 AgentSession 的输入参数 */
export interface CreateAgentSessionFromServicesOptions {
  /** 已创建好的 services 容器 */
  services: AgentSessionServices;
  /** 会话管理器 */
  sessionManager: SessionManager;
  /** 会话使用的模型（不传则回退到默认模型） */
  model?: any;
  /** 会话的 thinking 级别 */
  thinkingLevel?: string;
}

// ═══════════════════════════════════════════
// 工厂函数
// ═══════════════════════════════════════════

/**
 * 创建 cwd 绑定的运行时服务。
 *
 * 返回 services 和诊断信息。它不会创建 AgentSession——
 * AgentSession 的创建由 SDK 层单独完成。
 */
export async function createAgentSessionServices(
  options: CreateAgentSessionServicesOptions,
): Promise<AgentSessionServices> {
  const cwd = options.cwd;
  const agentDir = options.agentDir ?? getAgentDir();
  const diagnostics: AgentSessionRuntimeDiagnostic[] = [];

  // V1: ModelRuntime 由外部注入或在 SDK 中创建
  const modelRuntime = options.modelRuntime ?? new ModelRuntime(null!);
  // SessionManager 由调用方传入（在 createAgentSessionFromServices 阶段绑定）

  return {
    cwd,
    agentDir,
    modelRuntime,
    sessionManager: null!,
    diagnostics,
  };
}

/**
 * 从已创建的 services 创建 AgentSession。
 *
 * V1 桩——实际逻辑在 sdk.ts 的 createAgentSession() 中完成。
 */
export function createAgentSessionFromServices(
  options: CreateAgentSessionFromServicesOptions,
): any {
  const { services, sessionManager, model, thinkingLevel } = options;

  // 确保 modelRuntime 已初始化
  if (!services.modelRuntime || !(services.modelRuntime as any).registry) {
    const registry = new ModelRegistry();
    registry.register(deepseekProvider());
    registry.register(openaiProvider());
    registry.register(anthropicProvider());
    (services as any).modelRuntime = new ModelRuntime(registry);
  }

  // 解析模型
  const resolvedModel = typeof model === "string"
    ? resolveModel(model, services.modelRuntime, DEFAULT_MODEL)
    : (model ?? resolveModel(undefined, services.modelRuntime, DEFAULT_MODEL));

  // 创建 Agent
  const agent = new Agent({
    initialState: {
      systemPrompt: "",
      model: resolvedModel,
      thinkingLevel: (thinkingLevel as any) ?? "medium",
      tools: [],
    },
    sessionId: sessionManager.getSessionId(),
  });

  // 创建 AgentSession
  const session = new AgentSession({
    agent,
    sessionManager,
    modelRuntime: services.modelRuntime,
    cwd: services.cwd,
  });

  return { session, modelFallbackMessage: undefined };
}
