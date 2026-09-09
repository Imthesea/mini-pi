import { Copy } from "lucide-react";
import type { ChatMessage } from "../../lib/types";

interface UserMessageProps {
  message: ChatMessage;
}

export function UserMessage({ message }: UserMessageProps) {
  const handleCopy = () => {
    navigator.clipboard?.writeText(message.content);
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">你</span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label="复制"
          className="rounded p-1 text-muted-foreground hover:bg-muted"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="whitespace-pre-wrap text-sm">{message.content}</p>
    </div>
  );
}
