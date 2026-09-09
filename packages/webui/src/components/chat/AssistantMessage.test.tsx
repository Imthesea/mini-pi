import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AssistantMessage } from "./AssistantMessage";

vi.mock("../MarkdownRenderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => (
    <div data-testid="md">{content}</div>
  ),
}));

describe("AssistantMessage", () => {
  it("有 thinking 默认折叠，点击展开", () => {
    render(
      <AssistantMessage
        message={{
          id: "a1",
          role: "assistant",
          content: "",
          thinkingContent: "思考内容",
        }}
        onSelectTool={vi.fn()}
      />,
    );

    expect(screen.queryByText("思考内容")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "思考过程" }));

    expect(screen.getByText("思考内容")).toBeInTheDocument();
  });

  it("有 toolCalls 时渲染对应数量 ToolRow", () => {
    render(
      <AssistantMessage
        message={{
          id: "a1",
          role: "assistant",
          content: "",
          toolCalls: [
            {
              toolCallId: "t1",
              toolName: "Read",
              status: "done",
              args: { filePath: "a.txt" },
            },
            {
              toolCallId: "t2",
              toolName: "Bash",
              status: "done",
              args: { command: "ls" },
            },
          ],
        }}
        onSelectTool={vi.fn()}
      />,
    );

    expect(screen.getByText("Read a.txt")).toBeInTheDocument();
    expect(screen.getByText("Bash ls")).toBeInTheDocument();
  });

  it("点击 ToolRow 触发 onSelectTool", () => {
    const onSelectTool = vi.fn();
    const tool = {
      toolCallId: "t1",
      toolName: "Read",
      status: "done" as const,
      args: { filePath: "a.txt" },
    };
    render(
      <AssistantMessage
        message={{ id: "a1", role: "assistant", content: "", toolCalls: [tool] }}
        onSelectTool={onSelectTool}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Read/ }));

    expect(onSelectTool).toHaveBeenCalledWith(tool);
  });

  it("无工具时只渲染正文", () => {
    render(
      <AssistantMessage
        message={{ id: "a1", role: "assistant", content: "正文" }}
        onSelectTool={vi.fn()}
      />,
    );

    expect(screen.getByTestId("md")).toHaveTextContent("正文");
  });
});
