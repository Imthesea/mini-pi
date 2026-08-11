import type { ToolCallState } from "../../lib/types";

interface ToolCardProps {
  tool: ToolCallState;
}

const statusConfig = {
  running: { icon: "⏳", color: "text-yellow-600", bg: "bg-yellow-50" },
  done: { icon: "✅", color: "text-green-600", bg: "bg-green-50" },
  error: { icon: "❌", color: "text-red-600", bg: "bg-red-50" },
};

export function ToolCard({ tool }: ToolCardProps) {
  const config = statusConfig[tool.status];

  return (
    <div
      className={`flex items-center gap-2 rounded border border-border px-3 py-1.5 text-sm ${config.bg}`}
    >
      <span className={config.color}>{config.icon}</span>
      <span className="font-mono text-xs">{tool.toolName}</span>
    </div>
  );
}
