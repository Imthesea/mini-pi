/**
 * Hook context 构造器。
 *
 * 职责:
 * - 构造 AgentHarnessHookContext(harness / session / models / messages facade)
 * - 提供 session facade(getId / getMessages)
 * - 加载 session 历史消息(handler 可读)
 *
 * 为什么从 agent-harness.ts 拆出来:
 * - #buildHookContext + #loadSessionMessages + _syncHookContext 共 ~50 行
 * - 这部分是"如何构造 context"的纯函数,逻辑独立
 * - 拆出去后主类瘦身,context 构造逻辑可独立测
 */

import type { AgentMessage } from "../../types.js";
import type { AgentHarnessHookContext } from "../hooks/index.js";
import type { AgentHarness } from "./agent-harness.js";
import type { Session } from "../session/session.js";

// ── BuildArgs(注入依赖,保持主类 # 字段封装) ──

/**
 * buildHookContext 需要的依赖。
 */
export interface BuildHookContextArgs {
  /** 当前 harness 实例(注入到 context.harness) */
  harness: AgentHarness;
  /** 当前 session(从 #options.session 取出) */
  session: Session<any> | undefined;
  /** 加载 session 消息的回调(由 AgentHarness.#loadSessionMessages 提供) */
  loadSessionMessages: (session: Session<any>) => Promise<AgentMessage[]>;
}

// ── 公开函数 ──

/**
 * 构造 AgentHarnessHookContext。
 *
 * 结构:
 * - harness: 当前 harness 实例
 * - session: facade{ getId, getMessages }或空对象
 * - models: facade(本 Task 不填充,Task 后续接入)
 * - messages: 空数组(handler 可读 session 时拿到真实数据)
 */
export function buildHookContext(
  args: BuildHookContextArgs,
): AgentHarnessHookContext {
  const { harness, session, loadSessionMessages } = args;
  return {
    harness,
    // session facade:Task 5 接入后填充真正的 session 引用
    // 提供 getId / getMessages(handler 用 facade 拿数据,不必直接 import Session)
    // getId 返回 Promise<id>:因为 Session.getMetadata() 是 async
    session: session
      ? {
          getId: () =>
            session
              .getMetadata()
              .then((m) => m.id)
              .catch(() => "unknown"),
          getMessages: () => loadSessionMessages(session),
        }
      : {},
    // models facade:Task 后续接入后填充
    models: {},
    // messages:从 session 加载历史消息(handler 可读)
    messages: [],
  };
}

/**
 * 从 session 加载历史消息(给 hook context 用)。
 *
 * 失败时返回空数组(避免 hook emit 因 session 错误崩溃)。
 */
export async function loadSessionMessages(
  session: Session<any>,
): Promise<AgentMessage[]> {
  try {
    const context = await session.buildContext();
    return context.messages;
  } catch {
    return [];
  }
}
