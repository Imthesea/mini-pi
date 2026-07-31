/**
 * agent-harness 辅助函数。
 *
 * 纯函数,不依赖 AgentHarness 内部状态。
 * 为什么从 agent-harness.ts 拆出来:减少主文件行数,且可独立测试。
 */

import type { ImageContent, TextContent } from "@mimi/ai";
import type { Session } from "../session/session.js";

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
 *
 * 兼容:
 * - Session 类(从 getMetadata() 同步拿 id 需要 promise,这里用兜底)
 *   实际上 Session.getMetadata() 是 async,所以这里只接受**同步可拿**的 session
 * - string:直接作为 id
 * - { id: string } / { sessionId: string }:取字段
 * - null/undefined:返回 "default"
 *
 * 注:对于真正的 Session 类(用 getMetadata().id),请直接 await session.getMetadata(),
 *   或用 facade.getId()(handler 内)。
 */
export function extractSessionId(session: Session<any> | string | { id?: string; sessionId?: string } | null | undefined): string {
  if (!session) return "default";
  if (typeof session === "string") return session;
  if (typeof (session as any).id === "string") return (session as any).id;
  if (typeof (session as any).sessionId === "string") return (session as any).sessionId;
  // Session 类无同步 id 字段,兜底用 "default"
  return "default";
}

