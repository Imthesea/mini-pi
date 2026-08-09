import type { AgentTool } from "@mimi/agent";
import { createReadTool } from "./read.js";
import { createWriteTool } from "./write.js";
import { createEditTool } from "./edit.js";
import { createEditDiffTool } from "./edit-diff.js";
import { createBashTool } from "./bash.js";
import { createFindTool } from "./find.js";
import { createGrepTool } from "./grep.js";
import { createLsTool } from "./ls.js";

export function createBuiltinTools(cwd: string): AgentTool<any>[] {
  return [
    createReadTool(cwd),
    createWriteTool(cwd),
    createEditTool(cwd),
    createEditDiffTool(cwd),
    createBashTool(cwd),
    createFindTool(cwd),
    createGrepTool(cwd),
    createLsTool(cwd),
  ];
}

export {
  createReadTool,
  createWriteTool,
  createEditTool,
  createEditDiffTool,
  createBashTool,
  createFindTool,
  createGrepTool,
  createLsTool,
};
