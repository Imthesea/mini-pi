/**
 * Minimal TUI framework: Component + Container + TUI with differential rendering.
 * 照抄 Pi tui/src/tui.ts 的核心架构，不抄 overlay 系统、Kitty 图片、终端颜色检测。
 */

import type { Terminal } from "./terminal.ts";

// ═══════════════════════════════════════════
// Component interface
// ═══════════════════════════════════════════

/**
 * Component interface - all UI components must implement this.
 * 照抄 Pi tui/src/tui.ts Component
 */
export interface Component {
  /** Render the component to lines for the given viewport width. */
  render(width: number): string[];

  /** Optional handler for keyboard input when component has focus. */
  handleInput?(data: string): void;

  /** Invalidate any cached rendering state. */
  invalidate(): void;
}

// ═══════════════════════════════════════════
// Container
// ═══════════════════════════════════════════

/**
 * Container - a component that contains other components.
 * 照抄 Pi tui/src/tui.ts Container
 */
export class Container implements Component {
  children: Component[] = [];

  addChild(component: Component): void {
    this.children.push(component);
  }

  removeChild(component: Component): void {
    const index = this.children.indexOf(component);
    if (index !== -1) {
      this.children.splice(index, 1);
    }
  }

  clear(): void {
    this.children = [];
  }

  invalidate(): void {
    for (const child of this.children) {
      child.invalidate();
    }
  }

  render(width: number): string[] {
    const lines: string[] = [];
    for (const child of this.children) {
      const childLines = child.render(width);
      for (const line of childLines) {
        lines.push(line);
      }
    }
    return lines;
  }
}

// ═══════════════════════════════════════════
// TUI
// ═══════════════════════════════════════════

/**
 * TUI - Root component that manages the terminal.
 * 照抄 Pi tui/src/tui.ts TUI，差分渲染简化版。
 */
export class TUI extends Container {
  public terminal: Terminal;
  private previousLines: string[] = [];
  private previousWidth = 0;
  private focusedComponent: Component | null = null;
  private renderRequested = false;
  private renderTimer: ReturnType<typeof setTimeout> | undefined;
  private lastRenderAt = 0;
  private static readonly MIN_RENDER_INTERVAL_MS = 16;
  private stopped = false;

  constructor(terminal: Terminal) {
    super();
    this.terminal = terminal;
  }

  setFocus(component: Component | null): void {
    this.focusedComponent = component;
  }

  getFocusedComponent(): Component | null {
    return this.focusedComponent;
  }

  start(): void {
    this.stopped = false;
    this.terminal.start(
      (data: string) => this.handleInput(data),
      () => this.requestRender(),
    );
    this.terminal.hideCursor();
    this.requestRender();
  }

  stop(): void {
    this.stopped = true;
    if (this.renderTimer) {
      clearTimeout(this.renderTimer);
      this.renderTimer = undefined;
    }
    // Move cursor to end of content
    if (this.previousLines.length > 0) {
      this.terminal.write(" ");
      this.terminal.write("\r\n");
    }
    this.terminal.stop();
  }

  /**
   * Request a re-render on the next frame.
   * Debounced to MIN_RENDER_INTERVAL_MS (16ms ≈ 60fps).
   * 照抄 Pi requestRender
   */
  requestRender(): void {
    if (this.renderRequested || this.stopped) return;
    this.renderRequested = true;

    const now = Date.now();
    const elapsed = now - this.lastRenderAt;
    const delay = Math.max(0, TUI.MIN_RENDER_INTERVAL_MS - elapsed);

    this.renderTimer = setTimeout(() => {
      this.renderTimer = undefined;
      this.renderRequested = false;
      this.performRender();
    }, delay);
  }

  /**
   * Differential render: compare new lines with previous, only update changes.
   * 照抄 Pi 的差分渲染算法，简化版：
   * - 首帧 / 宽度变化 → 全量渲染
   * - 行数相同 → 逐行对比，只写变化行
   * - 行数增加 → 追加新行
   * - 行数减少 → 全量清屏重绘
   */
  private performRender(): void {
    if (this.stopped) return;
    this.lastRenderAt = Date.now();

    const width = this.terminal.columns;
    const height = this.terminal.rows;

    const widthChanged = this.previousWidth !== 0 && this.previousWidth !== width;

    let newLines = this.render(width);

    // First render or width changed: full render
    if (this.previousLines.length === 0 || widthChanged) {
      this.fullRender(newLines, true);
      this.previousLines = newLines;
      this.previousWidth = width;
      return;
    }

    // Line count decreased: full clear + re-render
    if (newLines.length < this.previousLines.length) {
      this.fullRender(newLines, true);
      this.previousLines = newLines;
      this.previousWidth = width;
      return;
    }

    // Differential update
    this.differentialRender(newLines);
    this.previousLines = newLines;
    this.previousWidth = width;
  }

  /** Full screen clear and render all lines. */
  private fullRender(lines: string[], clear: boolean): void {
    let buffer = "";
    if (clear) {
      buffer += "\x1b[2J\x1b[H\x1b[3J"; // Clear screen, home cursor, clear scrollback
    }
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) buffer += "\r\n";
      buffer += lines[i];
    }
    this.terminal.write(buffer);
  }

  /** Differential render: only update changed lines. */
  private differentialRender(newLines: string[]): void {
    const prevLen = this.previousLines.length;
    const newLen = newLines.length;

    let buffer = "";

    if (newLen === prevLen) {
      // Same line count: find and update changed lines only
      let lastChanged = -1;
      for (let i = 0; i < newLen; i++) {
        if (newLines[i] !== this.previousLines[i]) {
          if (lastChanged >= 0 && i > lastChanged + 1) {
            // Non-consecutive: move cursor
            buffer += `\x1b[${prevLen - lastChanged}B`;
            buffer += `\x1b[${newLen - i}A`;
          } else if (lastChanged < 0 && i > 0) {
            buffer += `\x1b[${i}B`;
          }
          buffer += `\r\x1b[2K${newLines[i]}`;
          lastChanged = i;
        }
      }
      // Move cursor back to end
      if (lastChanged >= 0 && lastChanged < newLen - 1) {
        buffer += `\x1b[${newLen - 1 - lastChanged}B`;
      }
    } else if (newLen > prevLen) {
      // Appended: move to end of old content, write new lines
      if (prevLen > 0) {
        buffer += `\x1b[${prevLen}B\r`;
      }
      for (let i = prevLen; i < newLen; i++) {
        buffer += `\r\n${newLines[i]}`;
      }
    }

    this.terminal.write(buffer);
  }

  /** Forward input to the focused component. */
  private handleInput(data: string): void {
    if (this.focusedComponent?.handleInput) {
      this.focusedComponent.handleInput(data);
    }
  }
}
