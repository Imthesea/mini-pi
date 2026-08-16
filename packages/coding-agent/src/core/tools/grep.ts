import type { AgentTool } from "@mimi/agent";
import { Type, type Static } from "typebox";
import { readFile, readdir, stat } from "node:fs/promises";
import { resolve, relative, join } from "node:path";

const GrepParams = Type.Object({
  pattern: Type.String({ description: "Regular expression to search for" }),
  path: Type.Optional(Type.String({ description: "Directory to search in (default: cwd)" })),
  glob: Type.Optional(Type.String({ description: "Only search files matching this glob pattern" })),
});

type GrepParams = Static<typeof GrepParams>;

function matchGlob(name: string, pattern: string): boolean {
  const regex = new RegExp(
    "^" + pattern.replace(/\*\*/g, "___DS___").replace(/\*/g, "[^/]*").replace(/\?/g, ".").replace(/___DS___/g, ".*") + "$",
  );
  return regex.test(name);
}

async function grepDir(
  dir: string, base: string, regex: RegExp, glob: string | undefined, results: string[],
): Promise<void> {
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
      if (!entry.name.startsWith(".") && entry.name !== "node_modules") {
        await grepDir(fullPath, base, regex, glob, results);
      }
    } else if (entry.isFile()) {
      if (glob && !matchGlob(relPath, glob)) continue;
      try {
        const content = await readFile(fullPath, "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            results.push(`${relPath}:${i + 1}: ${lines[i].trim()}`);
            if (results.length >= 100) return; // limit results
          }
        }
      } catch {
        // skip unreadable files
      }
    }
  }
}

export function createGrepTool(cwd: string): AgentTool<typeof GrepParams, { isError?: boolean }> {
  return {
    name: "grep",
    label: "Grep",
    description: "Search for a regular expression pattern in files. Returns matching lines with file paths and line numbers.",
    parameters: GrepParams,
    async execute(_toolCallId, params) {
      const searchDir = params.path ? resolve(cwd, params.path) : cwd;
      let regex: RegExp;
      try {
        regex = new RegExp(params.pattern, "i");
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `Invalid regex: ${e.message}` }],
          details: { isError: true },
        };
      }
      const results: string[] = [];
      try {
        await grepDir(searchDir, searchDir, regex, params.glob, results);
        return {
          content: [
            {
              type: "text",
              text: results.length > 0 ? results.join("\n") : "(no matches)",
            },
          ],
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
