/**
 * 压缩模块公共 API 入口。
 *
 * 用户从 `@mimi/agent` 顶层 import 时,看到的是从 harness/index.ts 透出的符号。
 * 本文件仅作为模块内部 re-export,集中管理"对外暴露哪些名字"。
 *
 * 暴露的内容:
 * - 主入口:compact() + generateBranchSummary()
 * - 工具:estimateTokens() + prepareCompaction() + extractFileOpsFromMessage()
 * - 设置:DEFAULT_COMPACTION_SETTINGS + shouldCompact()
 * - 收集:collectEntriesForBranchSummary()
 * - 类型:所有 compaction/types.ts 导出的类型
 */

// 主入口
export { compact } from "./compact.js";
export {
  generateBranchSummary,
  collectEntriesForBranchSummary,
} from "./branch-summarization.js";

// 工具
export { estimateTokens } from "./estimate.js";
export { prepareCompaction, extractFileOpsFromMessage } from "./prepare.js";

// 设置
export { DEFAULT_COMPACTION_SETTINGS, shouldCompact } from "./settings.js";

// 类型
export type {
  CompactionSettings,
  CompactOptions,
  CompactionPreparation,
  CompactionResult,
  CompactionDetails,
  BranchSummaryOptions,
  BranchSummaryResult,
  BranchSummaryDetails,
  TokenEstimationInput,
  KeptEntries,
} from "./types.js";
