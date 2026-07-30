/**
 * agent-harness 辅助函数。
 *
 * 纯函数,不依赖 AgentHarness 内部状态。
 * 为什么从 agent-harness.ts 拆出来:减少主文件行数,且可独立测试。
 */

import type { ImageContent, TextContent } from "@mimi/ai";

/** 构造 user 消息 content(支持文本 + 图片) */
export function buildUserContent(
  text: string,
  images?: Array<{ data: string; mimeType: string }>,
): string | (TextContent | ImageContent)[] {
  if (!images || images.length === 0) return text;
  const content: (TextContent | ImageContent)[] = [{ type: "text", text }];
  for (const img of images) {
    content.push({
      type: "image",
      data: img.data,
      mimeType: img.mimeType as ImageContent["mimeType"],
    });
  }
  return content;
}

/**
 * 提取 sessionId(各种形态兜底)。
 * Task 5 接入真正 Session 类后可简化为 session.id。
 */
export function extractSessionId(session: any): string {
  if (!session) return "default";
  if (typeof session === "string") return session;
  if (typeof session.id === "string") return session.id;
  if (typeof session.sessionId === "string") return session.sessionId;
  return "default";
}
