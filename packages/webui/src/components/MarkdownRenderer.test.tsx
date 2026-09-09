import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MarkdownRenderer } from "./MarkdownRenderer";

describe("MarkdownRenderer", () => {
  it("纯文本渲染为段落", () => {
    const { container } = render(<MarkdownRenderer content="hello" />);

    const p = container.querySelector("p");
    expect(p).toHaveTextContent("hello");
  });

  it("代码块渲染 pre/code", () => {
    const { container } = render(
      <MarkdownRenderer content={"```js\nconst a = 1;\n```"} />,
    );

    expect(container.querySelector("pre")).toBeInTheDocument();
    expect(container.querySelector("pre code")).toBeInTheDocument();
  });

  it("内联代码渲染 inline code（无 pre 包裹）", () => {
    const { container } = render(
      <MarkdownRenderer content={"用 `foo()` 调用"} />,
    );

    const code = container.querySelector("code");
    expect(code).toHaveTextContent("foo()");
    expect(container.querySelector("pre")).toBeNull();
  });
});
