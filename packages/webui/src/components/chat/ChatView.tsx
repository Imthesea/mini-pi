import { useAgentStream } from "../../hooks/useAgentStream";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";

interface ChatViewProps {
  sessionId: string;
  onFirstUserMessage?: (content: string) => void;
}

export function ChatView({ sessionId, onFirstUserMessage }: ChatViewProps) {
  const { messages, activeTools, isRunning, sendMessage, stopAgent } =
    useAgentStream({ sessionId });

  const handleSend = (content: string) => {
    onFirstUserMessage?.(content);
    sendMessage(content);
  };

  return (
    <div className="flex h-full flex-col">
      <MessageList messages={messages} activeTools={activeTools} />
      <Composer
        isRunning={isRunning}
        onSend={handleSend}
        onStop={stopAgent}
      />
    </div>
  );
}
