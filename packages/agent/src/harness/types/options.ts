/**
 * AgentHarness 构造选项 + 辅助类型。
 *
 * 这里只放"选项形态"的类型定义,
 * Skill / PromptTemplate / HookEvent 等公用类型见 harness.ts。
 */

import type { Model } from "@mimi/ai";
import type { AgentTool, ThinkingLevel } from "../../types.js";
import type { PromptTemplate, Skill } from "./harness.js";

// 重新导出 Tool 类型,供需要的地方使用(避免上层再 import @mimi/ai)
export type { Tool } from "@mimi/ai";

// ── 流选项 ──

/**
 * 单次 LLM 调用的流选项(透传给 AI 层 StreamOptions)。
 *
 * 大部分字段与 @mimi/ai 的 StreamOptions 相同,
 * 这里包装为 harness 层语义,方便将来扩展。
 */
export interface AgentHarnessStreamOptions {
  /** 采样温度(0-2) */
  temperature?: number;
  /** 最大输出 token */
  maxTokens?: number;
  /** API key 覆盖(短生命周期 token) */
  apiKey?: string;
  /** 自定义请求头 */
  headers?: Record<string, string>;
  /** 请求级元数据(透传给 provider) */
  metadata?: Record<string, unknown>;
}

// ── System prompt 上下文 ──

/**
 * 构造 system prompt 时注入的上下文。
 *
 * 当用户传 `systemPrompt: (ctx) => string` 时,harness 在每次 turn
 * 调用该函数并把 ctx 传入,让动态 system prompt 能拿到最新状态。
 */
export interface SystemPromptContext {
  /** 当前 model(可能因 setModel 改变) */
  model: Model<any>;
  /** 当前工具集合 */
  tools: AgentTool<any>[];
  /** 当前 session id(便于把 session 信息注入 system prompt) */
  sessionId: string;
  /** 当前 resources(可选,供 skill 注入使用) */
  resources?: AgentHarnessResources;
}

// ── Resources ──

/**
 * Harness 的"扩展资源":skills + prompt templates。
 *
 * 通过 setResources() 注入,影响 system prompt 拼装。
 */
export interface AgentHarnessResources<
  TSkill extends Skill = Skill,
  TPromptTemplate extends PromptTemplate = PromptTemplate,
> {
  /** skill 集合 */
  skills?: TSkill[];
  /** prompt template 集合 */
  promptTemplates?: TPromptTemplate[];
}

/** QueueMode 透传类型,值定义见 src/types.ts */
export type { QueueMode } from "../../types.js";

// ── StreamFn(从 agent-loop 透传) ──

/** agent-loop 用的 stream 函数类型(与 AgentLoopConfig.streamFn 同形) */
export type HarnessStreamFn = (
  model: any,
  context: any,
  options?: { signal?: AbortSignal; apiKey?: string },
) => any;

// ── AgentHarnessOptions ──

/**
 * 构造 AgentHarness 的完整选项。
 *
 * 必填:model / tools / env / session
 * 可选:thinkingLevel / systemPrompt / streamOptions / hooks / resources /
 *      steeringMode / followUpMode / compaction
 *
 * env / session / hooks / compaction 都是接口,具体实现在
 * 后续 Task 注入(Task 5 session + env,Task 4 hooks,Task 6 compaction)。
 */
export interface AgentHarnessOptions<
  TSkill extends Skill = Skill,
  TPromptTemplate extends PromptTemplate = PromptTemplate,
> {
  /** 当前 LLM model */
  model: Model<any>;

  /** 工具集合(必须是 AgentTool,有 execute 方法才能被 agent-loop 调用) */
  tools: AgentTool<any>[];

  /** 执行环境(必填,本项目只实现 NodeExecutionEnv) */
  env: any;

  /** 已打开的 session,或空 session */
  session: any;

  /** Thinking level */
  thinkingLevel?: ThinkingLevel;

  /**
   * 静态 system prompt,或动态 system-prompt provider 回调。
   * 静态:直接使用;动态:每次 turn 调一次,接收 SystemPromptContext。
   */
  systemPrompt?: string | ((ctx: SystemPromptContext) => string | Promise<string>);

  /** 流选项 */
  streamOptions?: AgentHarnessStreamOptions;

  /** 钩子实例(可选,默认 DefaultAgentHarnessHooks) */
  hooks?: any;

  /** 可用资源(skills、prompt templates) */
  resources?: AgentHarnessResources<TSkill, TPromptTemplate>;

  /** 压缩设置(可选) */
  compaction?: any;

  /** steer 队列排空模式 */
  steeringMode?: "all" | "one-at-a-time";

  /** follow-up 队列排空模式 */
  followUpMode?: "all" | "one-at-a-time";

  /**
   * Stream 函数(透传给 agent-loop)。
   *
   * 大多数场景下使用 AI 层的 `models.stream`,通过 env 注入。
   * Task 3 阶段:为方便测试,允许直接传 streamFn。
   * 后续 Task 可考虑用 env 注入并自动适配。
   */
  streamFn?: HarnessStreamFn;
}
