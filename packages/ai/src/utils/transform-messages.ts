/**
 * 消息规范化：将统一格式的 Message 列表做预处理。
 * 目前只做图片降级——非视觉模型会将图片替换为占位文本。
 *
 * 后续可扩展：工具调用 ID 规范化、思考块跨 Provider 转换等。
 */

import type { Message, Model, Api } from "../types.js";

/**
 * 规范化消息列表，供各 API 实现调用。
 * 非视觉模型的图片内容会被替换为 "[图片]" 占位文本。
 *
 * 处理范围：
 *  - user 消息中的图片块
 *  - toolResult 消息中的图片块（多轮对话中工具返回截图等场景）
 */
export function transformMessages(messages: Message[], model: Model<Api>): Message[] {
  // 如果模型支持图片，不做任何处理
  if (model.input.includes("image")) return messages;

  // 非视觉模型：图片降级为占位文本
  return messages.map((msg) => {
    if (msg.role === "user") {
      if (typeof msg.content === "string") return msg;
      return downgradeImagesInContent(msg);
    }
    if (msg.role === "toolResult") {
      return downgradeImagesInContent(msg);
    }
    // assistant 消息：content 联合类型不含 image，理论上不需要处理
    return msg;
  });
}

/** 把 content 数组中的 image 块替换为 "[图片]" 占位文本，保留其它块和顺序 */
function downgradeImagesInContent<
  T extends { content: string | readonly { type: string }[] },
>(msg: T): T {
  if (typeof msg.content === "string") return msg;
  const hasImage = msg.content.some((c) => c.type === "image");
  if (!hasImage) return msg;

  return {
    ...msg,
    content: msg.content.map((c) =>
      c.type === "image" ? { type: "text" as const, text: "[图片]" } : c,
    ) as T["content"],
  };
}
