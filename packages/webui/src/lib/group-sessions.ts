/**
 * 会话分组工具：按 cwd 把会话分组为 Workspaces。
 */

export interface SessionGroup<T> {
  cwd: string;
  sessions: T[];
}

/** 按 cwd 分组；cwd 为空归入空字符串组（渲染时显示「(未知目录)」） */
export function groupSessionsByCwd<T extends { cwd: string }>(
  sessions: T[],
): SessionGroup<T>[] {
  const map = new Map<string, T[]>();
  for (const s of sessions) {
    const cwd = s.cwd || "";
    const bucket = map.get(cwd);
    if (bucket) bucket.push(s);
    else map.set(cwd, [s]);
  }
  return Array.from(map.entries()).map(([cwd, sessions]) => ({ cwd, sessions }));
}

/** workspace 标题：取 cwd 最后一段路径作为展示名 */
export function workspaceLabel(cwd: string): string {
  if (!cwd) return "(未知目录)";
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? cwd;
}
