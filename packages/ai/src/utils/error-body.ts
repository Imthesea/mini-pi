/**
 * 错误规范化：将不同 Provider SDK 的错误统一为可读格式。
 * 用于日志记录和排错。
 */

/** 规范化后的错误信息 */
export interface NormalizedError {
  status?: number;
  message: string;
  body?: unknown;
}

/**
 * 将 Provider SDK 抛出的错误统一为 { status, message, body } 格式。
 * 不同 SDK 的错误形状不同，这个函数负责探测并统一。
 */
export function normalizeProviderError(error: unknown): NormalizedError {
  if (!error || typeof error !== "object") {
    return { message: String(error) };
  }

  const err = error as any;

  // OpenAI SDK 错误
  if (err.status !== undefined) {
    return {
      status: err.status,
      message: err.message ?? "OpenAI 请求失败",
      body: err.error ?? err.body,
    };
  }

  // Anthropic SDK 错误
  if (err.status_code !== undefined) {
    return {
      status: err.status_code,
      message: err.message ?? "Anthropic 请求失败",
      body: err,
    };
  }

  // 标准 Error
  if (error instanceof Error) {
    return { message: error.message };
  }

  // 兜底
  return { message: String(error) };
}
