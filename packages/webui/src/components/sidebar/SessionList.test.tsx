import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SessionList } from "./SessionList";

type Props = Parameters<typeof SessionList>[0];

function renderList(overrides: Partial<Props> = {}) {
  const props: Props = {
    sessions: [],
    activeSessionId: null,
    onNewSession: vi.fn(),
    onSelectSession: vi.fn(),
    onDeleteSession: vi.fn(),
    ...overrides,
  };
  render(<SessionList {...props} />);
  return props;
}

describe("SessionList 设置入口", () => {
  it("传入 onOpenSettings 时渲染设置按钮", () => {
    renderList({ onOpenSettings: vi.fn() });

    expect(screen.getByRole("button", { name: "设置" })).toBeInTheDocument();
  });

  it("未传入 onOpenSettings 时不渲染设置按钮", () => {
    renderList();

    expect(screen.queryByRole("button", { name: "设置" })).toBeNull();
  });

  it("点击设置按钮触发 onOpenSettings", () => {
    const onOpenSettings = vi.fn();
    renderList({ onOpenSettings });

    fireEvent.click(screen.getByRole("button", { name: "设置" }));

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});
