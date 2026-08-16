import type { AgentTool } from "@mimi/agent";
import { Type, type Static } from "typebox";
import { exec } from "node:child_process";
import { BASH_DEFAULT_TIMEOUT_MS, BASH_DEFAULT_MAX_OUTPUT_BYTES } from "../../defaults.js";

const BashParams = Type.Object({
  command: Type.String({ description: "Bash command to execute" }),
  timeoutMs: Type.Optional(Type.Number({ description: "Timeout in milliseconds (default: 30000)" })),
  maxOutputBytes: Type.Optional(Type.Number({ description: "Max output bytes (default: 50000)" })),
});

type BashParams = Static<typeof BashParams>;

export function createBashTool(cwd: string): AgentTool<typeof BashParams, { isError?: boolean; exitCode?: number }> {
  return {
    name: "bash",
    label: "Bash",
    description: "Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated at 50KB.",
    parameters: BashParams,
    async execute(_toolCallId, params) {
      const timeout = params.timeoutMs ?? BASH_DEFAULT_TIMEOUT_MS;
      const maxBytes = params.maxOutputBytes ?? BASH_DEFAULT_MAX_OUTPUT_BYTES;

      return new Promise((resolve) => {
        exec(
          params.command,
          { cwd, timeout, maxBuffer: maxBytes * 2 },
          (error, stdout, stderr) => {
            let output = stdout;
            if (stderr) output += "\n[stderr]\n" + stderr;
            if (output.length > maxBytes) {
              output = output.slice(0, maxBytes) + "\n... (truncated)";
            }

            if (error) {
              resolve({
                content: [
                  {
                    type: "text",
                    text: `Exit code ${error.code}: ${output || error.message}`,
                  },
                ],
                details: { isError: true, exitCode: error.code },
              });
            } else {
              resolve({
                content: [{ type: "text", text: output || "(no output)" }],
                details: { exitCode: 0 },
              });
            }
          },
        );
      });
    },
  };
}
