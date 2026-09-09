import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Hero } from "./Hero";

describe("Hero", () => {
  it("渲染标题和副标题", () => {
    render(
      <Hero
        currentModel="gpt-4o"
        accessMode="Workspace Write"
        onSend={vi.fn()}
      />,
    );

    expect(screen.getByText("mimi")).toBeInTheDocument();
    expect(screen.getByText("描述你想构建的东西")).toBeInTheDocument();
  });

  it("输入后发送触发 onSend", () => {
    const onSend = vi.fn();
    render(
      <Hero
        currentModel="gpt-4o"
        accessMode="Workspace Write"
        onSend={onSend}
      />,
    );

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "构建一个网站" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(onSend).toHaveBeenCalledWith("构建一个网站");
  });
});
