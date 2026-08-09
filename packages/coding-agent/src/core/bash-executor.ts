/**
 * Bash command execution with streaming support and cancellation.
 *
 * This module provides a unified bash execution implementation used by:
 * - AgentSession.executeBash() for interactive and RPC modes
 * - Direct calls from modes that need bash execution
 *
 * 从 pi 项目 core/bash-executor.ts 抄来（V1 最小化）。
 * 🔴 暂未实现: onChunk 流式回调（需要 child_process.spawn）、temp file、ANSI strip。
 * V1 用 child_process.exec 替代 BashOperations.exec()。
 */

import { exec } from "node:child_process";
import { BASH_DEFAULT_TIMEOUT_MS, BASH_DEFAULT_MAX_OUTPUT_BYTES } from "../defaults.js";
import { truncateTail } from "./tools/truncate.js";

// ============================================================================
// Types
// ============================================================================

/** Bash 执行选项 */
export interface BashExecutorOptions {
  /** Callback for streaming output chunks. 🔴 V1 桩——需 child_process.spawn + onData */
  onChunk?: (chunk: string) => void;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
}

/** Bash 执行结果 */
export interface BashResult {
  /** Combined stdout + stderr output */
  output: string;
  /** Process exit code (undefined if killed/cancelled) */
  exitCode: number | undefined;
  /** Whether the command was cancelled via signal */
  cancelled: boolean;
  /** Whether the output was truncated */
  truncated: boolean;
  /** Path to temp file containing full output. 🔴 V1 桩——需 temp file 写入逻辑 */
  fullOutputPath?: string;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Execute a bash command.
 * 🔴 V1 简化版：用 child_process.exec 替代 BashOperations.exec()。
 * Pi 的 executeBashWithOperations 通过可插拔的 BashOperations 支持远程执行（SSH 等）。
 * V1 固定为本地 shell 执行。
 */
export async function executeBashWithOperations(
  command: string,
  cwd: string,
  options?: BashExecutorOptions,
): Promise<BashResult> {
  // 🔴 Pi: operations: BashOperations 参数——远程执行抽象。V1 不需要
  // 🔴 Pi: randomBytes / createWriteStream — temp file。V1 桩
  // 🔴 Pi: stripAnsi / sanitizeBinaryOutput — 终端输出清洗。V1 不需要（windows 不涉及 ANSI）

  const timeout = BASH_DEFAULT_TIMEOUT_MS;
  const maxBytes = BASH_DEFAULT_MAX_OUTPUT_BYTES;

  if (options?.signal?.aborted) {
    return { output: "", exitCode: undefined, cancelled: true, truncated: false };
  }

  return new Promise((resolve) => {
    // 🔴 Pi: operations.exec(command, cwd, { onData, signal, timeout, env })——流式执行
    // V1 用 child_process.exec 替代
    const child = exec(
      command,
      { cwd, timeout, maxBuffer: maxBytes * 2 },
      (error, stdout, stderr) => {
        let output = stdout;
        if (stderr) output += "\n" + stderr;

        // Pi: truncateTail
        const truncationResult = truncateTail(output);
        const finalOutput = truncationResult.truncated ? truncationResult.content : output;

        if (options?.signal?.aborted) {
          resolve({ output: finalOutput, exitCode: undefined, cancelled: true, truncated: truncationResult.truncated });
          return;
        }

        resolve({
          output: finalOutput,
          exitCode: error?.code ?? 0,
          cancelled: false,
          truncated: truncationResult.truncated,
        });
      },
    );

    // Handle abort signal
    if (options?.signal) {
      const onAbort = () => {
        child.kill();
        resolve({ output: "", exitCode: undefined, cancelled: true, truncated: false });
      };
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}
