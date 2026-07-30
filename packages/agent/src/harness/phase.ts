/**
 * AgentHarness 阶段状态机。
 *
 * 阶段枚举(从 pi 沿用,见 design §4.1):
 * - "idle"           空闲,接受结构性操作
 * - "turn"           LLM turn 进行中
 * - "compaction"     压缩中
 * - "branch_summary" 分支摘要中
 * - "retry"          重试中(stream-assistant 内部触发,不外露)
 *
 * 状态机是 harness 的"并发安全锁":
 * 任意时刻只能处于一种 phase,所有结构性操作(prompt / compact / navigateTree)
 * 都从 idle 出发,完成后回到 idle。
 */

import { AgentHarnessError, PhaseError } from "./errors.js";

/** 阶段枚举 */
export type AgentHarnessPhase =
  | "idle"
  | "turn"
  | "compaction"
  | "branch_summary"
  | "retry";

/**
 * 阶段转换表(从 source phase 可达的 target phases)。
 *
 * 单一事实来源:canTransition / assertPhase 都查这张表。
 * 新增阶段时,只需要更新这里。
 */
export const PHASE_TRANSITIONS: ReadonlyMap<AgentHarnessPhase, readonly AgentHarnessPhase[]> =
  new Map([
    ["idle", ["turn", "compaction", "branch_summary"]],
    ["turn", ["idle", "retry"]],
    ["retry", ["idle"]],
    ["compaction", ["idle"]],
    ["branch_summary", ["idle"]],
  ]);

/**
 * 判断 from → to 是否为合法转换。
 *
 * @param from 当前 phase
 * @param to 目标 phase
 * @returns 是否允许
 */
export function canTransition(
  from: AgentHarnessPhase,
  to: AgentHarnessPhase,
): boolean {
  const allowed = PHASE_TRANSITIONS.get(from);
  if (!allowed) return false;
  return allowed.includes(to);
}

/**
 * 断言当前 phase 在允许列表中,否则抛 PhaseError。
 *
 * @param current 当前 phase
 * @param allowed 允许的 phase 列表(可传单个 phase)
 * @param operation 操作名(用于错误信息,如 "prompt" / "compact")
 */
export function assertPhase(
  current: AgentHarnessPhase,
  allowed: AgentHarnessPhase | readonly AgentHarnessPhase[],
  operation: string,
): void {
  const allowedList = Array.isArray(allowed) ? allowed : [allowed];
  if (allowedList.includes(current)) return;

  throw new PhaseError(
    `无法在 phase="${current}" 时执行 ${operation};当前允许的 phase: ${allowedList.join(", ")}`,
  );
}

// 防止 lint 警告:AgentHarnessError 是基类,本文件暂未直接使用
void AgentHarnessError;
