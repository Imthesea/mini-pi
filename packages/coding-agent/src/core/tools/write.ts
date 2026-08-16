import type { AgentTool } from "@mimi/agent";
import { Type, type Static } from "typebox";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve, sep, isAbsolute, dirname } from "node:path";

const WriteParams = Type.Object({
  path: Type.String({ description: "Path to the file to write" }),
  content: Type.String({ description: "Content to write to the file" }),
});

type WriteParams = Static<typeof WriteParams>;

function isPathSafe(cwd: string, inputPath: string): boolean {
  if (isAbsolute(inputPath)) return false;
  const resolved = resolve(cwd, inputPath);
  return resolved.startsWith(cwd + sep) || resolved === cwd;
}

export function createWriteTool(cwd: string): AgentTool<typeof WriteParams, { isError?: boolean }> {
  return {
    name: "write_file",
    label: "Write File",
    description: "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Creates parent directories automatically.",
    parameters: WriteParams,
    async execute(_toolCallId, params) {
      if (!isPathSafe(cwd, params.path)) {
        return {
          content: [{ type: "text", text: `Error: Path escapes cwd: ${params.path}` }],
          details: { isError: true },
        };
      }
      try {
        const fullPath = resolve(cwd, params.path);
        await mkdir(dirname(fullPath), { recursive: true });
        await writeFile(fullPath, params.content, "utf-8");
        return {
          content: [{ type: "text", text: `Wrote ${params.content.length} bytes to ${params.path}` }],
          details: {},
        };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `Error: ${e.message}` }],
          details: { isError: true },
        };
      }
    },
  };
}
