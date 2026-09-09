function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

/**
 * 工具行参数摘要：优先展示文件路径（取 basename）或命令，
 * 都没有则只返回工具名。
 */
export function summarizeToolArgs(
  toolName: string,
  args?: Record<string, unknown>,
): string {
  if (!args) return toolName;

  const filePath = args.filePath ?? args.path ?? args.file;
  if (typeof filePath === "string" && filePath !== "") {
    return `${toolName} ${basename(filePath)}`;
  }

  const command = args.command;
  if (typeof command === "string" && command !== "") {
    return `${toolName} ${command}`;
  }

  return toolName;
}
