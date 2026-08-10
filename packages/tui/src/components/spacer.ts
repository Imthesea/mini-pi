/**
 * Spacer component - vertical whitespace.
 * 照抄 Pi tui/src/components/spacer.ts
 */

import type { Component } from "../tui.js";

export class Spacer implements Component {
  private height: number;

  constructor(height: number = 1) {
    this.height = height;
  }

  invalidate(): void {
    // No cached state
  }

  render(_width: number): string[] {
    return new Array(this.height).fill("");
  }
}
