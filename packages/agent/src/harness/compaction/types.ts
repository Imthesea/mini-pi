/**
 * 压缩 + 分支摘要的类型定义。
 *
 * 文件定位:
 * - 跨模块共享的"协议"层类型(本包内)
 * - 不放运行时逻辑,只放类型 + 枚举常量
 * - 与 plan § 4.5 一致:types.ts 仅声明形状,实现拆到 settings / estimate / prepare / compact / branch-summarization
 *
 * 设计原则:
 * - 字段命名对齐 SessionTreeEntry 的 CompactionEntry / BranchSummaryEntry,
 *   保证 details 字段可以互通
 * - 集中放 settings / result 类型,避免散落
 * - 不在本文件实现"实际压缩逻辑"(只放类型)
 */

import type { Model } from "@mimi/ai";
import type { AgentMessage } from "../../types.js";
import type { SessionTreeEntry } from "../session/types.js";

// ── 压缩设置 ──

/**
 * 压缩触发条件(仅手动触发,本包内不接触发器)。
 *
 * 字段语义:
 * - `enabled`:是否启用压缩(默认 true,虽然本包不自动调)
 * - `keepRecentTokens`:压缩后保留的"最近 token 数"(默认 20000)
 * - `compactionPrompt`:调 LLM 生成 summary 时的 system prompt
 *
 * 触发时机:由 `harness.compact()` 手动调用,不走 `shouldCompact` 自动判断。
 */
export interface CompactionSettings {
  /** 是否启用压缩(默认 true) */
  enabled?: boolean;
  /** 压缩后保留最近多少 token(默认 20000) */
  keepRecentTokens?: number;
  /** 调 LLM 生成 summary 时的 system prompt(可选,使用默认) */
  compactionPrompt?: string;
}

/**
 * 压缩的输入参数(传给 `compact()` 的可选项)。
 *
 * 与 CompactionSettings 的关系:
 * - `compactionPrompt` 等运行时可覆盖的字段
 * - 不传则走 DEFAULT_COMPACTION_SETTINGS
 */
export interface CompactOptions {
  /** 压缩 settings 覆盖 */
  settings?: CompactionSettings;
  /** 强制使用某个 model(默认用 harness 当前的 model) */
  model?: Model<any>;
  /** 自定义 system prompt(覆盖 settings.compactionPrompt) */
  customInstructions?: string;
}

// ── 压缩准备结果 ──

/**
 * `prepareCompaction` 的返回:压缩前的"准备信息"。
 *
 * 包含:
 * - 要保留的 entry id 列表(`firstKeptEntryId` 之后的所有 entry)
 * - 估算的 token 数(`tokensBefore` = 全部 messages 的 token 估算)
 * - 实际要送进 LLM 的 messages(从 root 到 firstKeptEntryId 之前的)
 */
export interface CompactionPreparation {
  /** 保留边界的 entry id(更新于 entries 链中) */
  firstKeptEntryId: string;
  /** 压缩前的 token 估算(基于 chars/4 启发式) */
  tokensBefore: number;
  /** 要送进 LLM 生成 summary 的 messages(从 root 到 firstKeptEntryId 之前) */
  messagesToSummarize: AgentMessage[];
  /** 累计读取的文件路径(从 messages 中提取) */
  readFiles: string[];
  /** 累计修改的文件路径(从 messages 中提取) */
  modifiedFiles: string[];
}

// ── 压缩结果 ──

/**
 * `compact()` 的最终结果(在 session 写入 CompactionEntry 之后)。
 *
 * 包含:
 * - summary 文案
 * - firstKeptEntryId(写入 CompactionEntry 时使用)
 * - tokensBefore(写入 CompactionEntry 时使用)
 * - details(可选,通常包含 readFiles / modifiedFiles)
 */
export interface CompactionResult {
  /** LLM 生成的摘要文本 */
  summary: string;
  /** 保留边界的 entry id */
  firstKeptEntryId: string;
  /** 压缩前的 token 数 */
  tokensBefore: number;
  /** 详细信息(可选) */
  details?: CompactionDetails;
  /** 是否由 hook 注入(skip LLM call) */
  fromHook?: boolean;
}

/**
 * CompactionResult.details 的结构。
 *
 * 包含:
 * - readFiles / modifiedFiles:从 messages 中提取的文件操作集合
 * - customInstructions:可由 hook 注入的"额外指令"
 */
export interface CompactionDetails {
  /** 压缩前读取的文件路径集合 */
  readFiles?: string[];
  /** 压缩前修改的文件路径集合 */
  modifiedFiles?: string[];
  /** 自定义指令(由 hook 注入) */
  customInstructions?: string;
}

// ── 分支摘要 ──

/**
 * 分支摘要的输入参数(传给 `navigateTree()` 或 `generateBranchSummary()` 的可选项)。
 */
export interface BranchSummaryOptions {
  /** 自定义 system prompt(覆盖默认) */
  customInstructions?: string;
  /** 强制使用某个 model(默认用 harness 当前的 model) */
  model?: Model<any>;
  /** 摘要的 label(可选,会写到 BranchSummaryEntry.details) */
  label?: string;
}

/**
 * `generateBranchSummary` 的结果。
 */
export interface BranchSummaryResult {
  /** LLM 生成的分支摘要文本 */
  summary: string;
  /** 详细信息(可选) */
  details?: BranchSummaryDetails;
}

/**
 * BranchSummaryResult.details 的结构。
 */
export interface BranchSummaryDetails {
  /** 自定义指令(由 hook 注入) */
  customInstructions?: string;
  /** label(由 hook 注入) */
  label?: string;
}

// ── 工具类型 ──

/** estimateTokens 的入参:可对单条 message 或整个 messages 数组估算 */
export type TokenEstimationInput = AgentMessage | readonly AgentMessage[];

/** 压缩后保留的 entries(从 firstKeptEntryId 开始,链式到 leaf) */
export type KeptEntries = SessionTreeEntry[];
