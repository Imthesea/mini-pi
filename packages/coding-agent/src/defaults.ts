/**
 * 默认值常量。
 *
 * 对齐 pi 项目 defaults.ts。
 */

import type { ThinkingLevel } from "@mimi/agent";

export const DEFAULT_MODEL = "deepseek-chat";
export const DEFAULT_THINKING_LEVEL: ThinkingLevel = "medium";

export const DEFAULT_SESSION_DIR_NAME = ".mimi/sessions";

export const BASH_DEFAULT_TIMEOUT_MS = 30_000;
export const BASH_DEFAULT_MAX_OUTPUT_BYTES = 50_000;
