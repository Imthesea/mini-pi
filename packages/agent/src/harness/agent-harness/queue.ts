/**
 * 队列操作辅助函数(Task 8 增量)。
 *
 * 职责:
 * - 把 steer/followUp/nextTurn 的入队操作集中在一个文件
 * - 调 queue.ts 的纯函数 + emit queue_update 钩子
 *
 * 为什么从 agent-harness.ts 拆出来:
 * - agent-harness.ts 在 Task 7 末尾已达 543 行(> 500 软上限)
 * - Task 8 增量 steer/followUp/nextTurn 三个方法会把行数推到 ~600
 * - 把"入队 + emit 钩子"的样板抽到本文件,主类只剩薄包装
 * - 与 skill-ops / compaction-ops / turn-execution 的"委托模式"保持一致
 *
 * 与 queue.ts 的关系:
 * - queue.ts = 纯函数(无状态、无副作用、不可变)
 * - 本文件 = 协作层(把纯函数与 harness 私有状态/钩子系统连接)
 */

import type { AgentMessage } from "../../types.js";
import { buildUserContent } from "./helpers.js";
import {
  enqueueFollowUp,
  enqueueNextTurn,
  enqueueSteer,
} from "../queue.js";
import type { DefaultAgentHarnessHooks } from "../hooks/index.js";

// ── 依赖注入接口(保持主类 # 字段封装) ──

/**
 * runSteerOp / runFollowUpOp / runNextTurnOp 需要的依赖。
 *
 * 设计:
 * - 由 AgentHarness 通过 getter/setter 闭包注入,不暴露 # 字段
 * - hooks 直接传引用(emit 是公开方法)
 */
export interface QueueOpDeps {
  /** 读当前 steer 队列 */
  getSteerQueue: () => readonly AgentMessage[];
  /** 写 steer 队列(整体替换,不可变) */
  setSteerQueue: (queue: readonly AgentMessage[]) => void;
  /** 读当前 follow-up 队列 */
  getFollowUpQueue: () => readonly AgentMessage[];
  /** 写 follow-up 队列 */
  setFollowUpQueue: (queue: readonly AgentMessage[]) => void;
  /** 读当前 nextTurn 队列 */
  getNextTurnQueue: () => readonly AgentMessage[];
  /** 写 nextTurn 队列 */
  setNextTurnQueue: (queue: readonly AgentMessage[]) => void;
  /** 钩子系统(emit queue_update 用) */
  hooks: DefaultAgentHarnessHooks;
}

// ── 工具:构造 user 消息 ──

/**
 * 把 text + 可选 images 包装为 AgentMessage(user 角色)。
 *
 * 时间戳取当前时间(入队时刻)。
 */
function buildUserMessage(
  text: string,
  images?: Array<{ data: string; mimeType: string }>,
): AgentMessage {
  return {
    role: "user",
    content: buildUserContent(text, images),
    timestamp: Date.now(),
  };
}

// ── runSteerOp ──

/**
 * 入队 steer 消息 + emit queue_update 钩子。
 *
 * 不处理 phase(可在任意 phase 调,即使在 turn 中也行)。
 * 不阻塞 emit(fire-and-forget)。
 *
 * @param deps  队列依赖(由 AgentHarness 注入)
 * @param text  user 文本
 * @param images 可选图片
 */
export function runSteerOp(
  deps: QueueOpDeps,
  text: string,
  images?: Array<{ data: string; mimeType: string }>,
): void {
  const message = buildUserMessage(text, images);
  deps.setSteerQueue(enqueueSteer(deps.getSteerQueue(), message));
  // fire-and-forget,失败由钩子系统内部 log,不影响主流程
  void deps.hooks.emit({ type: "queue_update" } as any);
}

// ── runFollowUpOp ──

/**
 * 入队 follow-up 消息 + emit queue_update 钩子。
 *
 * 不处理 phase。
 *
 * @param deps  队列依赖
 * @param text  user 文本
 * @param images 可选图片
 */
export function runFollowUpOp(
  deps: QueueOpDeps,
  text: string,
  images?: Array<{ data: string; mimeType: string }>,
): void {
  const message = buildUserMessage(text, images);
  deps.setFollowUpQueue(enqueueFollowUp(deps.getFollowUpQueue(), message));
  void deps.hooks.emit({ type: "queue_update" } as any);
}

// ── runNextTurnOp ──

/**
 * 入队 nextTurn 消息 + emit queue_update 钩子。
 *
 * 不处理 phase。
 *
 * @param deps  队列依赖
 * @param text  user 文本
 * @param images 可选图片
 */
export function runNextTurnOp(
  deps: QueueOpDeps,
  text: string,
  images?: Array<{ data: string; mimeType: string }>,
): void {
  const message = buildUserMessage(text, images);
  deps.setNextTurnQueue(enqueueNextTurn(deps.getNextTurnQueue(), message));
  void deps.hooks.emit({ type: "queue_update" } as any);
}
