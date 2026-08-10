/**
 * Text component - renders a single text string.
 * 照抄 Pi tui/src/components/text.ts
 */

import type { Component } from "../tui.ts";

export class Text implements Component {
  private content: string;
  private indent: number; // Left margin in columns
  private marginTop: number; // Blank lines before text

  constructor(content: string, indent: number = 0, marginTop: number = 0) {
    this.content = content;
    this.indent = indent;
    this.marginTop = marginTop;
  }

  setContent(content: string): void {
    this.content = content;
  }

  invalidate(): void {
    // No cached state
  }

  render(_width: number): string[] {
    const lines: string[] = [];
    for (let i = 0; i < this.marginTop; i++) {
      lines.push("");
    }
    const indentStr = " ".repeat(this.indent);
    lines.push(indentStr + this.content);
    return lines;
  }
}
