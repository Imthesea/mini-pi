/**
 * AgentHarness 压缩 + 树形跳转的业务实现。
 *
 * 拆分动机(plan § 4.5 + 工程原则 § 2.2):
 * - agent-harness.ts 在 Task 4-5 后已达 488 行,Task 6 增量(compact + navigateTree)
 *   会让总行数突破 500 软上限
 * - 按工程原则"超 500 时优先抽到辅助文件",本文件承担 compact + navigateTree
 *   的具体实现(钩子协调 + 调底层模块 + 写 session)
 * - agent-harness.ts 保留薄包装方法(`compact()` + `navigateTree()` 只做 phase 状态机)
 *
 * 与 compact / branch-summarization 模块的关系:
 * - 底层模块(纯函数):compaction/compact.ts + compaction/branch-summarization.ts
 *   提供 `runCompact` / `runGenerateBranchSummary` / `extractFileOpsFromMessage`
 * - 本文件(编排):协调钩子 + 调底层 + 写 session
 *
 * 设计原则:
 * - 钩子协调(session_before_compact / session_before_tree)在本文件,不放在 agent-harness
 * - streamFn 通过参数传入(由 harness 提供),便于测试注入
 * - 不依赖 AgentHarness 私有字段,只通过 options / 公开 API 协作
 */

import type { Model } from "@mimi/ai";
import type { DefaultAgentHarnessHooks } from "../hooks/index.js";
import type { Session } from "../session/session.js";
import { compact as runCompact } from "../compaction/compact.js";
import { generateBranchSummary as runGenerateBranchSummary } from "../compaction/branch-summarization.js";
import type { CompactionResult } from "../compaction/types.js";

// ── 公共 API ──

/** 压缩业务执行参数(由 harness 传入) */
export interface RunCompactArgs {
  /** 当前 session */
  session: Session<any>;
  /** 当前 model */
  model: Model<any>;
  /** 钩子系统 */
  hooks: DefaultAgentHarnessHooks;
  /** stream 函数(同 AgentLoopConfig.streamFn) */
  streamFn: any;
}

/** 压缩业务执行结果 */
export interface RunCompactResult {
  /** 压缩生成的 summary 文本 */
  summary: string;
}

/**
 * 执行压缩业务(钩子协调 + 调底层 + 写 session)。
 *
 * 流程:
 * 1. emit `session_before_compact` 钩子(handler 可 cancel / 注入已有结果)
 * 2. 决定 result:优先用 hook 注入,否则调 LLM
 * 3. 写 CompactionEntry 到 session
 * 4. emit `session_compact` 钩子
 *
 * **不**处理 phase 状态机(由 harness 层负责)。
 *
 * @returns 压缩结果(若 cancel 则返回 undefined)
 */
export async function runCompactOp(
  args: RunCompactArgs,
): Promise<RunCompactResult | undefined> {
  const { session, model, hooks, streamFn } = args;

  // 0. 防御:session 为 null / undefined 时直接返回 undefined
  if (!session) {
    return undefined;
  }

  // 1. emit session_before_compact(handler 可 cancel / 注入结果)
  const beforeResult = (await hooks.emit({
    type: "session_before_compact",
  } as any)) as { cancel?: boolean; compaction?: CompactionResult } | undefined;

  if (beforeResult?.cancel === true) {
    return undefined;
  }

  // 2. 决定 result:优先用 hook 注入,否则调 LLM
  let result: CompactionResult;
  if (beforeResult?.compaction) {
    result = { ...beforeResult.compaction, fromHook: true };
  } else {
    result = await runCompact(session, model, streamFn);
  }

  // 3. 写 CompactionEntry
  await session.appendCompaction(
    result.summary,
    result.firstKeptEntryId,
    result.tokensBefore,
    result.details,
    result.fromHook,
  );

  // 4. emit session_compact(fire-and-forget)
  void hooks.emit({ type: "session_compact" } as any);

  return { summary: result.summary };
}

/** 树形跳转业务执行参数 */
export interface RunNavigateTreeArgs {
  /** 当前 session */
  session: Session<any>;
  /** 当前 model */
  model: Model<any>;
  /** 钩子系统 */
  hooks: DefaultAgentHarnessHooks;
  /** stream 函数 */
  streamFn: any;
  /** 目标 entry id(null = 切到空) */
  targetId: string | null;
}

/**
 * 执行树形跳转业务(钩子协调 + 调底层 + 切 leaf + 写 BranchSummaryEntry)。
 *
 * 流程:
 * 1. emit `session_before_tree` 钩子(handler 可 cancel / 注入已有 summary)
 * 2. 决定 summary:优先用 hook 注入,否则调 LLM
 * 3. 调 session.moveTo 切 leaf + 写 BranchSummaryEntry
 * 4. emit `session_tree` 钩子
 *
 * **不**处理 phase 状态机(由 harness 层负责)。
 *
 * @returns 若写了 BranchSummaryEntry 则返回其 id,否则 undefined
 */
export async function runNavigateTreeOp(
  args: RunNavigateTreeArgs,
): Promise<string | undefined> {
  const { session, model, hooks, streamFn, targetId } = args;

  // 1. emit session_before_tree(handler 可 cancel / 注入 summary)
  const beforeResult = (await hooks.emit({
    type: "session_before_tree",
    targetId,
  } as any)) as
    | {
        cancel?: boolean;
        summary?: { summary: string; details?: unknown };
        customInstructions?: string;
        label?: string;
      }
    | undefined;

  if (beforeResult?.cancel === true) {
    return undefined;
  }

  // 2. 决定 summary:优先用 hook 注入,否则调 LLM
  let summary: { summary: string; details?: unknown };
  if (beforeResult?.summary) {
    summary = beforeResult.summary;
  } else {
    const generated = await runGenerateBranchSummary(
      await session.getBranch(),
      targetId ?? "",
      model,
      streamFn,
      { customInstructions: beforeResult?.customInstructions },
    );
    summary = generated;
  }

  // 3. 调 session.moveTo 切 leaf + 写 BranchSummaryEntry
  const branchEntryId = await session.moveTo(targetId, {
    summary: summary.summary,
    details: summary.details,
    fromHook: !!beforeResult?.summary,
  });

  // 4. emit session_tree(fire-and-forget)
  void hooks.emit({ type: "session_tree" } as any);

  return branchEntryId;
}
