/**
 * 压缩前的"准备"步骤:选保留边界,派生要送进 LLM 的 messages。
 *
 * 核心算法:
 * 1. 从 leaf → root 回溯,逐条累加 token
 * 2. 当"已累加的 token >= keepRecentTokens"时,停止回溯
 * 3. firstKeptEntryId = 当前 entry 的 id(或 root 时 = 第一条)
 * 4. 早于 firstKeptEntryId 的 entries 的 messages 就是要送给 LLM 做 summary 的内容
 * 5. 累计 readFiles / modifiedFiles(从 messages 中提取)
 *
 * 设计要点:
 * - 函数接受 `entries`(从 leaf 沿 parentId 回溯到 root 的列表,根在末尾),
 *   内部按"root-first"遍历再"leaf-first"处理
 * - **不**写 session,不调 LLM:只做"数据准备",pure function
 * - `extractFileOpsFromMessage` 内联在此(作为内部函数,不外露)
 *
 * 拆分动机(plan § 4.5):
 * - 独立文件:与 compact.ts 分离,作为可独立单测的"纯函数"
 * - file-ops 内联:不抽到 utils.ts(spec 决策,与 compact 强耦合)
 */

import type { AgentMessage } from "../../types.js";
import type { SessionTreeEntry } from "../session/types.js";
import { estimateTokens } from "./estimate.js";
import type { CompactionPreparation, CompactionSettings } from "./types.js";
import { DEFAULT_COMPACTION_SETTINGS } from "./settings.js";

// ── 公共 API ──

/**
 * 准备压缩:从 entries 链派生"要保留的边界" + "要送进 LLM 的 messages"。
 *
 * 决策规则:
 * - 累加"从 leaf 往 root"的方向(因为 leaf 是最新消息,优先保留)
 * - 当累加 token 超过 `keepRecentTokens` 时停止,保留当前 entry
 * - 如果全部 entries 都不到 keepRecentTokens,firstKeptEntryId = 第一条 entry
 * - 如果一条 entries 都没有,firstKeptEntryId = "<empty>"(但这不该发生,session 总有 root)
 *
 * @param entries  从 leaf → root 的 entry 链(root 在末尾,leaf 在头部)
 * @param settings  压缩 settings(用 keepRecentTokens)
 * @returns          准备结果(包含 firstKeptEntryId / tokensBefore / messagesToSummarize / readFiles / modifiedFiles)
 */
export function prepareCompaction(
  entries: readonly SessionTreeEntry[],
  settings: CompactionSettings = {},
): CompactionPreparation {
  const merged = { ...DEFAULT_COMPACTION_SETTINGS, ...settings };
  const keepRecentTokens = merged.keepRecentTokens ?? 20000;

  // 防御:空 entries
  if (entries.length === 0) {
    return {
      firstKeptEntryId: "<empty>",
      tokensBefore: 0,
      messagesToSummarize: [],
      readFiles: [],
      modifiedFiles: [],
    };
  }

  // 累加:从 leaf(头部)往 root(尾部)回溯
  // 当累加 token > keepRecentTokens 时停止,当前位置之前的 entry 就是要保留的边界
  // entries[0] = leaf, entries[length-1] = root
  let keepFromIndex = entries.length; // 默认"全部保留"(全部要压缩,等于没保留)
  let accumulatedTokens = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue; // 防御:TypeScript 严格模式下 indices 不会 undefined,这里仅为 narrowing

    // 只对 message entry 计算 token
    if (entry.type === "message") {
      const tokens = estimateTokens(entry.message);
      accumulatedTokens += tokens;
    }
    // branch_summary / compaction / leaf / custom 不计入 token 估算

    if (accumulatedTokens >= keepRecentTokens) {
      // 停止:当前 entry 之后(更靠近 leaf 的)都保留
      // 即 firstKeptEntryId = entries[i].id
      // 但:让 LLM 看到"更早"的 entry(从 root 到 i-1),所以 messagesToSummarize 是 entries[0..i-1]
      keepFromIndex = i;
      break;
    }
  }

  // 如果一直累加到 root 都没超过 keepRecentTokens,保留最后一条
  // firstKeptEntryId = 最后一条 entry(保留全部,不压缩任何东西)
  // 这种情况下 messagesToSummarize = []
  if (keepFromIndex === entries.length) {
    const lastEntry = entries[entries.length - 1]!;
    const tokensBefore = estimateTokens(
      entries
        .filter((e): e is SessionTreeEntry & { type: "message"; message: AgentMessage } => e.type === "message")
        .map((e) => e.message),
    );
    return {
      firstKeptEntryId: lastEntry.id,
      tokensBefore,
      messagesToSummarize: [],
      readFiles: [],
      modifiedFiles: [],
    };
  }

  // 一般情况:keepFromIndex 处的 entry 是保留边界
  const firstKeptEntry = entries[keepFromIndex]!;
  const messagesToSummarize: AgentMessage[] = [];

  // entries[0..keepFromIndex-1] 的 message entries 就是要送进 LLM 做 summary 的内容
  for (let i = 0; i < keepFromIndex; i++) {
    const entry = entries[i];
    if (!entry) continue;
    if (entry.type === "message") {
      messagesToSummarize.push(entry.message);
    }
  }

  // file ops 累计:从"全部 message entries"提取(不是只从 messagesToSummarize)
  // 原因:即使 keepRecentTokens=0 强制压缩时 messagesToSummarize=[],
  // 整个 session 仍可能有 file ops 需要总结(用于 summary 上下文)
  const readFiles = new Set<string>();
  const modifiedFiles = new Set<string>();
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const ops = extractFileOpsFromMessage(entry.message);
    for (const f of ops.readFiles) readFiles.add(f);
    for (const f of ops.modifiedFiles) modifiedFiles.add(f);
  }

  const tokensBefore = estimateTokens(messagesToSummarize) + accumulatedTokens;

  return {
    firstKeptEntryId: firstKeptEntry.id,
    tokensBefore,
    messagesToSummarize,
    readFiles: Array.from(readFiles),
    modifiedFiles: Array.from(modifiedFiles),
  };
}

// ── file-ops 提取(内联,不强依赖工具函数) ──

/**
 * 从单条 message 中提取文件操作(读取 / 修改)。
 *
 * 简单启发式:扫描 toolCall name / content 里的常见关键字。
 * 真正的"文件操作追踪"是 tool 层(本包不实现),本函数只做 best-effort。
 *
 * @param message  单条 AgentMessage
 * @returns         { readFiles, modifiedFiles } 路径数组
 */
export function extractFileOpsFromMessage(
  message: AgentMessage,
): { readFiles: string[]; modifiedFiles: string[] } {
  const readFiles: string[] = [];
  const modifiedFiles: string[] = [];

  switch (message.role) {
    case "assistant": {
      for (const c of message.content) {
        if (c.type !== "toolCall") continue;
        const name = c.name.toLowerCase();
        const args = (c.arguments ?? {}) as Record<string, unknown>;
        const path =
          typeof args.path === "string"
            ? args.path
            : typeof args.filePath === "string"
              ? args.filePath
              : typeof args.file_path === "string"
                ? args.file_path
                : null;
        if (!path) continue;

        if (
          name === "read" ||
          name === "read_file" ||
          name === "cat" ||
          name === "getfile" ||
          name === "load_file"
        ) {
          readFiles.push(path);
        } else if (
          name === "write" ||
          name === "write_file" ||
          name === "edit" ||
          name === "edit_file" ||
          name === "patch" ||
          name === "delete" ||
          name === "remove" ||
          name === "create"
        ) {
          modifiedFiles.push(path);
        }
      }
      break;
    }
    case "toolResult": {
      // toolResult.content 如果包含 file path 文本,尝试提取
      for (const c of message.content) {
        if (c.type !== "text") continue;
        // 简单启发:查找 "<path>: <content>" 模式
        const matches = c.text.match(/(?:read|file|path)[:：]\s*([^\s\n]+)/gi);
        if (!matches) continue;
        const toolName = message.toolName.toLowerCase();
        for (const m of matches) {
          const path = m.split(/[:：]/)[1]?.trim();
          if (!path) continue;
          if (
            toolName === "read" ||
            toolName === "read_file" ||
            toolName === "cat"
          ) {
            readFiles.push(path);
          } else if (
            toolName === "write" ||
            toolName === "write_file" ||
            toolName === "edit" ||
            toolName === "edit_file"
          ) {
            modifiedFiles.push(path);
          }
        }
      }
      break;
    }
    default:
      break;
  }

  return { readFiles, modifiedFiles };
}
