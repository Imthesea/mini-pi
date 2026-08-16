import type { AgentTool } from "@mimi/agent";
import { Type, type Static } from "typebox";
import { readdir, stat } from "node:fs/promises";
import { resolve, relative, join } from "node:path";

const FindParams = Type.Object({
  pattern: Type.String({ description: "Glob pattern to match file names (e.g. *.ts, **/*.test.ts)" }),
  path: Type.Optional(Type.String({ description: "Directory to search in (default: cwd)" })),
});

type FindParams = Static<typeof FindParams>;

function matchGlob(name: string, pattern: string): boolean {
  // Simple glob: * matches any sequence, ? matches single char
  const regex = new RegExp(
    "^" + pattern.replace(/\*\*/g, "___DOUBLESTAR___").replace(/\*/g, "[^/]*").replace(/\?/g, ".").replace(/___DOUBLESTAR___/g, ".*") + "$",
  );
  return regex.test(name);
}

async function walk(dir: string, base: string, pattern: string, results: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relPath = relative(base, fullPath);
    if (entry.isDirectory()) {
      await walk(fullPath, base, pattern, results);
    } else if (entry.isFile() && matchGlob(relPath, pattern)) {
      results.push(relPath);
    }
  }
}

export function createFindTool(cwd: string): AgentTool<typeof FindParams, { isError?: boolean }> {
  return {
    name: "find",
    label: "Find Files",
    description: "Search for files matching a glob pattern. Returns relative file paths.",
    parameters: FindParams,
    async execute(_toolCallId, params) {
      const searchDir = params.path ? resolve(cwd, params.path) : cwd;
      const results: string[] = [];
      try {
        await walk(searchDir, searchDir, params.pattern, results);
        return {
          content: [{ type: "text", text: results.length > 0 ? results.join("\n") : "(no matches)" }],
          details: { count: results.length },
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
