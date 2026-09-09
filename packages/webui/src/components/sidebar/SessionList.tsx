import { useState } from "react";
import { Plus, Trash2, ChevronLeft, Search, Folder, Settings } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { cn } from "../../lib/utils";
import { groupSessionsByCwd, workspaceLabel } from "../../lib/group-sessions";
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
  onToggleSidebar?: () => void;
  onOpenSettings?: () => void;
}

export function SessionList({
  sessions,
  activeSessionId,
  onNewSession,
  onSelectSession,
  onDeleteSession,
  onToggleSidebar,
  onOpenSettings,
}: SessionListProps) {
  const [query, setQuery] = useState("");

  // 本地按标题过滤（v1 不做后端搜索）
  const filtered = sessions.filter((s) => {
    const title = s.displayTitle || s.firstMessage || s.id;
    return title.toLowerCase().includes(query.trim().toLowerCase());
  });

  // 按 cwd 分组（Workspaces）
  const groups = groupSessionsByCwd(filtered);

  return (
    <div className="flex h-full flex-col">
      {/* 顶部：新建会话 + 折叠 */}
      <div className="flex items-center gap-1 p-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onNewSession}
          className="flex-1 justify-start gap-2"
        >
          <Plus className="h-4 w-4" />
          新建会话
        </Button>
        {onToggleSidebar && (
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label="折叠侧边栏"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* 搜索 */}
      <div className="px-2 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索会话"
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>

      {/* Workspaces 分组会话树 */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {filtered.length === 0 ? (
          <p className="px-2 py-1 text-sm text-muted-foreground">
            {query ? "无匹配会话" : "暂无会话"}
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.cwd} className="mb-1">
              <div className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-muted-foreground">
                <Folder className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate" title={group.cwd || "(未知目录)"}>
                  {workspaceLabel(group.cwd)}
                </span>
              </div>
              {group.sessions.map((s) => {
                const active = activeSessionId === s.id;
                const title = s.displayTitle || s.firstMessage || s.id;
                return (
                  <div
                    key={s.id}
                    onClick={() => onSelectSession(s.id)}
                    className={cn(
                      "group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                      active ? "bg-accent" : "hover:bg-muted",
                    )}
                  >
                    <span
                      className={cn(
                        "h-4 w-0.5 shrink-0 rounded-full bg-info transition-opacity",
                        active ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="flex-1 truncate">{title}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteSession(s.id);
                      }}
                      aria-label="删除会话"
                      className="hidden rounded p-0.5 hover:bg-border group-hover:block"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      {/* 底部 Settings */}
      {onOpenSettings && (
        <div className="border-t border-border p-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenSettings}
            className="w-full justify-start gap-2 text-muted-foreground"
          >
            <Settings className="h-4 w-4" />
            设置
          </Button>
        </div>
      )}
    </div>
  );
}
