/**
 * Basic key parsing for TUI input.
 * 照抄 Pi tui/src/keys.ts 的基础部分，不抄 Kitty 键盘协议。
 */

/**
 * Parse a raw stdin input string into a canonical key name.
 * Returns the original character for printable input,
 * or a named key constant for special sequences.
 */
export function parseKey(raw: string): string {
  if (!raw || raw.length === 0) return "";

  const cp = raw.codePointAt(0)!;

  // Ctrl+C (ETX)
  if (raw === "\x03") return "ctrl+c";
  // Ctrl+D (EOT)
  if (raw === "\x04") return "ctrl+d";

  // Enter / Return
  if (raw === "\r" || raw === "\n") return "enter";

  // Escape
  if (raw === "\x1b") return "escape";

  // Backspace
  if (raw === "\x7f" || raw === "\b") return "backspace";

  // Tab
  if (raw === "\t") return "tab";

  // Arrow keys: ESC [ A/B/C/D
  if (raw === "\x1b[A") return "up";
  if (raw === "\x1b[B") return "down";
  if (raw === "\x1b[C") return "right";
  if (raw === "\x1b[D") return "left";

  // Home / End
  if (raw === "\x1b[H" || raw === "\x1b[1~") return "home";
  if (raw === "\x1b[F" || raw === "\x1b[4~") return "end";

  // Delete key
  if (raw === "\x1b[3~") return "delete";

  // Printable characters: return as-is
  if (cp >= 0x20 && cp !== 0x7f) {
    return raw;
  }

  // Unknown sequences: ignore
  return "";
}
