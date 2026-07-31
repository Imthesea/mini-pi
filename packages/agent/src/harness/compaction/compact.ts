/**
 * 压缩(compact)主入口。
 *
 * 职责:
 * 1. 走 `session_before_compact` 钩子(handler 可 cancel / 注入已有 compaction)
 * 2. 调 `prepareCompaction` 选保留边界
 * 3. 调 LLM 生成 summary
 * 4. 写 CompactionEntry 到 session
 * 5. 走 `session_compact` 钩子(完成通知)
 *
 * 设计要点:
 * - 主入口在 harness 层(`harness.compact()`),本文件是底层实现
 * - **不**直接写 session:由 `harness.compact()` 调本函数拿到 result,然后调
 *   `session.appendCompaction(...)` 落盘
 * - 钩子协调在 harness 层,本函数接收钩子发出的"preparation"作为输入
 *
 * file-ops(extractFileOpsFromMessage)已在 prepare.ts 内联,本文件不重复实现。
 *
 * 拆分理由(plan § 4.5):
 * - 独立 300 行:作为"主入口",自带钩子协调的逻辑
 * - 与 branch-summarization 平级但独立(两种"摘要"语义不同)
 */

import type { Model } from "@mimi/ai";
import type { AgentMessage } from "../../types.js";
import type { Session } from "../session/session.js";
import { DEFAULT_COMPACTION_SETTINGS } from "./settings.js";
import { prepareCompaction } from "./prepare.js";
import type {
  CompactOptions,
  CompactionResult,
  CompactionSettings,
} from "./types.js";

// ── 公共 API ──

/**
 * 执行压缩:生成 summary + 派生 CompactionResult(不写 session)。
 *
 * 流程(对应 plan § 4.5):
 * 1. 读 session 当前 entries(从 leaf 沿 parentId 回溯)
 * 2. 调 `prepareCompaction` 选保留边界
 * 3. 调 LLM 生成 summary(用 streamFn)
 * 4. 返回 CompactionResult(由 harness 写 session)
 *
 * **不**写 session(由 harness 层负责 appendCompaction)。
 * **不**触发钩子(由 harness 层负责 emit session_before_compact / session_compact)。
 *
 * @param session   当前 session
 * @param model     LLM model
 * @param streamFn  stream 函数(同 AgentLoopConfig.streamFn)
 * @param options   压缩选项
 * @returns          CompactionResult
 */
export async function compact(
  session: Session<any>,
  model: Model<any>,
  streamFn: (
    model: Model<any>,
    context: { systemPrompt?: string; messages: AgentMessage[] },
    options?: { signal?: AbortSignal; apiKey?: string },
  ) => { result: () => Promise<{ content: import("@mimi/ai").AssistantMessage["content"] }> },
  options: CompactOptions = {},
): Promise<CompactionResult> {
  const settings: CompactionSettings = {
    ...DEFAULT_COMPACTION_SETTINGS,
    ...(options.settings ?? {}),
  };
  const useModel = options.model ?? model;
  const customInstructions = options.customInstructions;

  // 1. 读 entries(从 leaf → root)
  const entries = await session.getBranch();

  // 2. 准备:选保留边界
  const preparation = prepareCompaction(entries, settings);

  // 3. 调 LLM 生成 summary
  const systemPrompt =
    customInstructions ?? settings.compactionPrompt ?? DEFAULT_COMPACTION_SETTINGS.compactionPrompt!;
  const userMessage: AgentMessage = {
    role: "user",
    content: buildCompactSummaryPrompt(preparation.messagesToSummarize, {
      readFiles: preparation.readFiles,
      modifiedFiles: preparation.modifiedFiles,
    }),
    timestamp: Date.now(),
  };
  const context = { systemPrompt, messages: [userMessage] };

  const stream = streamFn(useModel, context);
  const result = await stream.result();
  let summary = "";
  for (const c of result.content) {
    if (c.type === "text") {
      summary += c.text;
    }
  }
  summary = summary.trim();

  // 4. 构造 CompactionResult(由 harness 负责写 session)
  return {
    summary,
    firstKeptEntryId: preparation.firstKeptEntryId,
    tokensBefore: preparation.tokensBefore,
    details: {
      readFiles: preparation.readFiles,
      modifiedFiles: preparation.modifiedFiles,
      customInstructions,
    },
  };
}

// ── prompt 构造(内联) ──

/**
 * 构造送进 LLM 的 user prompt:把要压缩的 messages + file ops 拼成文本。
 */
function buildCompactSummaryPrompt(
  messages: readonly AgentMessage[],
  fileOps: { readFiles: string[]; modifiedFiles: string[] },
): string {
  const lines: string[] = [
    "Please summarize the following conversation, capturing all important information:",
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
          lines.push(
            `[assistant-toolcall]: ${c.name}(${JSON.stringify(c.arguments)})`,
          );
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
  if (fileOps.readFiles.length > 0) {
    lines.push("");
    lines.push("Files read during this conversation:");
    for (const f of fileOps.readFiles) lines.push(`- ${f}`);
  }
  if (fileOps.modifiedFiles.length > 0) {
    lines.push("");
    lines.push("Files modified during this conversation:");
    for (const f of fileOps.modifiedFiles) lines.push(`- ${f}`);
  }
  lines.push("");
  lines.push(
    "Output a structured summary that can be used to continue the conversation after compression.",
  );
  return lines.join("\n");
}
