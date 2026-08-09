/**
 * Print mode (single-shot): Send prompts, output result, exit.
 *
 * Used for:
 * - `mimi -p "prompt"` - text output
 * - `mimi --mode json "prompt"` - JSON event stream
 *
 * 从 pi 项目 modes/print-mode.ts 抄来（V1 最小化）。
 * 🔴 暂未实现: bindExtensions（无扩展系统）、writeRawStdout/flushRawStdout（V1 用 process.stdout.write 替代）。
 */

import type { AssistantMessage, ImageContent } from "@mimi/ai";
import type { AgentSessionRuntime } from "../core/agent-session-runtime.js";
import { killTrackedDetachedChildren } from "../utils/shell.js";

/**
 * Options for print mode.
 */
export interface PrintModeOptions {
  /** Output mode: "text" for final response only, "json" for all events */
  mode: "text" | "json";
  /** Array of additional prompts to send after initialMessage */
  messages?: string[];
  /** First message to send */
  initialMessage?: string;
  /** Images to attach to the initial message */
  initialImages?: ImageContent[];
}

/**
 * Run in print (single-shot) mode.
 * Sends prompts to the agent and outputs the result.
 */
export async function runPrintMode(runtimeHost: AgentSessionRuntime, options: PrintModeOptions): Promise<number> {
  const { mode, messages = [], initialMessage, initialImages } = options;
  let exitCode = 0;
  let session = runtimeHost.session;
  let unsubscribe: (() => void) | undefined;
  let disposed = false;
  const signalCleanupHandlers: Array<() => void> = [];

  const disposeRuntime = async (): Promise<void> => {
    if (disposed) return;
    disposed = true;
    unsubscribe?.();
    await runtimeHost.dispose();
  };

  const registerSignalHandlers = (): void => {
    const signals: NodeJS.Signals[] = ["SIGTERM"];
    if (process.platform !== "win32") {
      signals.push("SIGHUP");
    }
    for (const signal of signals) {
      const handler = () => {
        killTrackedDetachedChildren();
        void disposeRuntime().finally(() => {
          process.exit(signal === "SIGHUP" ? 129 : 143);
        });
      };
      process.on(signal, handler);
      signalCleanupHandlers.push(() => process.off(signal, handler));
    }
  };

  registerSignalHandlers();

  // 🔴 Pi: runtimeHost.setRebindSession / session.bindExtensions —— V1 不需要（无扩展系统）

  unsubscribe = session.subscribe((event) => {
    if (mode === "json") {
      process.stdout.write(`${JSON.stringify(event)}\n`);
    }
  });

  try {
    if (mode === "json") {
      const header = session.sessionManager.getHeader();
      if (header) {
        process.stdout.write(`${JSON.stringify(header)}\n`);
      }
    }

    if (initialMessage) {
      await session.prompt(initialMessage, { images: initialImages });
    }

    for (const message of messages) {
      await session.prompt(message);
    }

    if (mode === "text") {
      const state = session.state;
      const lastMessage = state.messages[state.messages.length - 1];

      if (lastMessage?.role === "assistant") {
        const assistantMsg = lastMessage as AssistantMessage;
        if (assistantMsg.stopReason === "error" || assistantMsg.stopReason === "aborted") {
          console.error(assistantMsg.errorMessage || `Request ${assistantMsg.stopReason}`);
          exitCode = 1;
        } else {
          for (const content of assistantMsg.content) {
            if (content.type === "text") {
              process.stdout.write(`${content.text}\n`);
            }
          }
        }
      }
    }

    return exitCode;
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    for (const cleanup of signalCleanupHandlers) {
      cleanup();
    }
    await disposeRuntime();
  }
}
