import { useEffect, useRef } from "react";
import { MessageBubble } from "./MessageBubble";
import { ToolCard } from "./ToolCard";
import type { ChatMessage, ToolCallState } from "../../lib/types";

interface MessageListProps {
  messages: ChatMessage[];
  activeTools: ToolCallState[];
}

export function MessageList({ messages, activeTools }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, activeTools]);

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        {messages.length === 0 && activeTools.length === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            发送消息开始对话
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {activeTools.map((tool) => (
          <div key={tool.toolCallId} className="flex justify-start">
            <ToolCard tool={tool} />
          </div>
        ))}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
