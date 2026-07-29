/**
 * 认证模块 —— 整个模块只有一个函数。
 * 从环境变量读取 API Key，自动加载 .env 文件。
 * 不存储凭证、不刷新 token、不弹登录框。
 */

import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// 加载 packages/ai/.env 文件（如果存在）
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "..", ".env");
if (existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config(); // 回退到当前工作目录的 .env
}

/**
 * 从环境变量读取 API Key。
 * 找不到时返回 undefined，由上层 Models.stream() 提供明确错误提示。
 */
export function envApiKey(envVar: string): string | undefined {
  const value = process.env[envVar];
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return undefined;
}
