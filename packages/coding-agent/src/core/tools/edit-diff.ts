import type { AgentTool } from "@mimi/agent";
import { Type, type Static } from "@sinclair/typebox";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, sep, isAbsolute } from "node:path";

const EditDiffParams = Type.Object({
  path: Type.String({ description: "Path to the file to edit" }),
  diff: Type.String({ description: "A unified diff to apply to the file" }),
});

type EditDiffParams = Static<typeof EditDiffParams>;

function isPathSafe(cwd: string, inputPath: string): boolean {
  if (isAbsolute(inputPath)) return false;
  const resolved = resolve(cwd, inputPath);
  return resolved.startsWith(cwd + sep) || resolved === cwd;
}

export function createEditDiffTool(cwd: string): AgentTool<typeof EditDiffParams, { isError?: boolean }> {
  return {
    name: "edit_diff",
    label: "Edit Diff",
    description: "Apply a unified diff to a file. V1: simple implementation, does not parse diff format.",
    parameters: EditDiffParams,
    async execute(_toolCallId, params) {
      if (!isPathSafe(cwd, params.path)) {
        return {
          content: [{ type: "text", text: `Error: Path escapes cwd: ${params.path}` }],
          details: { isError: true },
        };
      }
      try {
        const fullPath = resolve(cwd, params.path);
        const content = await readFile(fullPath, "utf-8");
        // V1: simple diff application — replace all lines matching "-" prefix with "+" prefix
        // This is a placeholder; proper diff application will come later
        const diffLines = params.diff.split("\n");
        let result = content;
        let i = 0;
        while (i < diffLines.length) {
          const line = diffLines[i];
          if (line?.startsWith("---") || line?.startsWith("+++")) {
            i++;
            continue;
          }
          if (line?.startsWith("@@")) {
            i++;
            continue;
          }
          if (line?.startsWith("-") && diffLines[i + 1]?.startsWith("+")) {
            const oldStr = line.slice(1);
            const newStr = diffLines[i + 1].slice(1);
            result = result.replace(oldStr, newStr);
            i += 2;
            continue;
          }
          i++;
        }
        await writeFile(fullPath, result, "utf-8");
        return {
          content: [{ type: "text", text: `Applied diff to ${params.path}` }],
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
