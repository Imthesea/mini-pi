/**
 * Input component - single-line text input.
 * 照抄 Pi tui/src/components/input.ts，简化（无 kill-ring/undo/word-navigation/paste）。
 */

import { parseKey } from "../keys.ts";
import type { Component } from "../tui.ts";
import { visibleWidth } from "../utils.ts";

/**
 * Single-line text input with cursor.
 */
export class Input implements Component {
  private value: string = "";
  private cursor: number = 0; // Grapheme offset from start
  public onSubmit?: (value: string) => void;
  public onEscape?: () => void;
  public onCtrlC?: () => void;
  public onCtrlD?: () => void;

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
      // Ctrl+C: 在按键层处理（照抄 Pi）。raw mode 下 Ctrl+C 不产生 SIGINT 信号，
      // 而是作为 \x03 字节进入 stdin，因此必须由组件回调处理（退出/清空输入）。
      this.onCtrlC?.();
      return;
    }

    if (key === "ctrl+d") {
      // Ctrl+D: 照抄 Pi handleCtrlD（退出）
      this.onCtrlD?.();
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
    const chars = [...this.value];

    // 文本在光标位置拆分：前段 + 光标字符（反显） + 后段
    const before = chars.slice(0, this.cursor).join("");
    const atCursor = chars[this.cursor] ?? " "; // 光标处字符（空位用空格）
    const after = chars.slice(this.cursor + 1).join("");

    // 光标用 ANSI 反显（\x1b[7m ... \x1b[27m）高亮
    const cursorBlock = `\x1b[7m${atCursor}\x1b[27m`;
    const line = prefix + before + cursorBlock + after;
    return [line];
  }
}
