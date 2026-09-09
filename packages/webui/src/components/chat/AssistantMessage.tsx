import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { MarkdownRenderer } from "../MarkdownRenderer";
import { ToolRow } from "./ToolRow";
import type { ChatMessage, ToolCallState } from "../../lib/types";

interface AssistantMessageProps {
  message: ChatMessage;
  onSelectTool: (tool: ToolCallState) => void;
}

export function AssistantMessage({
  message,
  onSelectTool,
}: AssistantMessageProps) {
  const [thinkingOpen, setThinkingOpen] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      {message.thinkingContent && (
        <div>
          <button
            type="button"
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
            <div className="mt-1 border-l-2 border-border pl-3 text-xs whitespace-pre-wrap text-muted-foreground">
              {message.thinkingContent}
            </div>
          )}
        </div>
      )}

      {message.toolCalls?.map((tool) => (
        <ToolRow
          key={tool.toolCallId}
          tool={tool}
          onClick={() => onSelectTool(tool)}
        />
      ))}

      {message.content && <MarkdownRenderer content={message.content} />}
    </div>
  );
}
