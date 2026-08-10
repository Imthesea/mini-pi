/**
 * SDK —— 顶层创建入口 createAgentSession()。
 *
 * 从 pi 项目 core/sdk.ts 抄来（V1 最小化）。
 */

import { Agent } from "@mimi/agent";
import { anthropicProvider, openaiProvider, deepseekProvider } from "@mimi/ai";
import { getAgentDir } from "../config.js";
import { DEFAULT_THINKING_LEVEL, DEFAULT_MODEL } from "../defaults.js";
import { AgentSession } from "./agent-session.js";
import { ModelRegistry } from "./model-registry.js";
import { ModelRuntime } from "./model-runtime.js";
import { resolveModel } from "./model-resolver.js";
import { SessionManager } from "./session-manager.js";
import { AgentSessionRuntime } from "./agent-session-runtime.js";
import type { AgentSessionServices, AgentSessionRuntimeDiagnostic } from "./agent-session-services.js";

// 重导出——供上层 import
export {
  type AgentSessionRuntimeDiagnostic,
  type AgentSessionServices,
  type CreateAgentSessionFromServicesOptions,
  type CreateAgentSessionServicesOptions,
  createAgentSessionFromServices,
  createAgentSessionServices,
} from "./agent-session-services.js";

// ═══════════════════════════════════════════
// 类型
// ═══════════════════════════════════════════

/** 创建 AgentSession 的选项 */
export interface CreateAgentSessionOptions {
  /** 工作目录（默认为 process.cwd()） */
  cwd?: string;
  /** agent 数据目录（默认为 ~/.mimi/agent） */
  agentDir?: string;

  /** 标准模型/认证运行时。不传则自动创建 */
  modelRuntime?: ModelRuntime;

  /** 要使用的模型。默认为环境变量 MIMI_MODEL 或 deepseek-chat */
  model?: string;
  /** 思考级别。默认为 'medium' */
  thinkingLevel?: string;

  /** 会话管理器。不传则根据 cwd 自动创建或续接 */
  sessionManager?: SessionManager;
  /** 不持久化会话（纯内存模式） */
  noSession?: boolean;
}

/** createAgentSession 的返回结果 */
export interface CreateAgentSessionResult {
  /** 创建的会话 */
  session: AgentSession;
  /** 运行时——持有 session + services 生命周期 */
  runtime: AgentSessionRuntime;
  /** 模型回退警告（若有） */
  modelFallbackMessage?: string;
}

// ═══════════════════════════════════════════
// 实现
// ═══════════════════════════════════════════

/**
 * 创建 AgentSession 的入口函数。
 *
 * @example
 * ```typescript
 * // 最小——使用默认值
 * const { session } = await createAgentSession();
 *
 * // 指定模型
 * const { session } = await createAgentSession({ model: 'claude-sonnet-4' });
 *
 * // 续接最近会话
 * const { session } = await createAgentSession({ noSession: false });
 * ```
 */
export async function createAgentSession(
  options: CreateAgentSessionOptions = {},
): Promise<CreateAgentSessionResult> {
  const cwd = options.cwd ?? process.cwd();
  const agentDir = options.agentDir ?? getAgentDir();

  // 1. 创建模型注册表并注册所有内置 provider
  const registry = new ModelRegistry();
  const modelRuntime = options.modelRuntime ?? new ModelRuntime(registry);
  // 通过 runtime.set() 注册，确保内部 models 和 registry 同步
  modelRuntime.set(deepseekProvider());
  modelRuntime.set(openaiProvider());
  modelRuntime.set(anthropicProvider());

  // 2. 解析模型
  const model = resolveModel(options.model, modelRuntime, DEFAULT_MODEL);

  // 3. 创建 SessionManager
  const sessionDir = process.env.MIMI_SESSION_DIR;
  const sessionManager =
    options.sessionManager ??
    (options.noSession
      ? SessionManager.inMemory(cwd)
      : SessionManager.continueRecent(cwd, sessionDir));

  // 4. 获取思考级别（默认 medium）
  const thinkingLevel = options.thinkingLevel ?? DEFAULT_THINKING_LEVEL;

  // 5. 创建 Agent 实例
  const agent = new Agent({
    initialState: {
      systemPrompt: "",
      model,
      thinkingLevel: thinkingLevel as any,
      tools: [],
    },
    sessionId: sessionManager.getSessionId(),
    streamFn: async (m: any, ctx: any, opts: any) => {
      return modelRuntime.stream(m, ctx, opts);
    },
  });

  // 6. 创建 AgentSession
  const session = new AgentSession({
    agent,
    sessionManager,
    cwd,
    modelRuntime,
  });

  // 7. 组装 services + runtime
  const services: AgentSessionServices = {
    cwd,
    agentDir,
    modelRuntime,
    sessionManager,
    diagnostics: [],
  };

  const runtime = new AgentSessionRuntime(session, services, async () => ({
    session,
    services,
    diagnostics: [],
  }));

  return {
    session,
    runtime,
    modelFallbackMessage: undefined,
  };
}
