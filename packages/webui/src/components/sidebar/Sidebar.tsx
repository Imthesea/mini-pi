import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

interface SidebarProps {
  children: ReactNode;
  className?: string;
}

export function Sidebar({ children, className }: SidebarProps) {
  return (
    <aside className={cn("flex h-full min-h-0 flex-col", className)}>
      {children}
    </aside>
  );
}
