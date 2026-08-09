/**
 * Compaction 模块导出。
 * 从 pi 项目 core/compaction/index.ts 抄来（V1 最小化）。
 */

export {
  compact,
  prepareCompaction,
  generateSummary,
  estimateTokens,
  estimateContextTokens,
  calculateContextTokens,
  findCutPoint,
  findTurnStartIndex,
  getLastAssistantUsage,
  shouldCompact,
  DEFAULT_COMPACTION_SETTINGS,
  type CompactionResult,
  type CompactionSettings,
  type CompactionPreparation,
  type CutPointResult,
  type ContextUsageEstimate,
} from "./compaction.js";
