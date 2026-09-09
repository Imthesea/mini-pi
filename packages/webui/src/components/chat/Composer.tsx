import { useState, useRef, useCallback } from "react";
import { Send, Square } from "lucide-react";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";

interface ComposerProps {
  isRunning: boolean;
  currentModel: string;
  accessMode: string;
  onSend: (content: string) => void;
  onStop: () => void;
}

export function Composer({
  isRunning,
  currentModel,
  accessMode,
  onSend,
  onStop,
}: ComposerProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue("");
    // 重置 textarea 高度
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [value, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t border-border bg-background p-3">
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="输入消息 (Enter 发送, Shift+Enter 换行)"
        className="min-h-[40px]"
        rows={1}
        disabled={isRunning}
      />

      <div className="mt-2 flex items-center gap-2">
        {/* Commands / 访问模式 / 模型：v1 只读展示，点击 no-op */}
        <Button variant="ghost" size="sm" type="button">
          Commands
        </Button>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" type="button">
          {accessMode}
        </Button>
        <Button variant="ghost" size="sm" type="button">
          {currentModel}
        </Button>
        {isRunning ? (
          <Button
            variant="outline"
            size="sm"
            type="button"
            aria-label="停止"
            onClick={onStop}
          >
            <Square className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            size="sm"
            type="button"
            aria-label="发送"
            onClick={handleSend}
            disabled={!value.trim()}
          >
            <Send className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
