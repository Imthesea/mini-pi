/**
 * Terminal abstraction for TUI.
 * 照抄 Pi tui/src/terminal.ts 的核心 ProcessTerminal，不抄 Kitty 协议协商。
 */

import * as fs from "node:fs";
import { StdinBuffer } from "./stdin-buffer.ts";

/**
 * Minimal terminal interface for TUI
 */
export interface Terminal {
  start(onInput: (data: string) => void, onResize: () => void): void;
  stop(): void;
  drainInput(maxMs?: number, idleMs?: number): Promise<void>;
  write(data: string): void;
  get columns(): number;
  get rows(): number;
  moveBy(lines: number): void;
  hideCursor(): void;
  showCursor(): void;
}

export class ProcessTerminal implements Terminal {
  private wasRaw = false;
  private inputHandler?: (data: string) => void;
  private resizeHandler?: () => void;
  private stdinBuffer?: StdinBuffer;

  start(onInput: (data: string) => void, onResize: () => void): void {
    this.inputHandler = onInput;
    this.resizeHandler = onResize;

    // Save previous state and enable raw mode
    this.wasRaw = process.stdin.isRaw || false;
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(true);
    }
    process.stdin.setEncoding("utf8");
    process.stdin.resume();

    // Set up resize handler
    process.stdout.on("resize", this.resizeHandler);

    // Set up StdinBuffer for batch splitting
    this.setupStdinBuffer();
  }

  private setupStdinBuffer(): void {
    this.stdinBuffer = new StdinBuffer({ timeout: 10 });
    this.stdinBuffer.on("data", (data: string) => {
      if (this.inputHandler) {
        this.inputHandler(data);
      }
    });
    process.stdin.on("data", (data: string) => {
      this.stdinBuffer?.process(data);
    });
  }

  stop(): void {
    // Restore terminal
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(this.wasRaw);
    }
    process.stdin.pause();
    process.stdin.removeAllListeners("data");
    process.stdout.removeAllListeners("resize");
    this.stdinBuffer?.destroy();
    this.showCursor();
  }

  async drainInput(maxMs: number = 1000, idleMs: number = 50): Promise<void> {
    const start = Date.now();
    let lastData = start;
    const buf = this.stdinBuffer;
    return new Promise<void>((resolve) => {
      const check = () => {
        const now = Date.now();
        if (now - start >= maxMs || now - lastData >= idleMs) {
          resolve();
          return;
        }
        setTimeout(check, 10);
      };
      const handler = () => {
        lastData = Date.now();
      };
      buf?.on("data", handler);
      check();
      // Cleanup is best-effort since we're about to exit
    });
  }

  write(data: string): void {
    process.stdout.write(data);
  }

  get columns(): number {
    return process.stdout.columns || 80;
  }

  get rows(): number {
    return process.stdout.rows || 24;
  }

  moveBy(lines: number): void {
    if (lines > 0) {
      process.stdout.write(`\x1b[${lines}B`);
    } else if (lines < 0) {
      process.stdout.write(`\x1b[${-lines}A`);
    }
  }

  hideCursor(): void {
    process.stdout.write("\x1b[?25l");
  }

  showCursor(): void {
    process.stdout.write("\x1b[?25h");
  }
}
