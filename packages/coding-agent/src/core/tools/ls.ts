import type { AgentTool } from "@mimi/agent";
import { Type, type Static } from "typebox";
import { readdir, stat } from "node:fs/promises";
import { resolve, join } from "node:path";

const LsParams = Type.Object({
  path: Type.Optional(Type.String({ description: "Directory to list (default: cwd)" })),
});

type LsParams = Static<typeof LsParams>;

export function createLsTool(cwd: string): AgentTool<typeof LsParams, { isError?: boolean }> {
  return {
    name: "ls",
    label: "List Directory",
    description: "List the contents of a directory. Shows files and subdirectories with type indicators.",
    parameters: LsParams,
    async execute(_toolCallId, params) {
      const targetDir = params.path ? resolve(cwd, params.path) : cwd;
      try {
        const entries = await readdir(targetDir, { withFileTypes: true });
        const lines = entries.map((e) => {
          const suffix = e.isDirectory() ? "/" : "";
          return `${e.name}${suffix}`;
        });
        lines.sort();
        return {
          content: [
            { type: "text", text: lines.length > 0 ? lines.join("\n") : "(empty)" },
          ],
          details: { count: lines.length },
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
