/**
 * convertToLlm —— AgentMessage[] 投影为 Message[]。
 *
 * 这是 agent-loop 调用 LLM 前的"上下文投影"入口,
 * 也是 Session.buildContext() 之外另一处可能用到的地方。
 *
 * 默认行为:过滤掉所有 custom 消息(role === "custom"),
 * 因为 LLM 不认识 custom 类型,只接受标准 Message(user/assistant/toolResult)。
 *
 * 不 throw / reject:即使转换失败(理论上不会),也返回部分结果,
 * 而不是把异常抛给 agent-loop 状态机(见 AgentLoopConfig.convertToLlm 契约)。
 */

import type { Message } from "@mimi/ai";
import type { AgentMessage } from "../../types.js";

/**
 * 把 AgentMessage[] 投影为 LLM 可消费的 Message[]。
 *
 * 默认:过滤掉所有 role === "custom" 的消息。
 * LLM 只需要 user / assistant / toolResult 三种标准消息。
 *
 * @param messages 任意 AgentMessage 列表
 * @returns 标准 Message 列表(已过滤 custom)
 */
export function convertToLlm(messages: AgentMessage[]): Message[] {
  const out: Message[] = [];
  for (const m of messages) {
    // 过滤 custom 消息(声明合并进来的扩展类型)
    if ((m as { role?: string }).role === "custom") {
      continue;
    }
    // TypeScript 层面:经过过滤后,剩下的就是 Message 联合的子集
    out.push(m as Message);
  }
  return out;
}
