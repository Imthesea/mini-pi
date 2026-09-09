/**
 * 认证/模型相关的用户提示文案。
 *
 * 从 pi 项目 core/auth-guidance.ts 照抄（V1 最小化）。
 * 这些纯文案函数被 AgentSession 在「无模型 / 无 API key」时调用，
 * 用来给用户一个明确的下一步操作指引。
 */

import { join } from "node:path";
import { getDocsPath } from "../config.js";

const UNKNOWN_PROVIDER = "unknown";

/** 通用的「如何登录 / 如何配模型」指引文案 */
export function getProviderLoginHelp(): string {
  return [
    "Use /login to log into a provider via OAuth or API key. See:",
    `  ${join(getDocsPath(), "providers.md")}`,
    `  ${join(getDocsPath(), "models.md")}`,
  ].join("\n");
}

/** 「没有任何可用模型」时的提示文案 */
export function formatNoModelsAvailableMessage(): string {
  return `No models available. ${getProviderLoginHelp()}`;
}

/** 「尚未选择模型」时的提示文案 */
export function formatNoModelSelectedMessage(): string {
  return `No model selected.\n\n${getProviderLoginHelp()}\n\nThen use /model to select a model.`;
}

/** 「找不到某 provider 的 API key」时的提示文案 */
export function formatNoApiKeyFoundMessage(provider: string): string {
  const providerDisplay = provider === UNKNOWN_PROVIDER ? "the selected model" : provider;
  return `No API key found for ${providerDisplay}.\n\n${getProviderLoginHelp()}`;
}
