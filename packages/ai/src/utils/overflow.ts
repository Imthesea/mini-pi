import type { AssistantMessage } from "../types.js";

/**
 * 用于检测不同 provider 的上下文溢出错误的正则表达式。
 *
 * 这些正则匹配当输入超过模型上下文窗口时返回的错误消息。
 *
 * 各 provider 专属的正则（附示例错误消息）：
 *
 * - Anthropic: "prompt is too long: 213462 tokens > 200000 maximum"
 * - Anthropic: "413 {\"error\":{\"type\":\"request_too_large\",\"message\":\"Request exceeds the maximum size\"}}"
 * - OpenAI: "Your input exceeds the context window of this model"
 * - OpenAI/LiteLLM: "Requested token count exceeds the model's maximum context length of 131072 tokens"
 * - OpenAI-compatible: "Input length (265330) exceeds model's maximum context length (262144)."
 * - Google: "The input token count (1196265) exceeds the maximum number of tokens allowed (1048575)"
 * - xAI: "This model's maximum prompt length is 131072 but the request contains 537812 tokens"
 * - Groq: "Please reduce the length of the messages or completion"
 * - OpenRouter: "This endpoint's maximum context length is X tokens. However, you requested about Y tokens"
 * - OpenRouter/Poolside: "Input length X exceeds the maximum allowed input length of Y tokens."
 * - Together AI: "The input (X tokens) is longer than the model's context length (Y tokens)."
 * - llama.cpp: "the request exceeds the available context size, try increasing it"
 * - LM Studio: "tokens to keep from the initial prompt is greater than the context length"
 * - GitHub Copilot: "prompt token count of X exceeds the limit of Y"
 * - MiniMax: "invalid params, context window exceeds limit"
 * - Kimi For Coding: "Your request exceeded model token limit: X (requested: Y)"
 * - DS4: "Prompt has X tokens, but the configured context size is Y tokens"
 * - Cerebras: "400/413 status code (no body)"
 * - Mistral: "Prompt contains X tokens ... too large for model with Y maximum context length"
 * - z.ai: 不报错，静默接受溢出——通过 usage.input > contextWindow 检测
 * - Xiaomi MiMo: 把输入截断到恰好填满 contextWindow，然后返回 finish_reason "length"
 *   且 output=0（没有剩余空间生成）。通过 stopReason "length" + 零输出 + 输入填满窗口检测。
 * - DashScope/Qwen: "Range of input length should be [1, X]" (HTTP 400 invalid_parameter_error)
 * - Ollama: 部分部署静默截断，其它返回类似 "prompt too long; exceeded max context length by X tokens" 的错误
 */
const OVERFLOW_PATTERNS = [
  /prompt is too long/i, // Anthropic token overflow
  /request_too_large/i, // Anthropic request byte-size overflow (HTTP 413)
  /input is too long for requested model/i, // Amazon Bedrock
  /exceeds the context window/i, // OpenAI (Completions & Responses API)
  /exceeds (?:the )?(?:model'?s )?maximum context length(?: of [\d,]+ tokens?|\s*\([\d,]+\))/i, // OpenAI-compatible proxies (LiteLLM)
  /input token count.*exceeds the maximum/i, // Google (Gemini)
  /maximum prompt length is \d+/i, // xAI (Grok)
  /reduce the length of the messages/i, // Groq
  /maximum context length is \d+ tokens/i, // OpenRouter (most backends)
  /exceeds (?:the )?maximum allowed input length of [\d,]+ tokens?/i, // OpenRouter/Poolside
  /input \(\d+ tokens\) is longer than the model'?s context length \(\d+ tokens\)/i, // Together AI
  /exceeds the limit of \d+/i, // GitHub Copilot
  /exceeds the available context size/i, // llama.cpp server
  /greater than the context length/i, // LM Studio
  /context window exceeds limit/i, // MiniMax
  /exceeded model token limit/i, // Kimi For Coding
  /too large for model with \d+ maximum context length/i, // Mistral
  /prompt has [\d,]+ tokens?, but the configured context size is [\d,]+ tokens?/i, // DS4 server
  /model_context_window_exceeded/i, // z.ai non-standard finish_reason surfaced as error text
  /prompt too long; exceeded (?:max )?context length/i, // Ollama explicit overflow error
  /range of input length should be/i, // DashScope / Qwen Token Plan
  /context[_ ]length[_ ]exceeded/i, // Generic fallback
  /too many tokens/i, // Generic fallback
  /token limit exceeded/i, // Generic fallback
  /^4(?:00|13)\s*(?:status code)?\s*\(no body\)/i, // Cerebras: 400/413 with no body
];

/**
 * 表示「非溢出」错误的模式（例如限流、服务器错误）。
 * 匹配这些模式之一的错误消息会被排除在溢出检测之外，
 * 即使它们也命中了 OVERFLOW_PATTERN 中的某个正则。
 *
 * 示例：Bedrock 把限流错误格式化为 "ThrottlingException: Too many tokens,
 * please wait before trying again."，如果没有这条排除规则，
 * 它会命中 /too many tokens/i 这个溢出正则。
 */
const NON_OVERFLOW_PATTERNS = [
  /^(Throttling error|Service unavailable):/i, // AWS Bedrock 非溢出错误（formatBedrockError 的可读前缀）
  /rate limit/i, // 通用限流
  /too many requests/i, // 通用 HTTP 429
];

/**
 * 判断一条 assistant 消息是否代表上下文溢出错误。
 *
 * 处理两种情况：
 * 1. 基于错误的溢出：多数 provider 返回 stopReason "error" 及特定错误消息模式。
 * 2. 静默溢出：部分 provider 接受溢出请求并成功返回。对此类，
 *    检查 usage.input 是否超过上下文窗口。
 *
 * ## 各 Provider 的可靠性
 *
 * **可靠检测（返回带可检测消息的错误）：**
 * - Anthropic: "prompt is too long: X tokens > Y maximum" 或 "request_too_large"
 * - OpenAI (Completions & Responses): "exceeds the context window"、"exceeds the model's maximum context length of X tokens" 或 "exceeds model's maximum context length (X)"
 * - Google Gemini: "input token count exceeds the maximum"
 * - xAI (Grok): "maximum prompt length is X but request contains Y"
 * - Groq: "reduce the length of the messages"
 * - Cerebras: 400/413 status code (no body)
 * - Mistral: "Prompt contains X tokens ... too large for model with Y maximum context length"
 * - OpenRouter (大多数后端): "maximum context length is X tokens"
 * - OpenRouter/Poolside: "Input length X exceeds the maximum allowed input length of Y tokens."
 * - Together AI: "The input (X tokens) is longer than the model's context length (Y tokens)."
 * - llama.cpp: "exceeds the available context size"
 * - LM Studio: "greater than the context length"
 * - Kimi For Coding: "exceeded model token limit: X (requested: Y)"
 * - DS4: "Prompt has X tokens, but the configured context size is Y tokens"
 * - DashScope/Qwen: "Range of input length should be [1, X]"
 *
 * **不可靠检测：**
 * - z.ai: 有时静默接受溢出（可通过 usage.input > contextWindow 检测），
 *   有时返回限流错误。传入 contextWindow 参数以检测静默溢出。
 * - Xiaomi MiMo: 截断输入以适配 contextWindow 后返回 stopReason "length" 且
 *   output=0。传入 contextWindow 参数以通过「填满上下文 + 零输出」信号检测。
 * - Ollama: 部分部署静默截断，但其它可能返回命中上述正则的显式溢出错误。
 *   静默截断仍无法在此检测，因为我们不知道预期的 token 数。
 *
 * ## 自定义 Provider
 *
 * 如果你通过 settings.json 添加了自定义模型，此函数可能无法检测这些 provider
 * 的溢出错误。要添加支持：
 *
 * 1. 发送一个超过模型上下文窗口的请求
 * 2. 检查响应中的 errorMessage
 * 3. 创建一个匹配该错误的正则
 * 4. 把正则添加到本文件的 OVERFLOW_PATTERNS，或在调用此函数前自行检查 errorMessage
 *
 * @param message - 要检查的 assistant 消息
 * @param contextWindow - 可选的上下文窗口大小，用于检测静默溢出（z.ai）
 * @returns 如果该消息表示上下文溢出则返回 true
 */
export function isContextOverflow(message: AssistantMessage, contextWindow?: number): boolean {
  // Case 1: 检查错误消息模式
  if (message.stopReason === "error" && message.errorMessage) {
    // 跳过命中已知非溢出模式的消息（例如限流 / 速率限制）
    const isNonOverflow = NON_OVERFLOW_PATTERNS.some((p) => p.test(message.errorMessage!));
    if (!isNonOverflow && OVERFLOW_PATTERNS.some((p) => p.test(message.errorMessage!))) {
      return true;
    }
  }

  // Case 2: 静默溢出（z.ai 风格）——成功但 usage 超过上下文
  if (contextWindow && message.stopReason === "stop") {
    const inputTokens = message.usage.input + (message.usage.cacheRead ?? 0);
    if (inputTokens > contextWindow) {
      return true;
    }
  }

  // Case 3: 长度截断溢出（Xiaomi MiMo 风格）——服务端把超长输入截断
  // 以适配上下文窗口，导致没有输出空间。返回 stopReason "length"
  // 且 output=0、input+cacheRead 填满上下文窗口。
  if (contextWindow && message.stopReason === "length" && message.usage.output === 0) {
    const inputTokens = message.usage.input + (message.usage.cacheRead ?? 0);
    if (inputTokens >= contextWindow * 0.99) {
      return true;
    }
  }

  return false;
}

/**
 * 获取溢出检测正则（供测试使用）。
 */
export function getOverflowPatterns(): RegExp[] {
  return [...OVERFLOW_PATTERNS];
}
