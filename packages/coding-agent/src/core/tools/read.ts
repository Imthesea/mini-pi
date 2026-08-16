/**
 * read_file 工具。
 * 对齐 pi 项目 core/tools/read.ts（V1 最小化，去掉 TUI/扩展/render）。
 */

import type { AgentTool } from "@mimi/agent";
import { Type, type Static } from "typebox";
import { readFile } from "node:fs/promises";
import { resolve, sep, isAbsolute } from "node:path";

const ReadParams = Type.Object({
  path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
  offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed)" })),
  limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
});

type ReadParams = Static<typeof ReadParams>;

function isPathSafe(cwd: string, inputPath: string): boolean {
  if (isAbsolute(inputPath)) return false;
  const resolved = resolve(cwd, inputPath);
  return resolved.startsWith(cwd + sep) || resolved === cwd;
}

export function createReadTool(cwd: string): AgentTool<typeof ReadParams, { isError?: boolean }> {
  return {
    name: "read_file",
    label: "Read File",
    description:
      "Read the contents of a file. Supports text files. Use offset/limit for large files.",
    parameters: ReadParams,
    async execute(_toolCallId, params) {
      if (!isPathSafe(cwd, params.path)) {
        return {
          content: [
            { type: "text", text: `Error: Path escapes cwd: ${params.path}` },
          ],
          details: { isError: true },
        };
      }
      try {
        let content = await readFile(resolve(cwd, params.path), "utf-8");
        const lines = content.split("\n");
        const start = params.offset ? Math.max(0, params.offset - 1) : 0;
        const end =
          params.limit !== undefined
            ? Math.min(start + params.limit, lines.length)
            : lines.length;
        content = lines.slice(start, end).join("\n");
        return { content: [{ type: "text", text: content }], details: {} };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `Error: ${e.message}` }],
          details: { isError: true },
        };
      }
    },
  };
}
