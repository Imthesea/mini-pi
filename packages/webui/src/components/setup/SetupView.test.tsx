import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SetupView } from "./SetupView";

const originalLocationDescriptor = Object.getOwnPropertyDescriptor(
  window,
  "location",
);

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalLocationDescriptor) {
    Object.defineProperty(window, "location", originalLocationDescriptor);
  }
});

function stubFetch(ok: boolean, body: unknown = {}) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    json: () => Promise.resolve(body),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function stubLocationReload() {
  const reload = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { reload },
  });
  return reload;
}

describe("SetupView", () => {
  it("渲染表单：输入框 + 提交按钮", () => {
    render(<SetupView />);

    expect(screen.getByPlaceholderText("sk-...")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "开始使用" }),
    ).toBeInTheDocument();
  });

  it("空 key 时提交按钮禁用", () => {
    render(<SetupView />);

    expect(screen.getByRole("button", { name: "开始使用" })).toBeDisabled();
  });

  it("提交成功触发 location.reload", async () => {
    stubFetch(true);
    const reload = stubLocationReload();

    render(<SetupView />);
    fireEvent.change(screen.getByPlaceholderText("sk-..."), {
      target: { value: "sk-test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "开始使用" }));

    await waitFor(() => expect(reload).toHaveBeenCalled());
  });

  it("提交失败显示错误信息", async () => {
    stubFetch(false, { error: "无效的 API Key" });

    render(<SetupView />);
    fireEvent.change(screen.getByPlaceholderText("sk-..."), {
      target: { value: "bad-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "开始使用" }));

    await waitFor(() =>
      expect(screen.getByText("无效的 API Key")).toBeInTheDocument(),
    );
  });

  it("Enter 触发提交", async () => {
    stubFetch(true);
    const reload = stubLocationReload();

    render(<SetupView />);
    const input = screen.getByPlaceholderText("sk-...");
    fireEvent.change(input, { target: { value: "sk-test" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(reload).toHaveBeenCalled());
  });
});
