import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "../lib/utils";

interface AppFrameProps {
  /** 侧边栏内容（含其内部的折叠按钮） */
  sidebar: ReactNode;
  /** 侧边栏是否折叠为窄 rail */
  sidebarCollapsed: boolean;
  /** 折叠/展开侧边栏 */
  onToggleSidebar: () => void;
  /** 主区内容（对话流） */
  conversation: ReactNode;
  /** 详情列内容；不传 = 收起 */
  details?: ReactNode;
}

/**
 * 三栏布局骨架（参考 deepseek-harness）：
 * 侧边栏 | 主区 | 详情列。
 * 折叠按钮由侧边栏内部（SessionList header）提供；折叠态窄 rail 的展开按钮由本组件渲染。
 * v1 只支持侧边栏折叠，不做拖拽调整宽度。
 */
export function AppFrame({
  sidebar,
  sidebarCollapsed,
  onToggleSidebar,
  conversation,
  details,
}: AppFrameProps) {
  return (
    <div className="flex h-screen overflow-hidden">
      {/* 侧边栏列：展开显示完整侧边栏，折叠显示窄 rail */}
      <div
        className={cn(
          "flex h-full flex-col border-r border-border bg-sidebar transition-[width] duration-200 ease-in-out",
          sidebarCollapsed ? "w-12" : "w-64",
        )}
      >
        {sidebarCollapsed ? (
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label="展开侧边栏"
            className="flex h-10 w-full shrink-0 items-center justify-center text-muted-foreground hover:bg-muted"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        ) : (
          <div className="min-h-0 flex-1">{sidebar}</div>
        )}
      </div>

      {/* 主区 */}
      <main className="flex min-w-0 flex-1 flex-col bg-background">
        {conversation}
      </main>

      {/* 详情列 */}
      {details != null && (
        <aside className="flex h-full w-80 flex-col border-l border-border bg-background">
          {details}
        </aside>
      )}
    </div>
  );
}
