import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Composer } from "./Composer";

function renderComposer(overrides: Partial<Parameters<typeof Composer>[0]> = {}) {
  const props = {
    isRunning: false,
    currentModel: "gpt-4o",
    accessMode: "Workspace Write",
    onSend: vi.fn(),
    onStop: vi.fn(),
    ...overrides,
  };
  render(<Composer {...props} />);
  return props;
}

describe("Composer", () => {
  it("输入文本点发送触发 onSend 并清空输入框", () => {
    const onSend = vi.fn();
    renderComposer({ onSend });

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "你好" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(onSend).toHaveBeenCalledWith("你好");
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it("空输入时发送按钮禁用", () => {
    renderComposer();

    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
  });

  it("Enter 触发发送", () => {
    const onSend = vi.fn();
    renderComposer({ onSend });

    const textbox = screen.getByRole("textbox");
    fireEvent.change(textbox, { target: { value: "hi" } });
    fireEvent.keyDown(textbox, { key: "Enter" });

    expect(onSend).toHaveBeenCalledWith("hi");
  });

  it("Shift+Enter 不触发发送", () => {
    const onSend = vi.fn();
    renderComposer({ onSend });

    const textbox = screen.getByRole("textbox");
    fireEvent.change(textbox, { target: { value: "hi" } });
    fireEvent.keyDown(textbox, { key: "Enter", shiftKey: true });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("isRunning 时显示停止按钮并禁用输入框", () => {
    renderComposer({ isRunning: true });

    expect(screen.getByRole("button", { name: "停止" })).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeDisabled();
  });

  it("点击停止触发 onStop", () => {
    const onStop = vi.fn();
    renderComposer({ isRunning: true, onStop });

    fireEvent.click(screen.getByRole("button", { name: "停止" }));

    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("显示模型名", () => {
    renderComposer({ currentModel: "gpt-4o" });

    expect(screen.getByText("gpt-4o")).toBeInTheDocument();
  });

  it("显示访问模式", () => {
    renderComposer({ accessMode: "Workspace Write" });

    expect(screen.getByText("Workspace Write")).toBeInTheDocument();
  });

  it("渲染 Commands 只读按钮", () => {
    renderComposer();

    expect(
      screen.getByRole("button", { name: "Commands" }),
    ).toBeInTheDocument();
  });
});
