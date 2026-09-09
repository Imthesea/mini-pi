import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ToolRow } from "./ToolRow";

describe("ToolRow", () => {
  it("status=running 渲染 spinner", () => {
    const { container } = render(
      <ToolRow
        tool={{ toolCallId: "t1", toolName: "Read", status: "running" }}
        onClick={vi.fn()}
      />,
    );

    expect(container.querySelector(".animate-spin")).toBeTruthy();
  });

  it("status=done 显示完成图标", () => {
    const { container } = render(
      <ToolRow
        tool={{ toolCallId: "t1", toolName: "Read", status: "done" }}
        onClick={vi.fn()}
      />,
    );

    expect(container.querySelector(".text-success")).toBeTruthy();
  });

  it("status=error 显示错误图标", () => {
    const { container } = render(
      <ToolRow
        tool={{ toolCallId: "t1", toolName: "Read", status: "error" }}
        onClick={vi.fn()}
      />,
    );

    expect(container.querySelector(".text-danger")).toBeTruthy();
  });

  it("显示参数摘要", () => {
    render(
      <ToolRow
        tool={{
          toolCallId: "t1",
          toolName: "Read",
          status: "done",
          args: { filePath: "a.txt" },
        }}
        onClick={vi.fn()}
      />,
    );

    expect(screen.getByText("Read a.txt")).toBeInTheDocument();
  });

  it("点击触发 onClick", () => {
    const onClick = vi.fn();
    render(
      <ToolRow
        tool={{ toolCallId: "t1", toolName: "Read", status: "done" }}
        onClick={onClick}
      />,
    );

    fireEvent.click(screen.getByRole("button"));

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
