/**
 * Token 估算工具。
 *
 * 算法:基于 `chars / 4` 启发式估算(对英文 + 中文混合都近似可接受)。
 *
 * 为什么不调用真正的 tokenizer:
 * - 避免引入额外依赖(tiktoken 等)
 * - 估算目的不需要精确值(只是用来决定"是否压缩 / 保留多少")
 * - 实际生成时由 LLM 自己用 tokenizer,不影响精度
 *
 * 支持的入参类型:
 * - 单条 `AgentMessage`
 * - `readonly AgentMessage[]`
 *
 * 不抛错:任何 message role / content shape 异常都返回 0,不阻塞调用方。
 */

import type { AgentMessage } from "../../types.js";
import type { TokenEstimationInput } from "./types.js";

/**
 * 估算 message(s) 的 token 数。
 *
 * 语义:**先累加所有 chars,再统一 ceil(总 chars / 4)**。
 * 不是"每条单独 ceil 后累加",这样:
 * - 5 chars + 5 chars = 10 → ceil(10/4) = 3(而不是 2+2=4)
 *
 * @param input  单条 message 或 messages 数组
 * @returns      估算的 token 数(向上取整)
 */
export function estimateTokens(input: TokenEstimationInput): number {
  if (Array.isArray(input)) {
    let totalChars = 0;
    for (const m of input as readonly AgentMessage[]) {
      totalChars += countChars(m);
    }
    return Math.ceil(totalChars / 4);
  }
  return Math.ceil(countChars(input as AgentMessage) / 4);
}

/** 统计单条 message 的字符数(按 role + content 形态分支) */
function countChars(message: AgentMessage): number {
  switch (message.role) {
    case "user": {
      if (typeof message.content === "string") {
        return message.content.length;
      }
      // Array<TextContent | ImageContent>
      return message.content.reduce((sum, c) => {
        if (c.type === "text") return sum + c.text.length;
        // 图片:粗略按 1000 chars(实际 token 远大于此)
        return sum + 1000;
      }, 0);
    }
    case "assistant": {
      return message.content.reduce((sum, c) => {
        if (c.type === "text") return sum + c.text.length;
        if (c.type === "thinking") return sum + c.thinking.length;
        if (c.type === "toolCall") {
          return (
            sum +
            c.name.length +
            c.id.length +
            // arguments 可能是任意结构,用 JSON.stringify
            (c.arguments ? JSON.stringify(c.arguments).length : 0)
          );
        }
        return sum;
      }, 0);
    }
    case "toolResult": {
      // toolName + toolCallId + content
      let total = message.toolName.length + message.toolCallId.length;
      for (const c of message.content) {
        if (c.type === "text") total += c.text.length;
        else total += 1000; // image
      }
      return total;
    }
    default: {
      // 包含 "custom" 等自定义 role:用 JSON.stringify 估算
      try {
        return JSON.stringify(message).length;
      } catch {
        return 0;
      }
    }
  }
}
