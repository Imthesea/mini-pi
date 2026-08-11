import { useEffect, useState, useRef, useCallback } from "react";
import { useWebSocket } from "./useWebSocket";
import { request } from "../lib/api";
import type { ChatMessage, ToolCallState } from "../lib/types";

interface UseAgentStreamOptions {
  sessionId: string;
}

interface UseAgentStreamResult {
  messages: ChatMessage[];
  activeTools: ToolCallState[];
  isRunning: boolean;
  sendMessage: (content: string) => void;
  stopAgent: () => void;
  loadMore: () => void;
}

// ── WS 事件类型（来自 AgentSessionEvent） ──

interface WsMessageStartEvent {
  type: "message_start";
  message: {
    id: string;
    role: string;
    content?: string | unknown[];
    provider?: string;
    model?: string;
    usage?: unknown;
    thinking?: string;
  };
}

interface WsMessageUpdateEvent {
  type: "message_update";
  message: {
    id: string;
    role: string;
    content?: unknown[];
    thinking?: string;
  };
}

interface WsMessageEndEvent {
  type: "message_end";
  message: { id: string };
}

interface WsToolStartEvent {
  type: "tool_execution_start";
  toolCallId: string;
  toolName: string;
  args: unknown;
}

interface WsToolEndEvent {
  type: "tool_execution_end";
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError: boolean;
}

interface WsAgentEndEvent {
  type: "agent_end";
  messages: unknown[];
  willRetry: boolean;
}

type WsEvent =
  | WsMessageStartEvent
  | WsMessageUpdateEvent
  | WsMessageEndEvent
  | WsToolStartEvent
  | WsToolEndEvent
  | WsAgentEndEvent;

// ── 工具函数 ──

function extractTextContent(
  content: string | unknown[] | undefined,
): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("");
  }
  return "";
}

export function useAgentStream({
  sessionId,
}: UseAgentStreamOptions): UseAgentStreamResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeTools, setActiveTools] = useState<ToolCallState[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const { send, onEvent } = useWebSocket({ sessionId });

  // rAF 批处理 refs
  const pendingUpdateRef = useRef<{
    messageId: string;
    content?: string;
    thinking?: string;
  } | null>(null);
  const rafScheduledRef = useRef(false);

  // 加载历史消息
  useEffect(() => {
    request<{
      messages: Array<{
        id: string;
        role: string;
        content: string;
      }>;
      hasMore: boolean;
    }>(`/api/sessions/${sessionId}/messages?limit=50`)
      .then((data) => {
        const history: ChatMessage[] = data.messages.map((m) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          content: extractTextContent(m.content),
        }));
        setMessages(history);
      })
      .catch(() => { /* ignore */ });
  }, [sessionId]);

  // 监听 WS 事件
  useEffect(() => {
    const unsubscribe = onEvent((raw) => {
      const event = raw as WsEvent;

      switch (event.type) {
        case "message_start": {
          const m = event.message;
          setMessages((prev) => {
            const exists = prev.find((p) => p.id === m.id);
            if (exists) return prev;
            const newMsg: ChatMessage = {
              id: m.id,
              role: m.role as "user" | "assistant",
              content: m.role === "assistant" ? "" : extractTextContent(m.content),
            };
            return [...prev, newMsg];
          });
          break;
        }

        case "message_update": {
          const update = event.message;
          pendingUpdateRef.current = {
            messageId: update.id,
            content: update.content ? extractTextContent(update.content) : undefined,
            thinking: update.thinking,
          };

          if (!rafScheduledRef.current) {
            rafScheduledRef.current = true;
            requestAnimationFrame(() => {
              const pending = pendingUpdateRef.current;
              pendingUpdateRef.current = null;
              rafScheduledRef.current = false;
              if (!pending) return;

              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== pending.messageId) return m;
                  return {
                    ...m,
                    content: pending.content ?? m.content,
                    thinkingContent: pending.thinking ?? m.thinkingContent,
                  };
                }),
              );
            });
          }
          break;
        }

        case "message_end": {
          // 消息完成 — 无需额外处理，message_update 已同步内容
          break;
        }

        case "tool_execution_start":
          setActiveTools((prev) => {
            const exists = prev.find(
              (t) => t.toolCallId === event.toolCallId,
            );
            if (exists) return prev;
            return [
              ...prev,
              {
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                status: "running",
                args: event.args as Record<string, unknown>,
              },
            ];
          });
          break;

        case "tool_execution_end":
          setActiveTools((prev) =>
            prev.map((t) =>
              t.toolCallId === event.toolCallId
                ? { ...t, status: event.isError ? "error" : "done" }
                : t,
            ),
          );
          break;

        case "agent_end":
          if (!event.willRetry) {
            setIsRunning(false);
          }
          break;
      }
    });

    return unsubscribe;
  }, [onEvent, sessionId]);

  const sendMessage = useCallback(
    (content: string) => {
      send({ type: "message", content });
    },
    [send],
  );

  const stopAgent = useCallback(() => {
    send({ type: "stop" });
  }, [send]);

  const loadMore = useCallback(() => {
    // cursor 分页：取当前最早消息的 id 作为 before
    if (messages.length === 0) return;
    const oldestId = messages[0].id;
    request<{
      messages: Array<{
        id: string;
        role: string;
        content: string;
      }>;
      hasMore: boolean;
    }>(
      `/api/sessions/${sessionId}/messages?limit=50&before=${oldestId}`,
    )
      .then((data) => {
        const older: ChatMessage[] = data.messages
          .reverse()
          .map((m) => ({
            id: m.id,
            role: m.role as "user" | "assistant",
            content: extractTextContent(m.content),
          }));
        setMessages((prev) => [...older, ...prev]);
      })
      .catch(() => { /* ignore */ });
  }, [sessionId, messages]);

  return { messages, activeTools, isRunning, sendMessage, stopAgent, loadMore };
}
