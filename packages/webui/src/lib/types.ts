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

export interface SettingsView {
  theme: string | null;
  defaultModel: string | null;
  defaultProvider: string | null;
  defaultThinkingLevel: string | null;
  compaction: { enabled: boolean; reserveTokens: number; keepRecentTokens: number };
  retry: { enabled: boolean; maxRetries: number; baseDelayMs: number };
  transport: string;
}

export interface SettingsPatch {
  theme?: string;
  defaultModel?: string;
  defaultProvider?: string;
  defaultThinkingLevel?: string;
  transport?: string;
  compaction?: { enabled?: boolean };
  retry?: { enabled?: boolean };
}
