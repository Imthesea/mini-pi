/**
 * Custom message types and transformers for the coding agent.
 *
 * Extends the base AgentMessage type with coding-agent specific message types,
 * and provides a transformer to convert them to LLM-compatible messages.
 *
 * 从 pi 项目 core/messages.ts 抄来（V1 最小化）。
 */

import type { AgentMessage } from "@mimi/agent";
import type { ImageContent, Message, TextContent } from "@mimi/ai";

/** 压缩摘要前缀——将摘要包装成 LLM 可见的上下文 */
export const COMPACTION_SUMMARY_PREFIX = `The conversation history before this point was compacted into the following summary:\n\n<summary>\n`;
/** 压缩摘要后缀 */
export const COMPACTION_SUMMARY_SUFFIX = `\n</summary>`;
/** 分支摘要前缀 */
export const BRANCH_SUMMARY_PREFIX = `The following is a summary of a branch that this conversation came back from:\n\n<summary>\n`;
/** 分支摘要后缀 */
export const BRANCH_SUMMARY_SUFFIX = `</summary>`;

/**
 * Message type for bash executions via the ! command.
 * 🔴 V1 类型定义保留，功能未实现。
 */
export interface BashExecutionMessage {
  role: "bashExecution";
  command: string;
  output: string;
  exitCode: number | undefined;
  cancelled: boolean;
  truncated: boolean;
  fullOutputPath?: string;
  timestamp: number;
  excludeFromContext?: boolean;
}

/**
 * Convert a BashExecutionMessage to user message text for LLM context.
 */
export function bashExecutionToText(msg: BashExecutionMessage): string {
  let text = `Ran \`${msg.command}\`\n`;
  if (msg.output) {
    text += `\`\`\`\n${msg.output}\n\`\`\``;
  } else {
    text += "(no output)";
  }
  if (msg.cancelled) {
    text += "\n\n(command cancelled)";
  } else if (msg.exitCode !== null && msg.exitCode !== undefined && msg.exitCode !== 0) {
    text += `\n\nCommand exited with code ${msg.exitCode}`;
  }
  if (msg.truncated && msg.fullOutputPath) {
    text += `\n\n[Output truncated. Full output: ${msg.fullOutputPath}]`;
  }
  return text;
}

export interface CustomMessage<T = unknown> {
  role: "custom";
  customType: string;
  content: string | (TextContent | ImageContent)[];
  display: boolean;
  details?: T;
  timestamp: number;
}

export interface BranchSummaryMessage {
  role: "branchSummary";
  summary: string;
  fromId: string;
  timestamp: number;
}

export interface CompactionSummaryMessage {
  role: "compactionSummary";
  summary: string;
  tokensBefore: number;
  timestamp: number;
}

/**
 * Transform AgentMessages (including custom types) to LLM-compatible Messages.
 */
export function convertToLlm(messages: AgentMessage[]): Message[] {
  return messages
    .map((m): Message | undefined => {
      const role = (m as any).role as string;
      switch (role) {
        case "compactionSummary":
          return {
            role: "user" as const,
            content: [{ type: "text" as const, text: COMPACTION_SUMMARY_PREFIX + (m as any).summary + COMPACTION_SUMMARY_SUFFIX }],
            timestamp: (m as any).timestamp,
          };
        case "branchSummary":
          return {
            role: "user" as const,
            content: [{ type: "text" as const, text: BRANCH_SUMMARY_PREFIX + (m as any).summary + BRANCH_SUMMARY_SUFFIX }],
            timestamp: (m as any).timestamp,
          };
        case "bashExecution":
          // 🔴 V1: excludeFromContext 未使用（!! prefix 不支持）
          return {
            role: "user" as const,
            content: [{ type: "text" as const, text: bashExecutionToText(m as any) }],
            timestamp: (m as any).timestamp,
          };
        // 🔴 Pi: "custom" —— V1 不做（扩展系统未实现）
        case "user":
        case "assistant":
        case "toolResult":
          return m as Message;
        default:
          return undefined;
      }
    })
    .filter((m): m is Message => m !== undefined);
}

export function createCompactionSummaryMessage(
  summary: string,
  tokensBefore: number,
  timestamp: string,
): CompactionSummaryMessage {
  return {
    role: "compactionSummary",
    summary,
    tokensBefore,
    timestamp: new Date(timestamp).getTime(),
  };
}

// 🔴 Pi: createBranchSummaryMessage / createCustomMessage —— V1 不做
// 🔴 Pi: declare module "@mimi/agent" { interface CustomAgentMessages { ... } } —— V1 不做声明合并
