import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

interface SidebarProps {
  children: ReactNode;
  className?: string;
}

export function Sidebar({ children, className }: SidebarProps) {
  return (
    <aside
      className={cn(
        "flex h-full w-64 flex-col border-r border-border bg-background",
        className,
      )}
    >
      {children}
    </aside>
  );
}
