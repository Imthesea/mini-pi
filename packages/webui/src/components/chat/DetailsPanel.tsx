import { X } from "lucide-react";
import type { ToolCallState } from "../../lib/types";

interface DetailsPanelProps {
  tool: ToolCallState | null;
  onClose: () => void;
}

export function DetailsPanel({ tool, onClose }: DetailsPanelProps) {
  return (
    <div className="flex h-full flex-col border-l border-border">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Details</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭详情"
          className="rounded p-1 text-muted-foreground hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {!tool ? (
        <div className="p-4 text-sm text-muted-foreground">
          点击工具行查看详情
        </div>
      ) : (
        <div className="flex flex-col gap-4 overflow-y-auto p-4">
          <div>
            <div className="text-xs text-muted-foreground">工具</div>
            <div className="font-mono text-sm">{tool.toolName}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">参数</div>
            <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">
              {JSON.stringify(tool.args ?? {}, null, 2)}
            </pre>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">结果</div>
            {tool.result === undefined ? (
              <div className="text-xs text-muted-foreground">
                result 待后端补齐
              </div>
            ) : (
              <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">
                {JSON.stringify(tool.result, null, 2)}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
