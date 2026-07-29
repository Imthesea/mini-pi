/**
 * 流式 JSON 解析：用于工具调用参数的增量解析。
 * 后续可扩展为使用 partial-json 等库做更鲁棒的解析。
 */

/**
 * 尝试解析可能不完整的 JSON 字符串。
 * 成功返回解析结果，失败返回空对象。
 */
export function parseStreamingJson(jsonStr: string): Record<string, unknown> {
  try {
    return JSON.parse(jsonStr) as Record<string, unknown>;
  } catch {
    // JSON 不完整（流式传输中），返回空对象
    return {};
  }
}
