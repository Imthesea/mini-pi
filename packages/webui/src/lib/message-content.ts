interface TextBlock {
  type: string;
  text?: string;
}

/** 从 message.content（string 或 content 数组）提取纯文本 */
export function extractTextContent(
  content: string | unknown[] | undefined,
): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter(
        (c): c is TextBlock =>
          typeof c === "object" &&
          c !== null &&
          (c as TextBlock).type === "text",
      )
      .map((c) => c.text ?? "")
      .join("");
  }
  return "";
}
