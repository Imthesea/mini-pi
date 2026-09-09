import { useEffect, useState, useRef, useCallback } from "react";
import { useWebSocket } from "./useWebSocket";
import { request } from "../lib/api";
import {
  applyEvent,
  initialStreamState,
} from "../lib/message-reducer";
import { extractTextContent } from "../lib/message-content";
import type { ChatMessage } from "../lib/types";

interface UseAgentStreamOptions {
  sessionId: string;
}

interface UseAgentStreamResult {
  messages: ChatMessage[];
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

export function useAgentStream({
  sessionId,
}: UseAgentStreamOptions): UseAgentStreamResult {
  const [state, setState] = useState(initialStreamState);
  const { send, onEvent } = useWebSocket({ sessionId });

  // rAF 批处理：message_update 高频，合并到一帧
  const pendingUpdateRef = useRef<{
    content?: string | unknown[];
    thinking?: string;
  } | null>(null);
  const rafScheduledRef = useRef(false);

  // 加载历史消息
  useEffect(() => {
    request<{
      messages: Array<{
        id: string;
        message: {
          role: string;
          content: string | unknown[];
        };
      }>;
      hasMore: boolean;
    }>(`/api/sessions/${sessionId}/messages?limit=50`)
      .then((data) => {
        const history: ChatMessage[] = data.messages.map((m) => ({
          id: m.id,
          role: m.message.role as "user" | "assistant",
          content: extractTextContent(m.message.content),
        }));
        setState((prev) => ({ ...prev, messages: history }));
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
          if (m.role === "user") {
            setState((prev) =>
              applyEvent(prev, {
                type: "message_start",
                id: crypto.randomUUID(),
                role: "user",
                content: m.content,
              }),
            );
          } else {
            setState((prev) =>
              applyEvent(prev, {
                type: "message_start",
                id: crypto.randomUUID(),
                role: "assistant",
              }),
            );
          }
          break;
        }

        case "message_update": {
          const update = event.message;
          pendingUpdateRef.current = {
            content: update.content,
            thinking: update.thinking,
          };

          if (!rafScheduledRef.current) {
            rafScheduledRef.current = true;
            requestAnimationFrame(() => {
              const pending = pendingUpdateRef.current;
              pendingUpdateRef.current = null;
              rafScheduledRef.current = false;
              if (!pending) return;

              setState((prev) =>
                applyEvent(prev, {
                  type: "message_update",
                  content: pending.content,
                  thinking: pending.thinking,
                }),
              );
            });
          }
          break;
        }

        case "message_end":
          setState((prev) => applyEvent(prev, { type: "message_end" }));
          break;

        case "tool_execution_start":
          setState((prev) =>
            applyEvent(prev, {
              type: "tool_execution_start",
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              args: event.args,
            }),
          );
          break;

        case "tool_execution_end":
          setState((prev) =>
            applyEvent(prev, {
              type: "tool_execution_end",
              toolCallId: event.toolCallId,
              result: event.result,
              isError: event.isError,
            }),
          );
          break;

        case "agent_end":
          setState((prev) =>
            applyEvent(prev, {
              type: "agent_end",
              willRetry: event.willRetry,
            }),
          );
          break;
      }
    });

    return unsubscribe;
  }, [onEvent, sessionId]);

  const sendMessage = useCallback(
    (content: string) => {
      // 乐观 UI：立即显示用户消息 + 标记运行中
      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content,
      };
      setState((prev) => ({
        ...prev,
        messages: [...prev.messages, userMsg],
        isRunning: true,
      }));
      send({ type: "message", content });
    },
    [send],
  );

  const stopAgent = useCallback(() => {
    send({ type: "stop" });
  }, [send]);

  const loadMore = useCallback(() => {
    // cursor 分页：取当前最早消息的 id 作为 before
    if (state.messages.length === 0) return;
    const oldestId = state.messages[0].id;
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
        setState((prev) => ({ ...prev, messages: [...older, ...prev.messages] }));
      })
      .catch(() => { /* ignore */ });
  }, [sessionId, state.messages]);

  return {
    messages: state.messages,
    isRunning: state.isRunning,
    sendMessage,
    stopAgent,
    loadMore,
  };
}
