/**
 * 压缩默认设置 + shouldCompact 工具函数。
 *
 * 文件定位:
 * - `DEFAULT_COMPACTION_SETTINGS` 默认值(被 `compact()` 使用)
 * - `shouldCompact(...)` 自动压缩判断函数(本包不接触发器,但保留供上层使用)
 *
 * 拆分理由(plan § 4.5 决策):
 * - 原计划拆 `should-compact.ts` 单独文件,但本包内不调用 `shouldCompact`
 *   (spec 8.1 明确"仅手动触发"),既然不调用,单独 80 行文件没意义
 * - 与 DEFAULT_COMPACTION_SETTINGS 合并:本包对外只需要"设置 + 工具函数",
 *   合在一个文件读者可以一次性看到全部配置
 */

import type { SessionContext } from "../session/types.js";
import type { CompactionSettings } from "./types.js";

// ── 默认设置 ──

/**
 * 默认压缩 settings。
 *
 * 字段:
 * - `enabled = true`:虽然本包不自动调,默认开是历史沿用(为上层保留启用标志)
 * - `keepRecentTokens = 20000`:压缩后保留最近 20K tokens
 * - `compactionPrompt = "You are a helpful AI assistant tasked with summarizing conversations..."`:
 *   默认调 LLM 时的 system prompt
 */
export const DEFAULT_COMPACTION_SETTINGS: Required<
  Pick<CompactionSettings, "enabled" | "keepRecentTokens">
> &
  CompactionSettings = {
  enabled: true,
  keepRecentTokens: 20000,
  compactionPrompt: [
    "You are a helpful AI assistant tasked with summarizing conversations.",
    "Your goal is to create a concise summary of the conversation that captures",
    "all important information, including what the user asked, what actions were",
    "taken, what files were read or modified, and what the current state is.",
    "The summary should be structured and useful for continuing the conversation",
    "after the original context has been compressed.",
  ].join(" "),
};

// ── 自动压缩判断 ──

/**
 * 判断当前 session 是否应该自动压缩(基于 token 估算)。
 *
 * 决策规则(简化版,不对外严格契约):
 * - `enabled = false` → 不压缩
 * - 估算 token > 上下文窗口的 80% → 压缩
 * - 否则 → 不压缩
 *
 * **本包内不调用**。仅供上层(coding-agent / 未来扩展)使用。
 * `AgentHarness.compact()` 走手动触发,不经过本函数。
 *
 * @param sessionContext  通过 `session.buildContext()` 得到的 session context
 * @param settings        压缩 settings(默认用 DEFAULT_COMPACTION_SETTINGS)
 * @returns 是否应该自动压缩
 */
export function shouldCompact(
  sessionContext: SessionContext,
  settings: CompactionSettings = {},
): boolean {
  const merged = { ...DEFAULT_COMPACTION_SETTINGS, ...settings };
  if (merged.enabled === false) return false;

  // 估算:本函数不依赖 estimateTokens(避免循环),内联简单估算
  // 规则:总 chars / 4(单条 message 的角色 + content 总长度)
  let totalChars = 0;
  for (const msg of sessionContext.messages) {
    if (msg.role === "user" && typeof msg.content === "string") {
      totalChars += msg.content.length;
    } else if (msg.role === "user" && Array.isArray(msg.content)) {
      for (const c of msg.content) {
        if (c.type === "text") totalChars += c.text.length;
      }
    } else if (msg.role === "assistant") {
      for (const c of msg.content) {
        if (c.type === "text") totalChars += c.text.length;
        else if (c.type === "thinking") totalChars += c.thinking.length;
        else if (c.type === "toolCall") {
          totalChars += JSON.stringify(c.arguments).length;
        }
      }
    } else if (msg.role === "toolResult") {
      for (const c of msg.content) {
        if (c.type === "text") totalChars += c.text.length;
      }
    }
    // role === "custom" 不在本函数估算范围(自定义消息由调用方决定)
  }
  const estimatedTokens = Math.ceil(totalChars / 4);

  // 阈值:80% of 上下文窗口(简化为 128K,实际应由 model.contextWindow 决定)
  // 简化:固定 100K tokens 阈值
  const threshold = 100_000;
  return estimatedTokens > threshold;
}
