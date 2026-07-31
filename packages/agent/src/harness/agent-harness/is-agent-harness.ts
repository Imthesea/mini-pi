/**
 * AgentHarness 的运行时类型守卫。
 *
 * 与 AgentHarness 类分离:避免主类文件继续膨胀,
 * 单独文件可在测试中按需 import,不打乱主类的字段顺序。
 */

import { AgentHarness } from "./agent-harness.js";

/** 运行时检查:值是否为 AgentHarness 实例(供 instanceof 的 ducktyping 替代) */
export function isAgentHarness(value: unknown): value is AgentHarness {
  return value instanceof AgentHarness;
}
