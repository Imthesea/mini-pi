import { Plus, Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import type { SessionInfo } from "../../lib/types";

interface SessionItem extends SessionInfo {
  displayTitle?: string;
}

interface SessionListProps {
  sessions: SessionItem[];
  activeSessionId: string | null;
  onNewSession: () => void;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
}

export function SessionList({
  sessions,
  activeSessionId,
  onNewSession,
  onSelectSession,
  onDeleteSession,
}: SessionListProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border p-3">
        <span className="text-sm font-medium">会话</span>
        <Button variant="ghost" size="sm" onClick={onNewSession}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {sessions.length === 0 ? (
          <p className="p-2 text-sm text-muted-foreground">暂无会话</p>
        ) : (
          sessions.map((s) => (
            <div
              key={s.id}
              className={`group flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted ${
                activeSessionId === s.id ? "bg-muted" : ""
              }`}
              onClick={() => onSelectSession(s.id)}
            >
              <span className="truncate">{s.displayTitle || s.firstMessage || s.id}</span>
              <button
                className="hidden rounded p-0.5 hover:bg-border group-hover:block"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteSession(s.id);
                }}
              >
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
