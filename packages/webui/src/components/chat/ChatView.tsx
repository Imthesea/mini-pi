import { useEffect, useState } from "react";
import { useAgentStream } from "../../hooks/useAgentStream";
import { MessageFlow } from "./MessageFlow";
import { Composer } from "./Composer";
import { Hero } from "./Hero";
import { fetchSettings } from "../../lib/settings-api";
import type { ToolCallState } from "../../lib/types";

/** v1 访问模式写死为可写工作区；后续接入权限配置 */
const ACCESS_MODE = "Workspace Write";

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
  // 模型名只读展示，来自全局默认模型
  const [currentModel, setCurrentModel] = useState("auto");

  useEffect(() => {
    fetchSettings()
      .then((s) => setCurrentModel(s.defaultModel ?? "auto"))
      .catch(() => {
        /* ignore */
      });
  }, []);

  const handleSend = (content: string) => {
    onFirstUserMessage?.(content);
    sendMessage(content);
  };

  const isEmpty = messages.length === 0 && !isRunning;

  return (
    <div className="flex h-full flex-col">
      {isEmpty ? (
        <Hero
          currentModel={currentModel}
          accessMode={ACCESS_MODE}
          onSend={handleSend}
        />
      ) : (
        <>
          <MessageFlow
            messages={messages}
            isRunning={isRunning}
            onSelectTool={onSelectTool}
          />
          <Composer
            isRunning={isRunning}
            currentModel={currentModel}
            accessMode={ACCESS_MODE}
            onSend={handleSend}
            onStop={stopAgent}
          />
        </>
      )}
    </div>
  );
}
