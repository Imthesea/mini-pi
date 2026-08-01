/**
 * 队列处理纯函数。
 *
 * 职责:
 * - steer 队列:中途插入的用户消息(高优先级,中断当前 LLM 流)
 * - follow-up 队列:turn 结束后的额外用户消息(低优先级,自然延伸对话)
 * - nextTurn 队列:下一轮 prompt 之前的前置消息(预置上下文)
 *
 * 与 pi 的对齐:
 * - `getSteeringMessages` 回调由 agent-loop 在每个 turn 工具执行完后调用
 *   → drainSteerQueue 排空
 * - `getFollowUpMessages` 回调由 agent-loop 在 agent 原本要停时调用
 *   → drainFollowUpQueue 排空
 * - nextTurn 不在 agent-loop 协议里,本项目在 turn-execution 入口消费
 *
 * 设计原则:
 * - 全部为纯函数(无副作用,不依赖外部状态)
 * - 不可变:入参队列不修改,返回新数组
 * - QueueMode 行为差异(2 个模式 × 3 个队列)集中在一个文件
 *
 * 文件拆分理由(plan § 4.7):
 * - 三个队列本质是同一种模式(drain queue + 决定何时投递 + QueueMode 行为差异)
 * - 拆 3 个文件是"为对称而拆"(工程原则 § 1.3 反例)
 * - 合并后 ~150 行,读者在一个文件里看到所有 3 种队列处理 + QueueMode 差异
 */

import type { AgentMessage } from "../types.js";

// ── 队列类型 ──

/** 队列元素:AgentMessage(用户/助手/工具结果/自定义,目前只用 user) */
export type QueueMessage = AgentMessage;

/** 单个队列(纯 AgentMessage 数组) */
export type MessageQueue = readonly QueueMessage[];

/** 队列排空模式(从 pi 沿用) */
export type { QueueMode } from "../types.js";

/** drain 操作的返回值:drained(本轮投递) + remaining(保留在队列里) */
export interface DrainResult {
  /** 本轮被排空并准备投递的消息(已按队列顺序) */
  drained: QueueMessage[];
  /** 仍在队列中保留的消息(本轮不投递) */
  remaining: MessageQueue;
}

// ── 通用 drain(基于 QueueMode) ──

/**
 * 按 QueueMode 排空队列(纯函数,不改入参)。
 *
 * - `"all"`:drained = 全部消息,remaining = []
 * - `"one-at-a-time"`:drained = [queue[0]],remaining = queue.slice(1)
 *
 * 抽出为内部 helper,统一 steer / followUp 两处 drain 的逻辑。
 */
function drainByMode(
  queue: MessageQueue,
  mode: "all" | "one-at-a-time",
): DrainResult {
  if (queue.length === 0) {
    return { drained: [], remaining: [] };
  }
  if (mode === "all") {
    return { drained: [...queue], remaining: [] };
  }
  // "one-at-a-time"
  return { drained: [queue[0]], remaining: queue.slice(1) };
}

// ── steer 队列 ──

/**
 * 入队 steer 消息(纯函数)。
 *
 * steer 消息会在 agent-loop 每个 turn 工具执行完后被 drainSteerQueue 排空,
 * 注入为 LLM 下一轮的 user 消息。
 *
 * @param queue 当前 steer 队列
 * @param message 要入队的 user 消息
 * @returns 新队列(原队列未修改)
 */
export function enqueueSteer(
  queue: MessageQueue,
  message: QueueMessage,
): MessageQueue {
  return [...queue, message];
}

/**
 * 排空 steer 队列(纯函数)。
 *
 * 调用方(agent-loop 的 getSteeringMessages 回调)拿到 drained 后,
 * 直接作为下一轮 user 消息交给 LLM。
 *
 * @param queue 当前 steer 队列
 * @param mode 排空模式
 * @returns drained + remaining
 */
export function drainSteerQueue(
  queue: MessageQueue,
  mode: "all" | "one-at-a-time",
): DrainResult {
  return drainByMode(queue, mode);
}

// ── follow-up 队列 ──

/**
 * 入队 follow-up 消息(纯函数)。
 *
 * follow-up 消息会在 agent-loop 检测"原本要停"时(无 follow-up 注入则 agent 结束)
 * 被 drainFollowUpQueue 排空,让 agent 继续 turn。
 *
 * @param queue 当前 follow-up 队列
 * @param message 要入队的 user 消息
 * @returns 新队列(原队列未修改)
 */
export function enqueueFollowUp(
  queue: MessageQueue,
  message: QueueMessage,
): MessageQueue {
  return [...queue, message];
}

/**
 * 排空 follow-up 队列(纯函数)。
 *
 * 调用方(agent-loop 的 getFollowUpMessages 回调)拿到 drained 后,
 * 让 agent 继续以 drained 为下一轮 user 消息运行。
 *
 * @param queue 当前 follow-up 队列
 * @param mode 排空模式
 * @returns drained + remaining
 */
export function drainFollowUpQueue(
  queue: MessageQueue,
  mode: "all" | "one-at-a-time",
): DrainResult {
  return drainByMode(queue, mode);
}

// ── nextTurn 队列 ──

/**
 * 入队 nextTurn 消息(纯函数)。
 *
 * nextTurn 消息会在下一次 harness.prompt() 入口被消费,
 * 以"前置消息"形式拼到 user 输入之前(预置上下文)。
 *
 * nextTurn 没有 QueueMode 概念 —— 每次 prompt 入口一次性消费全部 nextTurn 消息,
 * 按入队顺序 prepend 到 user 消息。
 *
 * @param queue 当前 nextTurn 队列
 * @param message 要入队的 user 消息
 * @returns 新队列(原队列未修改)
 */
export function enqueueNextTurn(
  queue: MessageQueue,
  message: QueueMessage,
): MessageQueue {
  return [...queue, message];
}
