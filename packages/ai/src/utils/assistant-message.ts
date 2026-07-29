/**
 * AssistantMessage 辅助构造器。
 * 用于错误响应——当请求失败时构造一个 stopReason="error" 的最小化 AssistantMessage。
 */

import type { AssistantMessage, Model } from "../types.js";

/** 创建一个错误状态的 AssistantMessage（空 content + errorMessage + stopReason="error"） */
export function createErrorAssistantMessage(
  model: Model<any>,
  errorMessage: string,
): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: { input: 0, output: 0, totalTokens: 0, cost: { input: 0, output: 0, total: 0 } },
    stopReason: "error",
    errorMessage,
    timestamp: Date.now(),
  };
}
