import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { UserMessage } from "./UserMessage";

const writeText = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

describe("UserMessage", () => {
  it("渲染 content", () => {
    render(
      <UserMessage message={{ id: "u1", role: "user", content: "你好" }} />,
    );

    expect(screen.getByText("你好")).toBeInTheDocument();
  });

  it("点击复制按钮写入剪贴板", () => {
    render(
      <UserMessage message={{ id: "u1", role: "user", content: "你好" }} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "复制" }));

    expect(writeText).toHaveBeenCalledWith("你好");
  });
});
