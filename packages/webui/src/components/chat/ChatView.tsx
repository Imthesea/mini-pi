import { useAgentStream } from "../../hooks/useAgentStream";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";

interface ChatViewProps {
  sessionId: string;
}

export function ChatView({ sessionId }: ChatViewProps) {
  const { messages, activeTools, isRunning, sendMessage, stopAgent } =
    useAgentStream({ sessionId });

  return (
    <div className="flex h-full flex-col">
      <MessageList messages={messages} activeTools={activeTools} />
      <Composer
        isRunning={isRunning}
        onSend={sendMessage}
        onStop={stopAgent}
      />
    </div>
  );
}
