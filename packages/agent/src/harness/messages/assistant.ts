/**
 * buildAssistantMessage —— 从 AssistantMessageEvent 流重建 AssistantMessage。
 *
 * 这是 harness 层的"消息重建"工具,主要给 compaction / branch summary
 * 等需要从事件流重建消息的场景使用。
 *
 * 契约(与 AI 层 buildAssistantMessage 一致):
 * - content 数组严格按 text → thinking → tools 顺序排列
 * - 终态 AssistantMessage 来自事件的最后一个 "done" 事件的 message 字段
 * - 空 events → 空 content 的 AssistantMessage
 *
 * 注意:本函数**不**消费 AssistantMessageEventStream(那是 EventStream 的范畴),
 * 这里接收的是事件数组。流式处理在 agent-loop 中已有独立实现。
 */

import type {
  AssistantMessage,
  AssistantMessageEvent,
  Model,
} from "@mimi/ai";

/**
 * 从事件列表重建 AssistantMessage。
 *
 * 终态消息 = events 中最后一个 `done` 事件的 `message` 字段。
 * 若 events 中没有 `done` 事件,基于 model 构造一个空 content 的占位 message。
 *
 * @param events 事件列表(可来自 AssistantMessageEventStream.result() 之前的累积)
 * @param model 用于构造 fallback 消息
 */
export function buildAssistantMessage(
  events: AssistantMessageEvent[],
  model: Model<any>,
): AssistantMessage {
  // 找到最后一个 done 事件
  let finalMessage: AssistantMessage | undefined;
  for (const evt of events) {
    if (evt.type === "done") {
      finalMessage = evt.message;
    }
  }

  if (finalMessage) {
    return finalMessage;
  }

  // 没有 done 事件 → 构造一个空 content 的占位
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: { input: 0, output: 0, totalTokens: 0, cost: { input: 0, output: 0, total: 0 } },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}
