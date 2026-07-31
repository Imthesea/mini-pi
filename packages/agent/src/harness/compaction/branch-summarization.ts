/**
 * 分支摘要(branch summarization)。
 *
 * 职责:
 * - `collectEntriesForBranchSummary`:从 root 到 targetId 路径上"被丢弃"的 entries
 *   (即 targetId 之外的分支部分)
 * - `generateBranchSummary`:调 LLM 生成 branch summary
 *
 * 触发:手动 `harness.navigateTree({ targetId })`。
 * 与 compact 的区别:
 * - compact:全量压缩(整个 session)
 * - branch summary:从某个 entry 切回"另一个分支"时,生成"被丢弃"部分的 summary
 *
 * 拆分理由(plan § 4.5):
 * - 独立文件:branch summary 是与 compact 平级的不同语义,合在 compact.ts 会让单文件
 *   包含两种"摘要"模式,职责不清晰
 * - 250 行预估,远低于 500 软上限
 *
 * 不做的事:
 * - 不写 session(`session.moveTo` 由 agent-harness 调)
 * - 不动 leaf(`setLeafId` 由 agent-harness 调)
 * - 只生成 summary 文本,让上层负责落盘
 */

import type { Model } from "@mimi/ai";
import type { AgentMessage } from "../../types.js";
import type { SessionTreeEntry } from "../session/types.js";
import { estimateTokens } from "./estimate.js";
import { DEFAULT_COMPACTION_SETTINGS } from "./settings.js";
import type { BranchSummaryResult } from "./types.js";

// ── 收集被丢弃的 entries ──

/**
 * 收集"从 root 到 targetId 路径上"被 targetId 替代的 entry(不包含 targetId)。
 *
 * 用途:分支跳转时,生成"被丢弃"部分的 summary。
 *
 * 算法:
 * - entries 是从 leaf → root 的链(root 在末尾,targetId 可能是中间某条)
 * - 找 targetId 在 entries 中的位置
 * - 收集该位置之前(即更靠近 leaf 那侧、被切掉的分支)的 entries
 *
 * 边界:
 * - targetId 不在 entries 中 → 返回空数组(防御)
 * - targetId 是最后一条(path 终点) → 返回空数组:切回 path 终点意味着
 *   "没有另一条分支被切掉",不需要 summary
 *
 * @param entries   从 leaf → root 的 entry 链
 * @param targetId  跳转目标 entry id
 * @returns          不含 targetId 的"被丢弃"entries
 */
export function collectEntriesForBranchSummary(
  entries: readonly SessionTreeEntry[],
  targetId: string,
): SessionTreeEntry[] {
  // 找 targetId 在 entries 中的 index
  // entries[0] = leaf, entries[length-1] = root
  const targetIndex = entries.findIndex((e) => e.id === targetId);
  if (targetIndex === -1) {
    // 防御:targetId 不在 entries 中,返回空(不抛错,与 pi 行为一致)
    return [];
  }
  // targetId 是 path 终点(最靠近 root 那条),没有"另一条分支"可总结
  if (targetIndex === entries.length - 1) {
    return [];
  }
  // targetIndex 之前(更靠近 leaf 那侧)的 entries 是被切掉的另一条分支
  // 不包含 targetIndex 本身(target 是保留的目标)
  return entries.slice(0, targetIndex);
}

// ── 生成 branch summary ──

/**
 * 调 LLM 生成 branch summary。
 *
 * 流程:
 * 1. 调 `collectEntriesForBranchSummary` 拿到被丢弃的 entries
 * 2. 投影为 messages(过滤非 message entry)
 * 3. 用 `model.stream` 调 LLM 拿 summary
 * 4. 返回 { summary, details? }
 *
 * @param entries          从 leaf → root 的 entry 链
 * @param targetId         跳转目标
 * @param model            LLM model
 * @param streamFn         stream 函数(models.stream 或 mock)
 * @param options          自定义 system prompt
 * @returns                 branch summary 结果
 */
export async function generateBranchSummary(
  entries: readonly SessionTreeEntry[],
  targetId: string,
  model: Model<any>,
  streamFn: (
    model: Model<any>,
    context: { systemPrompt?: string; messages: AgentMessage[] },
    options?: { signal?: AbortSignal; apiKey?: string },
  ) => { result: () => Promise<{ content: import("@mimi/ai").AssistantMessage["content"] }> },
  options: {
    customInstructions?: string;
    signal?: AbortSignal;
    apiKey?: string;
  } = {},
): Promise<BranchSummaryResult> {
  const discarded = collectEntriesForBranchSummary(entries, targetId);

  // 投影为 messages(只保留 message entry)
  const messagesToSummarize: AgentMessage[] = [];
  for (const entry of discarded) {
    if (entry.type === "message") {
      messagesToSummarize.push(entry.message);
    }
  }

  // 构造 LLM context
  const systemPrompt =
    options.customInstructions ??
    "You are a helpful AI assistant. Summarize the conversation branch that was navigated away from. " +
      "Capture the user's intent, the actions taken, and the current state, " +
      "so the conversation can be resumed from the target entry with full context.";

  const userMessage: AgentMessage = {
    role: "user",
    content: buildBranchSummaryPrompt(messagesToSummarize),
    timestamp: Date.now(),
  };

  const context = {
    systemPrompt,
    messages: [userMessage],
  };

  // 调 LLM
  const stream = streamFn(model, context, {
    signal: options.signal,
    apiKey: options.apiKey,
  });

  const result = await stream.result();
  // 从 AssistantMessage.content 提取 summary 文本
  let summary = "";
  for (const c of result.content) {
    if (c.type === "text") {
      summary += c.text;
    }
  }
  summary = summary.trim();

  return {
    summary,
    details: {
      customInstructions: options.customInstructions,
    },
  };
}

// ── prompt 构造(内联) ──

/**
 * 构造送进 LLM 的 user prompt。
 *
 * 简单实现:把 messages 序列化为文本,要求 LLM 总结。
 */
function buildBranchSummaryPrompt(messages: readonly AgentMessage[]): string {
  const lines: string[] = [
    "Please summarize the following conversation branch that was navigated away from:",
    "",
  ];
  for (const m of messages) {
    if (m.role === "user") {
      if (typeof m.content === "string") {
        lines.push(`[user]: ${m.content}`);
      } else {
        const text = m.content
          .filter((c) => c.type === "text")
          .map((c) => (c as { type: "text"; text: string }).text)
          .join("");
        lines.push(`[user]: ${text}`);
      }
    } else if (m.role === "assistant") {
      for (const c of m.content) {
        if (c.type === "text") {
          lines.push(`[assistant]: ${c.text}`);
        } else if (c.type === "thinking") {
          lines.push(`[assistant-thinking]: ${c.thinking}`);
        } else if (c.type === "toolCall") {
          lines.push(`[assistant-toolcall]: ${c.name}(${JSON.stringify(c.arguments)})`);
        }
      }
    } else if (m.role === "toolResult") {
      const text = m.content
        .filter((c) => c.type === "text")
        .map((c) => (c as { type: "text"; text: string }).text)
        .join("");
      lines.push(`[toolResult ${m.toolName}]: ${text}`);
    }
  }
  lines.push("");
  lines.push(
    "Output a concise summary that captures the key points, actions taken, and current state.",
  );
  return lines.join("\n");
}
