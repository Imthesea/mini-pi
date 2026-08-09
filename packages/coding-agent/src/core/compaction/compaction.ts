/**
 * Context compaction for long sessions.
 *
 * Pure functions for compaction logic. The session manager handles I/O,
 * and after compaction the session is reloaded.
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
// Message Extraction
// ============================================================================

/**
 * Extract AgentMessage from an entry if it produces one.
 * Returns undefined for entries that don't contribute to LLM context.
 */
function getMessageFromEntryForCompaction(entry: SessionEntry): AgentMessage | undefined {
  if (entry.type === "compaction") {
    return undefined;
  }
  return sessionEntryToContextMessages(entry)[0];
}

/** Result from compact() - SessionManager adds uuid/parentUuid when saving */
export interface CompactionResult<T = unknown> {
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  estimatedTokensAfter?: number;
  /** Extension-specific data */
  details?: T;
}

// ============================================================================
// Types
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
// Token calculation
// ============================================================================

/**
 * Calculate total context tokens from usage.
 */
export function calculateContextTokens(usage: Usage): number {
  return usage.totalTokens || usage.input + usage.output + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
}

/**
 * Get usage from an assistant message if available.
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
 * Find the last valid assistant message usage from session entries.
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
 * Estimate context tokens from messages, using the last assistant usage when available.
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
 * Check if compaction should trigger based on context usage.
 */
export function shouldCompact(contextTokens: number, contextWindow: number, settings: CompactionSettings): boolean {
  if (!settings.enabled) return false;
  return contextTokens > contextWindow - settings.reserveTokens;
}

// ============================================================================
// Cut point detection
// ============================================================================

const ESTIMATED_IMAGE_CHARS = 4800;

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
 * Estimate token count for a message using chars/4 heuristic.
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

function isTurnStartEntry(entry: SessionEntry): boolean {
  if (entry.type === "compaction") return false;
  return sessionEntryToContextMessages(entry).some(isTurnStartMessage);
}

/**
 * Find valid cut points: indices of context-visible user-like or assistant messages.
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
 * Find the context-visible user-role message that starts the turn containing the given entry index.
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
 * Find the cut point in session entries that keeps approximately `keepRecentTokens`.
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

  // Scan backwards from cutIndex to include adjacent metadata entries
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
// Summarization
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
 * Complete summarization via streamFn (V1: streamFn is required, no completeSimple fallback).
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
 * Generate a summary of the conversation using the LLM.
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
// Compaction Preparation
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

  const tokensBefore = estimateContextTokens(buildSessionContext(pathEntries).messages).tokens;

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
// Main compaction function
// ============================================================================

/**
 * Generate summaries for compaction using prepared data.
 * Returns CompactionResult - SessionManager adds uuid/parentUuid when saving.
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
