import { useState, useCallback } from "react";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import type { ChatMessage, ToolCallState } from "../../lib/types";

interface ChatViewProps {
  sessionId: string;
}

export function ChatView({ sessionId }: ChatViewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeTools, setActiveTools] = useState<ToolCallState[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const handleSend = useCallback(
    (content: string) => {
      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content,
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsRunning(true);
      // Phase 7: WebSocket 集成 — 发送消息到 agent
    },
    [],
  );

  const handleStop = useCallback(() => {
    setIsRunning(false);
    // Phase 7: WebSocket 集成 — 发送 stop 到 agent
  }, []);

  return (
    <div className="flex h-full flex-col">
      <MessageList messages={messages} activeTools={activeTools} />
      <Composer isRunning={isRunning} onSend={handleSend} onStop={handleStop} />
    </div>
  );
}
