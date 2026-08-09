/**
 * ANSI color utilities.
 * 从 pi 项目 utils/ansi.ts 抄来（V1 最小化）。
 */

export const ANSI = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[36m",
  gray: "\x1b[90m",
};

let _isTty: boolean | null = null;

function isTty(): boolean {
  if (_isTty === null) _isTty = process.stdout.isTTY === true;
  return _isTty;
}

export function color(text: string, code: keyof typeof ANSI): string {
  return isTty() ? `${ANSI[code]}${text}${ANSI.reset}` : text;
}

// 🔴 Pi: stripAnsi —— 移除 ANSI 转义码。V1 不需要（无 TUI 输出清洗需求）
