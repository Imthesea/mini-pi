import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { MarkdownRenderer } from "../MarkdownRenderer";
import type { ChatMessage } from "../../lib/types";

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-lg px-4 py-2 text-sm ${
          isUser
            ? "bg-blue-500 text-white"
            : "text-black"
        }`}
      >
        {/* Thinking block */}
        {message.thinkingContent && (
          <div className="mb-2">
            <button
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setThinkingOpen(!thinkingOpen)}
            >
              {thinkingOpen ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              思考过程
            </button>
            {thinkingOpen && (
              <div className="mt-1 border-l-2 border-border pl-3 text-xs text-muted-foreground whitespace-pre-wrap">
                {message.thinkingContent}
              </div>
            )}
          </div>
        )}

        {/* Content */}
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <MarkdownRenderer content={message.content} />
        )}
      </div>
    </div>
  );
}
