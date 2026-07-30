/**
 * harness 事件类型。
 *
 * Task 3 阶段:AgentHarnessEvent 当前等价于 AgentEvent(agent-loop 派发的事件)。
 * Task 4 会增量 8 个核心 harness 私有事件 + 9 个预声明事件
 * (model_update / thinking_level_update / tools_update / resources_update /
 *  queue_update / save_point / abort / settled 等)。
 *
 * AgentHarnessEvent 设计为 AgentEvent 的"超集",
 * 这样订阅者只需要订阅 AgentHarnessEvent 一种类型,
 * 就能接收到底层 agent-loop 事件 + harness 私有事件。
 */

import type { AgentEvent } from "../../types.js";

/**
 * Harness 事件联合。
 *
 * 当前阶段 = AgentEvent;Task 4 用 union 扩展:
 * ```ts
 * export type AgentHarnessEvent = AgentEvent | AgentHarnessOwnEvent;
 * ```
 */
export type AgentHarnessEvent = AgentEvent;
