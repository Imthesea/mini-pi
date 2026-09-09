import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button } from "./button";

describe("Button", () => {
  it("默认渲染包含 children", () => {
    render(<Button>点我</Button>);

    expect(screen.getByRole("button", { name: "点我" })).toBeInTheDocument();
  });

  it("variant=primary 含 bg-primary 类", () => {
    render(<Button variant="primary">主按钮</Button>);

    expect(screen.getByRole("button")).toHaveClass("bg-primary");
  });

  it("variant=ghost / outline 类正确", () => {
    const { rerender } = render(<Button variant="ghost">g</Button>);
    expect(screen.getByRole("button")).toHaveClass("hover:bg-muted");

    rerender(<Button variant="outline">o</Button>);
    expect(screen.getByRole("button")).toHaveClass("border-border");
  });

  it("size=sm 含 h-7 尺寸类", () => {
    render(<Button size="sm">小</Button>);

    expect(screen.getByRole("button")).toHaveClass("h-7");
  });

  it("disabled 点击不触发 onClick", () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        d
      </Button>,
    );

    fireEvent.click(screen.getByRole("button"));

    expect(onClick).not.toHaveBeenCalled();
  });

  it("点击触发 onClick 一次", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>点</Button>);

    fireEvent.click(screen.getByRole("button"));

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
