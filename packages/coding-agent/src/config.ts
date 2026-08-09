/**
 * coding-agent 全局常量。
 *
 * 对齐 pi 项目 config.ts。
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const APP_NAME = "mimi";
export const APP_TITLE = "mimi - AI Coding Assistant";
export const VERSION = "0.1.0";
export const CONFIG_DIR_NAME = ".mimi";

export function getPackageDir(): string {
  return join(__dirname, "..");
}

export function getAgentDir(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  return join(home, CONFIG_DIR_NAME);
}

export function getDocsPath(): string {
  return join(getPackageDir(), "docs");
}
