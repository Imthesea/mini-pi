/**
 * 错误分类：判断一个 LLM API 错误是否值得重试。
 *
 * 后续可扩展：增加更多 Provider 特有的错误模式。
 */

/** 不可重试的错误关键词 */
const NON_RETRYABLE = [
  "insufficient_quota",
  "billing_not_active",
  "invalid_api_key",
  "incorrect_api_key",
  "invalid_request_error",
  "model_not_found",
  "permission",
  "unauthorized",
  "authentication",
  "rate_limit_exceeded", // 限流通常不重试（除非是暂时的）
];

/** 可重试的错误关键词 */
const RETRYABLE = [
  "overloaded",
  "rate_limit",
  "429",
  "500",
  "502",
  "503",
  "504",
  "server_error",
  "internal_server_error",
  "timeout",
  "timed out",
  "econnreset",
  "econnrefused",
  "enetunreach",
  "network",
  "connection",
  "stream_closed",
  "connection_error",
  "broken pipe",
  "socket hang up",
];

/**
 * 判断是否应该重试该错误。
 * 返回 true 表示可能是临时故障，上层（agent 层）可以决定重试。
 * 返回 false 表示是永久错误（配额、认证、权限等），不应重试。
 */
export function isRetryableAssistantError(error: unknown): boolean {
  const message = extractErrorMessage(error).toLowerCase();

  // 先检查不可重试的
  for (const pattern of NON_RETRYABLE) {
    if (message.includes(pattern)) return false;
  }

  // 再检查可重试的
  for (const pattern of RETRYABLE) {
    if (message.includes(pattern)) return true;
  }

  // 默认不重试
  return false;
}

/** 从各种错误形状中提取消息字符串 */
function extractErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const obj = error as any;
    return obj.message ?? obj.error ?? obj.msg ?? JSON.stringify(error);
  }
  return String(error);
}
