import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DetailsPanel } from "./DetailsPanel";

describe("DetailsPanel", () => {
  it("tool=null 显示空态", () => {
    render(<DetailsPanel tool={null} onClose={vi.fn()} />);

    expect(screen.getByText("点击工具行查看详情")).toBeInTheDocument();
  });

  it("有 tool 时显示 toolName 与 args", () => {
    const { container } = render(
      <DetailsPanel
        tool={{
          toolCallId: "t1",
          toolName: "Read",
          status: "done",
          args: { filePath: "a.txt" },
        }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Read")).toBeInTheDocument();
    const pre = container.querySelector("pre");
    expect(pre?.textContent).toContain("a.txt");
  });

  it("点关闭触发 onClose", () => {
    const onClose = vi.fn();
    render(<DetailsPanel tool={null} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "关闭详情" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
