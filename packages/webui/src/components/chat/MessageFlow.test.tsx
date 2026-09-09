import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MessageFlow } from "./MessageFlow";

vi.mock("../MarkdownRenderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => (
    <div data-testid="md">{content}</div>
  ),
}));

describe("MessageFlow", () => {
  it("空消息且非运行显示空态提示", () => {
    render(
      <MessageFlow messages={[]} isRunning={false} onSelectTool={vi.fn()} />,
    );

    expect(screen.getByText("发送消息开始对话")).toBeInTheDocument();
  });

  it("多消息按序渲染 user/assistant", () => {
    render(
      <MessageFlow
        messages={[
          { id: "u1", role: "user", content: "问题" },
          { id: "a1", role: "assistant", content: "回答" },
        ]}
        isRunning={false}
        onSelectTool={vi.fn()}
      />,
    );

    expect(screen.getByText("问题")).toBeInTheDocument();
    expect(screen.getByTestId("md")).toHaveTextContent("回答");
  });
});
