import { useAgentStream } from "../../hooks/useAgentStream";
import { MessageFlow } from "./MessageFlow";
import { Composer } from "./Composer";
import type { ToolCallState } from "../../lib/types";

interface ChatViewProps {
  sessionId: string;
  onFirstUserMessage?: (content: string) => void;
  onSelectTool: (tool: ToolCallState) => void;
}

export function ChatView({
  sessionId,
  onFirstUserMessage,
  onSelectTool,
}: ChatViewProps) {
  const { messages, isRunning, sendMessage, stopAgent } = useAgentStream({
    sessionId,
  });

  const handleSend = (content: string) => {
    onFirstUserMessage?.(content);
    sendMessage(content);
  };

  return (
    <div className="flex h-full flex-col">
      <MessageFlow
        messages={messages}
        isRunning={isRunning}
        onSelectTool={onSelectTool}
      />
      <Composer
        isRunning={isRunning}
        onSend={handleSend}
        onStop={stopAgent}
      />
    </div>
  );
}
