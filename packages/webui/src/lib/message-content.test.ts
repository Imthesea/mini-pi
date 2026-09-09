import { describe, it, expect } from "vitest";
import { extractTextContent } from "./message-content";

describe("extractTextContent", () => {
  it("content 为 string 时原样返回", () => {
    expect(extractTextContent("hello")).toBe("hello");
  });

  it("content 为数组时拼接 text 块", () => {
    expect(
      extractTextContent([
        { type: "text", text: "a" },
        { type: "text", text: "b" },
        { type: "image", url: "x" },
      ]),
    ).toBe("ab");
  });

  it("content 为数组但不含 text 时返回空串", () => {
    expect(extractTextContent([{ type: "image", url: "x" }])).toBe("");
  });

  it("content 为 undefined 时返回空串", () => {
    expect(extractTextContent(undefined)).toBe("");
  });
});
