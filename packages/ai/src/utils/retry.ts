/**
 * 错误分类：判断一个 LLM API 错误是否值得重试。
 *
 * 匹配策略：使用单词边界（\b）匹配，避免子串误判。
 * 例如 "500" 不会匹配 "port 5000"，"permission" 不会匹配 "permission_granted" 之外的语义。
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
];

/** 可重试的错误关键词
 *  注意：rate_limit/429/too many requests 都属于可重试（带退避），
 *  不再列在 NON_RETRYABLE 中——之前两边都列会导致"rate_limit_exceeded"被先匹配到 NON_RETRYABLE
 */
const RETRYABLE = [
  "overloaded",
  "rate_limit",
  "rate_limit_exceeded",
  "too many requests",
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
    if (matchWord(message, pattern)) return false;
  }

  // 再检查可重试的
  for (const pattern of RETRYABLE) {
    if (matchWord(message, pattern)) return true;
  }

  // 默认不重试
  return false;
}

/** 在小写后的消息里做单词边界匹配。
 *  - 对全字母数字下划线组成的 pattern：用 \b 包裹（避免 "500" 误匹配 "5000"）
 *  - 含空格的 pattern（如 "too many requests"）：直接 includes 即可
 */
function matchWord(message: string, pattern: string): boolean {
  if (pattern.includes(" ")) {
    return message.includes(pattern);
  }
  // 转义正则元字符后用 \b 包裹
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(message);
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
