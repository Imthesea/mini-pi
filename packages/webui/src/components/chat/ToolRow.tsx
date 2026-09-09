import { Check, X, Loader2, ChevronRight } from "lucide-react";
import { summarizeToolArgs } from "../../lib/tool-args";
import type { ToolCallState } from "../../lib/types";

interface ToolRowProps {
  tool: ToolCallState;
  onClick: () => void;
}

export function ToolRow({ tool, onClick }: ToolRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm hover:bg-muted"
    >
      <StatusIcon status={tool.status} />
      <span className="font-mono text-xs">
        {summarizeToolArgs(tool.toolName, tool.args)}
      </span>
      <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground" />
    </button>
  );
}

function StatusIcon({ status }: { status: ToolCallState["status"] }) {
  if (status === "running") {
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-info" />;
  }
  if (status === "done") {
    return <Check className="h-3.5 w-3.5 text-success" />;
  }
  return <X className="h-3.5 w-3.5 text-danger" />;
}
