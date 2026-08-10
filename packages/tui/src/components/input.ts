/**
 * Input component - single-line text input.
 * 照抄 Pi tui/src/components/input.ts，简化（无 kill-ring/undo/word-navigation/paste）。
 */

import { parseKey } from "../keys.js";
import type { Component } from "../tui.js";
import { visibleWidth } from "../utils.js";

/**
 * Single-line text input with cursor.
 */
export class Input implements Component {
  private value: string = "";
  private cursor: number = 0; // Grapheme offset from start
  public onSubmit?: (value: string) => void;
  public onEscape?: () => void;

  getValue(): string {
    return this.value;
  }

  setValue(value: string): void {
    this.value = value;
    this.cursor = Math.min(this.cursor, [...value].length);
  }

  handleInput(data: string): void {
    const key = parseKey(data);

    if (key === "enter") {
      this.onSubmit?.(this.value);
      return;
    }

    if (key === "escape") {
      this.onEscape?.();
      return;
    }

    if (key === "backspace") {
      if (this.cursor > 0) {
        const chars = [...this.value];
        chars.splice(this.cursor - 1, 1);
        this.value = chars.join("");
        this.cursor--;
      }
      return;
    }

    if (key === "delete") {
      const chars = [...this.value];
      if (this.cursor < chars.length) {
        chars.splice(this.cursor, 1);
        this.value = chars.join("");
      }
      return;
    }

    if (key === "left") {
      if (this.cursor > 0) this.cursor--;
      return;
    }

    if (key === "right") {
      const chars = [...this.value];
      if (this.cursor < chars.length) this.cursor++;
      return;
    }

    if (key === "home") {
      this.cursor = 0;
      return;
    }

    if (key === "end") {
      this.cursor = [...this.value].length;
      return;
    }

    if (key === "ctrl+c") {
      // Ctrl+C: let TUI handle (signal)
      return;
    }

    // Printable character
    if (key.length > 0 && key !== "tab") {
      const chars = [...this.value];
      chars.splice(this.cursor, 0, key);
      this.value = chars.join("");
      this.cursor++;
    }
  }

  invalidate(): void {
    // No cached state
  }

  render(width: number): string[] {
    const prefix = "> ";
    const promptWidth = visibleWidth(prefix);
    const availableWidth = Math.max(1, width - promptWidth);

    const chars = [...this.value];
    // Truncate display to fit available width, keeping cursor visible
    const displayValue = chars.join("");
    const displayVisible = visibleWidth(displayValue);

    let display: string;
    if (displayVisible <= availableWidth) {
      display = displayValue;
    } else {
      // Scroll to keep cursor visible
      const beforeCursor = chars.slice(0, this.cursor).join("");
      const cursorVisiblePos = visibleWidth(beforeCursor);
      let start = 0;
      while (start < chars.length) {
        const slice = chars.slice(start).join("");
        if (visibleWidth(slice) <= availableWidth) break;
        start++;
      }
      display = chars.slice(start).join("");
    }

    // Build line: "> value"
    const line = prefix + display;
    return [line];
  }
}
