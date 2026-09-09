import type { ChatMessage, ToolCallState } from "./types";
import { extractTextContent } from "./message-content";

export interface StreamState {
  messages: ChatMessage[];
  streamingId: string | null;
  isRunning: boolean;
}

export type StreamEvent =
  | {
      type: "message_start";
      id: string;
      role: "user" | "assistant";
      content?: string | unknown[];
    }
  | { type: "message_update"; content?: string | unknown[]; thinking?: string }
  | { type: "message_end" }
  | {
      type: "tool_execution_start";
      toolCallId: string;
      toolName: string;
      args: unknown;
    }
  | {
      type: "tool_execution_end";
      toolCallId: string;
      result: unknown;
      isError: boolean;
    }
  | { type: "agent_end"; willRetry: boolean };

export const initialStreamState: StreamState = {
  messages: [],
  streamingId: null,
  isRunning: false,
};

/**
 * 消息流状态机（纯函数）：把 WS 事件折算成下一份状态。
 * 工具不再平铺，而是内嵌到当前 streaming 的 assistant 消息 `toolCalls`。
 */
export function applyEvent(state: StreamState, event: StreamEvent): StreamState {
  switch (event.type) {
    case "message_start": {
      if (event.role === "user") {
        const withoutOptimistic = state.messages.filter(
          (m) => !m.id.startsWith("user-"),
        );
        return {
          ...state,
          messages: [
            ...withoutOptimistic,
            {
              id: event.id,
              role: "user",
              content: extractTextContent(event.content),
            },
          ],
        };
      }
      const assistant: ChatMessage = {
        id: event.id,
        role: "assistant",
        content: "",
      };
      return {
        ...state,
        streamingId: event.id,
        messages: [...state.messages, assistant],
      };
    }

    case "message_update": {
      if (!state.streamingId) return state;
      const messages = state.messages.map((m) => {
        if (m.id !== state.streamingId) return m;
        return {
          ...m,
          content:
            event.content !== undefined
              ? extractTextContent(event.content)
              : m.content,
          thinkingContent:
            event.thinking !== undefined ? event.thinking : m.thinkingContent,
        };
      });
      return { ...state, messages };
    }

    case "message_end":
      return { ...state, streamingId: null };

    case "tool_execution_start": {
      if (!state.streamingId) return state;
      let changed = false;
      const messages = state.messages.map((m) => {
        if (m.id !== state.streamingId) return m;
        const toolCalls = m.toolCalls ?? [];
        if (toolCalls.some((t) => t.toolCallId === event.toolCallId)) return m;
        changed = true;
        const tool: ToolCallState = {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          status: "running",
          args: event.args as Record<string, unknown>,
        };
        return { ...m, toolCalls: [...toolCalls, tool] };
      });
      return changed ? { ...state, messages } : state;
    }

    case "tool_execution_end": {
      let changed = false;
      const messages = state.messages.map((m) => {
        const toolCalls = m.toolCalls;
        if (!toolCalls) return m;
        let toolChanged = false;
        const updated: ToolCallState[] = toolCalls.map((t) => {
          if (t.toolCallId !== event.toolCallId) return t;
          toolChanged = true;
          changed = true;
          return {
            ...t,
            status: event.isError ? "error" : "done",
            result: event.result,
          };
        });
        return toolChanged ? { ...m, toolCalls: updated } : m;
      });
      return changed ? { ...state, messages } : state;
    }

    case "agent_end":
      return event.willRetry ? state : { ...state, isRunning: false };
  }
}
