import { UserMessage } from "./UserMessage";
import { AssistantMessage } from "./AssistantMessage";
import type { ChatMessage, ToolCallState } from "../../lib/types";

interface MessageFlowProps {
  messages: ChatMessage[];
  isRunning: boolean;
  onSelectTool: (tool: ToolCallState) => void;
}

export function MessageFlow({
  messages,
  isRunning,
  onSelectTool,
}: MessageFlowProps) {
  const isEmpty = messages.length === 0;

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        {isEmpty && !isRunning && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            发送消息开始对话
          </div>
        )}

        {messages.map((msg) =>
          msg.role === "user" ? (
            <UserMessage key={msg.id} message={msg} />
          ) : (
            <AssistantMessage
              key={msg.id}
              message={msg}
              onSelectTool={onSelectTool}
            />
          ),
        )}
      </div>
    </div>
  );
}
