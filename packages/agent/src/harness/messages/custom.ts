/**
 * 自定义消息投影器(custom message projector)。
 *
 * Custom 消息通过 TypeScript 声明合并扩展进来(见 CustomAgentMessages 接口),
 * 由用户项目定义具体形态(本项目是 notification / bashExecution /
 * branchSummary / artifact 等)。
 *
 * Task 3 阶段:本模块只暴露"默认 projector"和"批量投影"工具,
 * 不实现任何具体 custom 类型的渲染规则(留待 Task 8 + 下游 CLI 演示)。
 *
 * 默认规则:对任何未知 custom 类型,返回空数组(即不投影任何 user 消息)。
 * 用户可继承或替换 projector 来自定义渲染。
 */

import type { Message } from "@mimi/ai";
import type { AgentMessage } from "../../types.js";

/** 自定义消息投影器签名 */
export type CustomProjector = (msg: AgentMessage) => Message[];

/**
 * 默认自定义消息投影器。
 *
 * 当前实现:对所有 custom 消息返回空数组,即"丢弃所有 custom"。
 * 后续 Task 可以扩展:识别 specific customType 并返回格式化后的 user 消息
 * (例如 branchSummary → "<branch summary>..." 文案)。
 */
export function getDefaultCustomProjector(): CustomProjector {
  return () => [];
}

/**
 * 把一个消息列表中所有 custom 消息按 projector 投影为 user 消息,
 * 非 custom 消息保持原样。
 *
 * 用途:convertToLlm 的"启用 custom 投影"版本。
 * 默认 projector 不会产生任何 user 消息,所以结果等价于 convertToLlm。
 *
 * @param messages 待投影的消息列表
 * @param projector 投影器(默认 = getDefaultCustomProjector)
 */
export function mapCustomToUserMessages(
  messages: AgentMessage[],
  projector: CustomProjector = getDefaultCustomProjector(),
): AgentMessage[] {
  const out: AgentMessage[] = [];
  for (const m of messages) {
    if ((m as { role?: string }).role === "custom") {
      const projected = projector(m);
      for (const p of projected) {
        out.push(p as AgentMessage);
      }
      continue;
    }
    out.push(m);
  }
  return out;
}
