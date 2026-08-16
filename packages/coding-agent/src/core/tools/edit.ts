import type { AgentTool } from "@mimi/agent";
import { Type, type Static } from "typebox";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, sep, isAbsolute } from "node:path";

const EditParams = Type.Object({
  path: Type.String({ description: "Path to the file to edit" }),
  old_string: Type.String({ description: "The exact text to replace" }),
  new_string: Type.String({ description: "The text to replace with" }),
  replace_all: Type.Optional(Type.Boolean({ description: "Replace all occurrences (default: false)" })),
});

type EditParams = Static<typeof EditParams>;

function isPathSafe(cwd: string, inputPath: string): boolean {
  if (isAbsolute(inputPath)) return false;
  const resolved = resolve(cwd, inputPath);
  return resolved.startsWith(cwd + sep) || resolved === cwd;
}

export function createEditTool(cwd: string): AgentTool<typeof EditParams, { isError?: boolean }> {
  return {
    name: "edit",
    label: "Edit File",
    description: "Replace exact text in an existing file. If old_string is not unique, use replace_all or provide more context.",
    parameters: EditParams,
    async execute(_toolCallId, params) {
      if (!isPathSafe(cwd, params.path)) {
        return {
          content: [{ type: "text", text: `Error: Path escapes cwd: ${params.path}` }],
          details: { isError: true },
        };
      }
      try {
        const fullPath = resolve(cwd, params.path);
        let content = await readFile(fullPath, "utf-8");
        if (params.replace_all) {
          content = content.replaceAll(params.old_string, params.new_string);
        } else {
          content = content.replace(params.old_string, params.new_string);
        }
        await writeFile(fullPath, content, "utf-8");
        return {
          content: [{ type: "text", text: `Edited ${params.path}` }],
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
