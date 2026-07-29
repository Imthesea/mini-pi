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
 */
export function transformMessages(messages: Message[], model: Model<Api>): Message[] {
  // 如果模型支持图片，不做任何处理
  if (model.input.includes("image")) return messages;

  // 非视觉模型：图片降级为占位文本
  return messages.map((msg) => {
    if (msg.role !== "user") return msg;
    if (typeof msg.content === "string") return msg;

    const hasImage = msg.content.some((c) => c.type === "image");
    if (!hasImage) return msg;

    return {
      ...msg,
      content: msg.content.map((c) => {
        if (c.type === "image") return { type: "text" as const, text: "[图片]" };
        return c;
      }),
    };
  });
}
