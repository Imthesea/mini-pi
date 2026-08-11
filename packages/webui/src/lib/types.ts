export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  thinkingContent?: string;
}

export interface ToolCallState {
  toolCallId: string;
  toolName: string;
  status: "running" | "done" | "error";
  args?: Record<string, unknown>;
}

export interface SessionInfo {
  id: string;
  title: string;
  messageCount: number;
  firstMessage: string;
  cwd: string;
}
