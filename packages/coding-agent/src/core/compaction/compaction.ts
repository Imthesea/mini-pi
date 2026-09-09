/**
 * 长会话的上下文压缩。
 *
 * 压缩逻辑的纯函数。会话管理器负责 I/O，
 * 压缩完成后会重新加载会话。
 *
 * 从 pi 项目 core/compaction/compaction.ts 抄来（V1 最小化）。
 * 🔴 删除：CompactionDetails / extractFileOperations —— 文件追踪，后续实现。
 */

import type { AgentMessage, ThinkingLevel } from "@mimi/agent";
import { contentText } from "@mimi/ai";
import type { AssistantMessage, Context, Model, Usage } from "@mimi/ai";
import { convertToLlm } from "../messages.js";
import {
  buildSessionContext,
  type CompactionEntry,
  type SessionEntry,
  sessionEntryToContextMessages,
} from "../session-manager.js";
import { serializeConversation, SUMMARIZATION_SYSTEM_PROMPT } from "./utils.js";

// ============================================================================
// 消息提取
// ============================================================================

/**
 * 从条目中提取 AgentMessage（若该条目能产生消息）。
 * 对不贡献 LLM 上下文的条目返回 undefined。
 */
function getMessageFromEntryForCompaction(entry: SessionEntry): AgentMessage | undefined {
  if (entry.type === "compaction") {
    return undefined;
  }
  return sessionEntryToContextMessages(entry)[0];
}

/** compact() 的返回结果 —— SessionManager 保存时会补充 uuid/parentUuid */
export interface CompactionResult<T = unknown> {
  /** 压缩生成的摘要文本 */
  summary: string;
  /** 压缩后第一个被保留条目的 id */
  firstKeptEntryId: string;
  /** 压缩前的上下文 token 数 */
  tokensBefore: number;
  /** 压缩后估算的上下文 token 数（可选） */
  estimatedTokensAfter?: number;
  /** 扩展专属数据 */
  details?: T;
}

// ============================================================================
// 类型定义
// ============================================================================

export interface CompactionSettings {
  enabled: boolean;
  reserveTokens: number;
  keepRecentTokens: number;
}

export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
  enabled: true,
  reserveTokens: 16384,
  keepRecentTokens: 20000,
};

// ============================================================================
// Token 计算
// ============================================================================

/**
 * 根据 usage 计算上下文 token 总数。
 */
export function calculateContextTokens(usage: Usage): number {
  return usage.totalTokens || usage.input + usage.output + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
}

/**
 * 从 assistant 消息中获取 usage（若存在）。
 */
function getAssistantUsage(msg: AgentMessage): Usage | undefined {
  if (msg.role === "assistant" && "usage" in msg) {
    const assistantMsg = msg as AssistantMessage;
    if (
      assistantMsg.stopReason !== "aborted" &&
      assistantMsg.stopReason !== "error" &&
      assistantMsg.usage &&
      calculateContextTokens(assistantMsg.usage) > 0
    ) {
      return assistantMsg.usage;
    }
  }
  return undefined;
}

/**
 * 从会话条目中查找最后一条有效的 assistant 消息 usage。
 */
export function getLastAssistantUsage(entries: SessionEntry[]): Usage | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type === "message") {
      const usage = getAssistantUsage(entry.message);
      if (usage) return usage;
    }
  }
  return undefined;
}

export interface ContextUsageEstimate {
  tokens: number;
  usageTokens: number;
  trailingTokens: number;
  lastUsageIndex: number | null;
}

function getLastAssistantUsageInfo(messages: AgentMessage[]): { usage: Usage; index: number } | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const usage = getAssistantUsage(messages[i]);
    if (usage) return { usage, index: i };
  }
  return undefined;
}

/**
 * 根据消息估算上下文 token，优先使用最后一条 assistant usage。
 */
export function estimateContextTokens(messages: AgentMessage[]): ContextUsageEstimate {
  const usageInfo = getLastAssistantUsageInfo(messages);

  if (!usageInfo) {
    let estimated = 0;
    for (const message of messages) {
      estimated += estimateTokens(message);
    }
    return {
      tokens: estimated,
      usageTokens: 0,
      trailingTokens: estimated,
      lastUsageIndex: null,
    };
  }

  const usageTokens = calculateContextTokens(usageInfo.usage);
  let trailingTokens = 0;
  for (let i = usageInfo.index + 1; i < messages.length; i++) {
    trailingTokens += estimateTokens(messages[i]);
  }

  return {
    tokens: usageTokens + trailingTokens,
    usageTokens,
    trailingTokens,
    lastUsageIndex: usageInfo.index,
  };
}

/**
 * 根据上下文占用情况判断是否应触发压缩。
 */
export function shouldCompact(contextTokens: number, contextWindow: number, settings: CompactionSettings): boolean {
  if (!settings.enabled) return false;
  return contextTokens > contextWindow - settings.reserveTokens;
}

// ============================================================================
// 切割点检测
// ============================================================================

const ESTIMATED_IMAGE_CHARS = 4800;

/**
 * 估算文本或图片内容的字符数。
 * 纯字符串按长度计；数组内容按块累加：文本块计长度，图片块按固定估算值（ESTIMATED_IMAGE_CHARS）计。
 */
function estimateTextAndImageContentChars(content: string | Array<{ type: string; text?: string }>): number {
  if (typeof content === "string") {
    return content.length;
  }
  let chars = 0;
  for (const block of content) {
    if (block.type === "text" && (block as any).text) {
      chars += (block as any).text.length;
    } else if (block.type === "image") {
      chars += ESTIMATED_IMAGE_CHARS;
    }
  }
  return chars;
}

/**
 * 使用「字符数 / 4」的启发式估算单条消息的 token 数量。
 */
export function estimateTokens(message: AgentMessage): number {
  let chars = 0;

  switch (message.role) {
    case "user": {
      chars = estimateTextAndImageContentChars(
        (message as { content: string | Array<{ type: string; text?: string }> }).content,
      );
      return Math.ceil(chars / 4);
    }
    case "assistant": {
      const assistant = message as unknown as AssistantMessage;
      for (const block of assistant.content) {
        if (block.type === "text") {
          chars += block.text.length;
        } else if ((block as any).type === "thinking") {
          chars += (block as any).thinking.length;
        } else if (block.type === "toolCall") {
          chars += block.name.length + JSON.stringify(block.arguments).length;
        }
      }
      return Math.ceil(chars / 4);
    }
    case "toolResult": {
      chars = estimateTextAndImageContentChars(message.content);
      return Math.ceil(chars / 4);
    }
    // 🔴 Pi: "bashExecution" / "custom" / "branchSummary" / "compactionSummary" —— V1 暂不产生这些消息类型
  }

  return 0;
}

/**
 * 判断某条消息是否可作为切割点：user 或 assistant 消息可以，toolResult 不行。
 */
function isCutPointMessage(message: AgentMessage): boolean {
  switch (message.role) {
    case "user":
    case "assistant":
      return true;
    case "toolResult":
      return false;
  }
  return false;
}

/**
 * 判断某条消息是否为轮次起始消息：只有 user 消息是，assistant / toolResult 不是。
 */
function isTurnStartMessage(message: AgentMessage): boolean {
  switch (message.role) {
    case "user":
      return true;
    case "assistant":
    case "toolResult":
      return false;
  }
  return false;
}

/**
 * 判断某个会话条目是否为轮次起始条目：compaction 条目不是，
 * 其余看该条目对应的上下文消息里是否存在轮次起始消息。
 */
function isTurnStartEntry(entry: SessionEntry): boolean {
  if (entry.type === "compaction") return false;
  return sessionEntryToContextMessages(entry).some(isTurnStartMessage);
}

/**
 * 查找有效的切割点：上下文可见的 user 或 assistant 消息的索引。
 */
function findValidCutPoints(entries: SessionEntry[], startIndex: number, endIndex: number): number[] {
  const cutPoints: number[] = [];
  for (let i = startIndex; i < endIndex; i++) {
    const entry = entries[i];
    if (entry.type === "compaction") continue;
    if (sessionEntryToContextMessages(entry).some(isCutPointMessage)) {
      cutPoints.push(i);
    }
  }
  return cutPoints;
}

/**
 * 从 entryIndex 往前（下限为 startIndex）找离它最近的轮次起点，返回该条目的索引。
 *
 * 一个「轮次」以 user 消息开头。传入某个条目的位置，本函数向前倒着找，
 * 找到的第一个 user 消息就是它所属轮次的起点。
 *
 * 找不到（前面没有 user 消息）时返回 -1。
 */
export function findTurnStartIndex(entries: SessionEntry[], entryIndex: number, startIndex: number): number {
  for (let i = entryIndex; i >= startIndex; i--) {
    if (isTurnStartEntry(entries[i])) return i;
  }
  return -1;
}

export interface CutPointResult {
  firstKeptEntryIndex: number;
  turnStartIndex: number;
  isSplitTurn: boolean;
}

/**
 * 在会话条目中找到切割点，使其大约保留 `keepRecentTokens` 的 token。
 */
export function findCutPoint(
  entries: SessionEntry[],
  startIndex: number,
  endIndex: number,
  keepRecentTokens: number,
): CutPointResult {
  const cutPoints = findValidCutPoints(entries, startIndex, endIndex);

  if (cutPoints.length === 0) {
    return { firstKeptEntryIndex: startIndex, turnStartIndex: -1, isSplitTurn: false };
  }

  let accumulatedTokens = 0;
  let cutIndex = cutPoints[0];

  for (let i = endIndex - 1; i >= startIndex; i--) {
    const entry = entries[i];
    const messageTokens = sessionEntryToContextMessages(entry).reduce(
      (sum, message) => sum + estimateTokens(message),
      0,
    );
    if (messageTokens === 0) continue;
    accumulatedTokens += messageTokens;

    if (accumulatedTokens >= keepRecentTokens) {
      for (let c = 0; c < cutPoints.length; c++) {
        if (cutPoints[c] >= i) {
          cutIndex = cutPoints[c];
          break;
        }
      }
      break;
    }
  }

  // 从 cutIndex 向前回扫，纳入相邻的元数据条目
  while (cutIndex > startIndex) {
    const prevEntry = entries[cutIndex - 1];
    if (prevEntry.type === "compaction" || sessionEntryToContextMessages(prevEntry).length > 0) break;
    cutIndex--;
  }

  const cutEntry = entries[cutIndex];
  const startsTurn = isTurnStartEntry(cutEntry);
  const turnStartIndex = startsTurn ? -1 : findTurnStartIndex(entries, cutIndex, startIndex);

  return {
    firstKeptEntryIndex: cutIndex,
    turnStartIndex,
    isSplitTurn: !startsTurn && turnStartIndex !== -1,
  };
}

// ============================================================================
// 摘要生成
// ============================================================================

const SUMMARIZATION_PROMPT = `The messages above are a conversation to summarize. Create a structured context checkpoint summary that another LLM will use to continue the work.

Use this EXACT format:

## Goal
[What is the user trying to accomplish? Can be multiple items if the session covers different tasks.]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned by user]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context
- [Any data, examples, or references needed to continue]
- [Or "(none)" if not applicable]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

const UPDATE_SUMMARIZATION_PROMPT = `The messages above are NEW conversation messages to incorporate into the existing summary provided in <previous-summary> tags.

Update the existing structured summary with new information. RULES:
- PRESERVE all existing information from the previous summary
- ADD new progress, decisions, and context from the new messages
- UPDATE the Progress section: move items from "In Progress" to "Done" when completed
- UPDATE "Next Steps" based on what was accomplished
- PRESERVE exact file paths, function names, and error messages
- If something is no longer relevant, you may remove it

Use this EXACT format:

## Goal
[Preserve existing goals, add new ones if the task expanded]

## Constraints & Preferences
- [Preserve existing, add new ones discovered]

## Progress
### Done
- [x] [Include previously done items AND newly completed items]

### In Progress
- [ ] [Current work - update based on progress]

### Blocked
- [Current blockers - remove if resolved]

## Key Decisions
- **[Decision]**: [Brief rationale] (preserve all previous, add new)

## Next Steps
1. [Update based on current state]

## Critical Context
- [Preserve important context, add new if needed]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

/**
 * 通过 streamFn 完成摘要生成（V1：streamFn 为必填，没有 completeSimple 回退）。
 */
async function completeSummarization(
  model: Model<any>,
  context: Context,
  streamFn: (model: Model<any>, context: Context, options?: any) => any,
): Promise<AssistantMessage> {
  const stream = await streamFn(model, context, {});
  return stream.result();
}

/**
 * 使用 LLM 生成对话摘要。
 */
export async function generateSummary(
  currentMessages: AgentMessage[],
  model: Model<any>,
  reserveTokens: number,
  apiKey: string | undefined,
  streamFn: (model: Model<any>, context: Context, options?: any) => any,
  options?: {
    headers?: Record<string, string>;
    signal?: AbortSignal;
    customInstructions?: string;
    previousSummary?: string;
    thinkingLevel?: ThinkingLevel;
    env?: Record<string, string>;
  },
): Promise<string> {
  const maxTokens = Math.min(
    Math.floor(0.8 * reserveTokens),
    model.maxTokens > 0 ? model.maxTokens : Number.POSITIVE_INFINITY,
  );

  let basePrompt = options?.previousSummary ? UPDATE_SUMMARIZATION_PROMPT : SUMMARIZATION_PROMPT;
  if (options?.customInstructions) {
    basePrompt = `${basePrompt}\n\nAdditional focus: ${options.customInstructions}`;
  }

  const llmMessages = convertToLlm(currentMessages);
  const conversationText = serializeConversation(llmMessages as any);

  let promptText = `<conversation>\n${conversationText}\n</conversation>\n\n`;
  if (options?.previousSummary) {
    promptText += `<previous-summary>\n${options.previousSummary}\n</previous-summary>\n\n`;
  }
  promptText += basePrompt;

  const summarizationMessages = [
    {
      role: "user" as const,
      content: [{ type: "text" as const, text: promptText }],
      timestamp: Date.now(),
    },
  ];

  const tmpModel = { ...model, contextWindow: model.contextWindow, maxTokens };
  const response = await completeSummarization(
    tmpModel,
    { systemPrompt: SUMMARIZATION_SYSTEM_PROMPT, messages: summarizationMessages },
    streamFn,
  );

  if (response.stopReason === "error") {
    throw new Error(`Summarization failed: ${response.errorMessage || "Unknown error"}`);
  }

  return contentText(response.content);
}

// ============================================================================
// 压缩准备
// ============================================================================

export interface CompactionPreparation {
  firstKeptEntryId: string;
  messagesToSummarize: AgentMessage[];
  turnPrefixMessages: AgentMessage[];
  isSplitTurn: boolean;
  tokensBefore: number;
  previousSummary?: string;
  settings: CompactionSettings;
}

export function prepareCompaction(
  pathEntries: SessionEntry[],
  settings: CompactionSettings,
): CompactionPreparation | undefined {
  if (pathEntries.length > 0 && pathEntries[pathEntries.length - 1].type === "compaction") {
    return undefined;
  }

  let prevCompactionIndex = -1;
  for (let i = pathEntries.length - 1; i >= 0; i--) {
    if (pathEntries[i].type === "compaction") {
      prevCompactionIndex = i;
      break;
    }
  }

  let previousSummary: string | undefined;
  let boundaryStart = 0;
  if (prevCompactionIndex >= 0) {
    const prevCompaction = pathEntries[prevCompactionIndex] as CompactionEntry;
    previousSummary = prevCompaction.summary;
    const firstKeptEntryIndex = pathEntries.findIndex((entry) => entry.id === prevCompaction.firstKeptEntryId);
    boundaryStart = firstKeptEntryIndex >= 0 ? firstKeptEntryIndex : prevCompactionIndex + 1;
  }
  const boundaryEnd = pathEntries.length;

  // pathEntries 已是「根 → 当前叶子」的路径，buildSessionContext 需要叶子 id 才能回溯。
  // 不传 leafId 时 buildSessionPath 会直接返回空路径，导致 tokensBefore 恒为 0。
  const tokensBefore = estimateContextTokens(
    buildSessionContext(pathEntries, pathEntries[pathEntries.length - 1]?.id ?? null).messages,
  ).tokens;

  const cutPoint = findCutPoint(pathEntries, boundaryStart, boundaryEnd, settings.keepRecentTokens);

  const firstKeptEntry = pathEntries[cutPoint.firstKeptEntryIndex];
  if (!firstKeptEntry?.id) return undefined;

  const firstKeptEntryId = firstKeptEntry.id;
  const historyEnd = cutPoint.isSplitTurn ? cutPoint.turnStartIndex : cutPoint.firstKeptEntryIndex;

  const messagesToSummarize: AgentMessage[] = [];
  for (let i = boundaryStart; i < historyEnd; i++) {
    const msg = getMessageFromEntryForCompaction(pathEntries[i]);
    if (msg) messagesToSummarize.push(msg);
  }

  const turnPrefixMessages: AgentMessage[] = [];
  if (cutPoint.isSplitTurn) {
    for (let i = cutPoint.turnStartIndex; i < cutPoint.firstKeptEntryIndex; i++) {
      const msg = getMessageFromEntryForCompaction(pathEntries[i]);
      if (msg) turnPrefixMessages.push(msg);
    }
  }

  if (messagesToSummarize.length === 0 && turnPrefixMessages.length === 0) {
    return undefined;
  }

  return {
    firstKeptEntryId,
    messagesToSummarize,
    turnPrefixMessages,
    isSplitTurn: cutPoint.isSplitTurn,
    tokensBefore,
    previousSummary,
    settings,
  };
}

// ============================================================================
// 主压缩函数
// ============================================================================

/**
 * 使用准备好的数据为压缩生成摘要。
 * 返回 CompactionResult —— SessionManager 保存时会补充 uuid/parentUuid。
 *
 * 🔴 文件追踪（CompactionDetails / readFiles / modifiedFiles）——后续实现。
 */
export async function compact(
  preparation: CompactionPreparation,
  model: Model<any>,
  apiKey: string | undefined,
  streamFn: (model: Model<any>, context: Context, options?: any) => any,
  options?: {
    headers?: Record<string, string>;
    customInstructions?: string;
    signal?: AbortSignal;
    thinkingLevel?: ThinkingLevel;
    env?: Record<string, string>;
  },
): Promise<CompactionResult> {
  const {
    firstKeptEntryId,
    messagesToSummarize,
    tokensBefore,
    previousSummary,
    settings,
  } = preparation;

  const summary = await generateSummary(
    messagesToSummarize,
    model,
    settings.reserveTokens,
    apiKey,
    streamFn,
    {
      headers: options?.headers,
      signal: options?.signal,
      customInstructions: options?.customInstructions,
      previousSummary,
      thinkingLevel: options?.thinkingLevel,
      env: options?.env,
    },
  );

  if (!firstKeptEntryId) {
    throw new Error("First kept entry has no UUID - session may need migration");
  }

  // 🔴 Pi: computeFileLists + formatFileOperations —— 文件追踪，后续实现
  // 🔴 Pi: turnPrefixMessages —— split turn 摘要合并，后续实现

  return {
    summary,
    firstKeptEntryId,
    tokensBefore,
  };
}
