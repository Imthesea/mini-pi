import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AppFrame } from "./AppFrame";

describe("AppFrame", () => {
  it("渲染三栏（侧边栏/主区/详情列）", () => {
    render(
      <AppFrame
        sidebar={<span>侧边栏内容</span>}
        sidebarCollapsed={false}
        onToggleSidebar={vi.fn()}
        conversation={<span>对话内容</span>}
        details={<span>详情内容</span>}
      />,
    );

    expect(screen.getByText("侧边栏内容")).toBeInTheDocument();
    expect(screen.getByText("对话内容")).toBeInTheDocument();
    expect(screen.getByText("详情内容")).toBeInTheDocument();
  });

  it("details 为 undefined 时不渲染详情列", () => {
    const { container } = render(
      <AppFrame
        sidebar={<span>s</span>}
        sidebarCollapsed={false}
        onToggleSidebar={vi.fn()}
        conversation={<span>c</span>}
      />,
    );

    expect(container.querySelector("aside")).toBeNull();
  });

  it("sidebarCollapsed 时渲染展开按钮且不渲染侧边栏内容", () => {
    render(
      <AppFrame
        sidebar={<span>侧边栏内容</span>}
        sidebarCollapsed={true}
        onToggleSidebar={vi.fn()}
        conversation={<span>c</span>}
      />,
    );

    expect(
      screen.getByRole("button", { name: "展开侧边栏" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("侧边栏内容")).not.toBeInTheDocument();
  });

  it("点击展开按钮触发 onToggleSidebar", () => {
    const onToggleSidebar = vi.fn();
    render(
      <AppFrame
        sidebar={<span>s</span>}
        sidebarCollapsed={true}
        onToggleSidebar={onToggleSidebar}
        conversation={<span>c</span>}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "展开侧边栏" }));

    expect(onToggleSidebar).toHaveBeenCalledTimes(1);
  });
});
