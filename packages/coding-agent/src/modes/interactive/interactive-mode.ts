/**
 * Interactive mode for the coding agent.
 * Handles user interaction via readline loop, delegating business logic to AgentSession.
 *
 * 从 pi 项目 modes/interactive/interactive-mode.ts 抄来（V1 最小化）。
 * Pi 使用 Ink TUI（~6000 行）。V1 使用 node:readline REPL。
 * 🔴 暂未实现: TUI 渲染 / 扩展 UI / slash 命令 / keybindings / 自动补全 / 主题 / footer。
 */

import * as readline from "node:readline/promises";
import type { ImageContent } from "@mimi/ai";
import type { AgentSessionRuntime } from "../../core/agent-session-runtime.js";
import type { AgentSession, AgentSessionEvent } from "../../core/agent-session.js";
import { color } from "../../utils/ansi.js";
import { VERSION } from "../../config.js";

// ============================================================================
// InteractiveModeOptions
// ============================================================================

export interface InteractiveModeOptions {
  /** Providers that were migrated to auth.json (shows warning). 🔴 V1 桩 */
  migratedProviders?: string[];
  /** Warning message if session model couldn't be restored. 🔴 V1 桩 */
  modelFallbackMessage?: string;
  /** Cwd to trust after reload. 🔴 V1 桩 */
  autoTrustOnReloadCwd?: string;
  /** Initial message to send on startup */
  initialMessage?: string;
  /** Images to attach to the initial message */
  initialImages?: ImageContent[];
  /** Additional messages to send after the initial message */
  initialMessages?: string[];
  /** Force verbose startup. 🔴 V1 桩 */
  verbose?: boolean;
}

// ============================================================================
// InteractiveMode
// ============================================================================

export class InteractiveMode {
  private runtimeHost: AgentSessionRuntime;
  private options: InteractiveModeOptions;

  /** Whether initialization completed */
  private isInitialized = false;
  /** Agent subscription unsubscribe function */
  private unsubscribe?: () => void;
  /** Signal handler cleanup functions */
  private signalCleanupHandlers: Array<() => void> = [];
  /** Shutdown state */
  private shutdownRequested = false;
  /** Last SIGINT time (for double-Ctrl-C detection) */
  private lastSigintTime = 0;
  /** Pending user inputs queued before init completed */
  private pendingUserInputs: string[] = [];
  /** Working indicator message. 🔴 V1 桩 */
  private workingMessage: string | undefined = undefined;
  private readonly defaultWorkingMessage = "Working...";

  // Convenience accessors
  private get session(): AgentSession {
    return this.runtimeHost.session;
  }

  constructor(runtimeHost: AgentSessionRuntime, options: InteractiveModeOptions = {}) {
    this.runtimeHost = runtimeHost;
    this.options = options;
    // 🔴 Pi: TUI setup（ui / editor / footer / keybindings / theme）—— V1 不做
  }

  // 🔴 Pi: getAutocompleteSourceTag / prefixAutocompleteDescription —— V1 不做（无自动补全）
  // 🔴 Pi: resetExtensionUI / rebindCurrentSession —— V1 不做（无扩展系统）
  // 🔴 Pi: 大量 TUI 渲染方法 —— V1 不做

  // ==========================================================================
  // init / run / stop
  // ==========================================================================

  /** Initialize the interactive mode. Called once before run(). */
  async init(): Promise<void> {
    if (this.isInitialized) return;
    this.isInitialized = true;

    // 🔴 Pi: TUI 布局初始化 / 扩展加载 / 技能注册 / 主题初始化 —— V1 不做
  }

  /** Main entry point: init + run. Equivalent to Pi's start pattern. */
  static async start(runtime: AgentSessionRuntime, options?: InteractiveModeOptions): Promise<number> {
    const mode = new InteractiveMode(runtime, options);
    await mode.init();
    return mode.run();
  }

  /** Run the main REPL loop. */
  async run(): Promise<number> {
    let exitCode = 0;
    const session = this.session;

    // Subscribe to agent events → text rendering
    this.unsubscribe = session.subscribe((event: AgentSessionEvent) => {
      switch (event.type) {
        case "message_update": {
          const e = event as any;
          if (e.assistantMessageEvent) {
            switch (e.assistantMessageEvent.type) {
              case "text_delta":
                process.stdout.write(e.assistantMessageEvent.delta ?? "");
                break;
              case "text_end":
                process.stdout.write("\n");
                break;
              case "thinking_start":
                process.stdout.write(color("🤔 ", "gray"));
                break;
              case "thinking_delta":
                process.stdout.write(color(e.assistantMessageEvent.delta ?? "", "gray"));
                break;
              case "thinking_end":
                process.stdout.write("\n");
                break;
              case "toolcall_start":
                process.stdout.write(
                  color(`🔧 ${e.assistantMessageEvent.toolCall?.name ?? ""}(`, "blue"),
                );
                break;
              case "toolcall_end":
                process.stdout.write(color(")", "blue") + "\n");
                break;
            }
          }
          break;
        }
        case "tool_execution_end": {
          const e = event as any;
          const success = !e.isError;
          process.stdout.write(
            color(success ? `✓ done` : `✗ error`, success ? "green" : "red") + "\n",
          );
          break;
        }
        case "turn_end":
          process.stdout.write("\n");
          break;
      }
    });

    this.registerSignalHandlers();

    // Welcome
    console.log(color(`mimi v${VERSION}`, "green"));
    console.log(color(`Session: ${this.runtimeHost.services.sessionManager.getSessionId()}`, "gray"));
    console.log();

    // 🔴 Pi: 显示 modelFallbackMessage / migratedProviders 警告 —— V1 不做

    // Flush pending inputs queued before init
    for (const input of this.pendingUserInputs) {
      await session.prompt(input);
    }
    this.pendingUserInputs = [];

    // 🔴 Pi: 发送 initialMessage / initialMessages —— V1 main.ts 处理

    // Readline REPL
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      while (!this.shutdownRequested) {
        const line = await rl.question("mimi> ").catch(() => null);
        if (line === null || line === "exit" || line === "quit") break;
        if (line.trim() === "") continue;
        await session.prompt(line);
      }
    } catch (err: any) {
      process.stderr.write(color(`Error: ${err.message}`, "red") + "\n");
      exitCode = 1;
    } finally {
      rl.close();
    }

    await this.cleanup();
    return exitCode;
  }

  /** Stop the interactive mode. */
  stop(): void {
    this.shutdownRequested = true;
  }

  /** Cleanup resources. */
  private async cleanup(): Promise<void> {
    this.unsubscribe?.();
    for (const cleanup of this.signalCleanupHandlers) {
      cleanup();
    }
    this.signalCleanupHandlers = [];
    await this.runtimeHost.dispose();
  }

  // ==========================================================================
  // Signal handling
  // ==========================================================================

  private registerSignalHandlers(): void {
    const sigintHandler = () => {
      const now = Date.now();
      // 🔴 Pi: double-Ctrl-C 强制退出、auto-compaction escape、retry escape —— V1 简化为单次 abort
      if (now - this.lastSigintTime < 500) {
        process.exit(130);
      }
      this.lastSigintTime = now;
      this.session.abort();
    };

    process.on("SIGINT", sigintHandler);
    this.signalCleanupHandlers.push(() => process.off("SIGINT", sigintHandler));

    // 🔴 Pi: SIGTERM / SIGHUP —— V1 不做（print mode 已处理）
  }

  // 🔴 Pi: renderEvent / renderMessage / renderToolExecution —— TUI 渲染，V1 不做
  // 🔴 Pi: handleSlashCommand / 30+ slash 命令 —— V1 不做
  // 🔴 Pi: keybinding 系统 —— V1 不做
  // 🔴 Pi: showError / showWarning —— V1 用 console.error
}
