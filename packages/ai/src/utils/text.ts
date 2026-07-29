/**
 * 文本相关的辅助函数。
 */

import type { TextContent } from "../types.js";

/** 从内容块数组中提取纯文本 */
export function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c): c is TextContent => typeof c === "object" && c !== null && (c as any).type === "text")
      .map((c) => c.text)
      .join("");
  }
  return "";
}
