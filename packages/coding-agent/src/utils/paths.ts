/**
 * Path utilities.
 * 从 pi 项目 utils/paths.ts 抄来（V1 最小化）。
 */

import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve as nodeResolvePath, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

// 🔴 Pi: spawnProcessSync from "./child-process.ts" —— 仅 markPathIgnoredByCloudSync 使用，V1 不需要

const UNICODE_SPACES = /[  -   　]/g;

export interface PathInputOptions {
  trim?: boolean;
  expandTilde?: boolean;
  homeDir?: string;
  stripAtPrefix?: boolean;
  normalizeUnicodeSpaces?: boolean;
}

export function canonicalizePath(path: string): string {
  try { return realpathSync(path); } catch { return path; }
}

export function isLocalPath(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.startsWith("npm:") || trimmed.startsWith("git:") || trimmed.startsWith("github:") ||
      trimmed.startsWith("http:") || trimmed.startsWith("https:") || trimmed.startsWith("ssh:")) return false;
  return true;
}

export function normalizePath(input: string, options: PathInputOptions = {}): string {
  let normalized = options.trim ? input.trim() : input;
  if (options.normalizeUnicodeSpaces) normalized = normalized.replace(UNICODE_SPACES, " ");
  if (options.stripAtPrefix && normalized.startsWith("@")) normalized = normalized.slice(1);
  if (options.expandTilde ?? true) {
    const home = options.homeDir ?? homedir();
    if (normalized === "~") return home;
    if (normalized.startsWith("~/") || (process.platform === "win32" && normalized.startsWith("~\\")))
      return join(home, normalized.slice(2));
  }
  if (/^file:\/\//.test(normalized)) return fileURLToPath(normalized);
  return normalized;
}

export function resolvePath(input: string, baseDir: string = process.cwd(), options: PathInputOptions = {}): string {
  const normalized = normalizePath(input, options);
  const normalizedBaseDir = normalizePath(baseDir);
  return isAbsolute(normalized) ? nodeResolvePath(normalized) : nodeResolvePath(normalizedBaseDir, normalized);
}

// 🔴 Pi: getCwdRelativePath / formatPathRelativeToCwdOrAbsolute / markPathIgnoredByCloudSync —— V1 不需要
