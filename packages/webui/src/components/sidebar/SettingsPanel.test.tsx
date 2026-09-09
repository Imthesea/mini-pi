import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SettingsPanel } from "./SettingsPanel";
import { fetchSettings, updateSettings } from "../../lib/settings-api";

vi.mock("../../lib/settings-api", () => ({
  fetchSettings: vi.fn(),
  updateSettings: vi.fn(),
}));

const VIEW = {
  theme: "dark",
  defaultModel: "deepseek-chat",
  defaultProvider: "deepseek",
  defaultThinkingLevel: "medium",
  compaction: { enabled: true, reserveTokens: 100, keepRecentTokens: 50 },
  retry: { enabled: true, maxRetries: 3, baseDelayMs: 2000 },
  transport: "auto",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchSettings).mockResolvedValue(VIEW);
  vi.mocked(updateSettings).mockResolvedValue(VIEW);
});

describe("SettingsPanel", () => {
  it("open=false 时不渲染", () => {
    render(<SettingsPanel open={false} onClose={vi.fn()} />);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("open=true 时拉取并展示设置", async () => {
    render(<SettingsPanel open onClose={vi.fn()} />);

    expect(fetchSettings).toHaveBeenCalledTimes(1);
    expect(await screen.findByDisplayValue("deepseek-chat")).toBeInTheDocument();
  });

  it("切换上下文压缩开关会 PATCH compaction.enabled", async () => {
    render(<SettingsPanel open onClose={vi.fn()} />);
    await screen.findByRole("dialog");

    fireEvent.click(screen.getByLabelText("上下文压缩"));

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        compaction: { enabled: false },
      }),
    );
  });

  it("切换失败重试开关会 PATCH retry.enabled", async () => {
    render(<SettingsPanel open onClose={vi.fn()} />);
    await screen.findByRole("dialog");

    fireEvent.click(screen.getByLabelText("失败重试"));

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        retry: { enabled: false },
      }),
    );
  });

  it("更改传输方式会 PATCH transport", async () => {
    render(<SettingsPanel open onClose={vi.fn()} />);
    await screen.findByRole("dialog");

    fireEvent.change(screen.getByRole("combobox", { name: "传输方式" }), {
      target: { value: "sse" },
    });

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({ transport: "sse" }),
    );
  });

  it("加载失败时显示错误提示", async () => {
    vi.mocked(fetchSettings).mockRejectedValueOnce(new Error("boom"));
    render(<SettingsPanel open onClose={vi.fn()} />);

    expect(await screen.findByText("加载设置失败")).toBeInTheDocument();
  });

  it("保存失败时显示错误提示", async () => {
    vi.mocked(updateSettings).mockRejectedValueOnce(new Error("boom"));
    render(<SettingsPanel open onClose={vi.fn()} />);
    await screen.findByRole("dialog");

    fireEvent.click(screen.getByLabelText("上下文压缩"));

    expect(await screen.findByText("保存设置失败")).toBeInTheDocument();
  });

  it("默认模型失焦时保存", async () => {
    render(<SettingsPanel open onClose={vi.fn()} />);
    await screen.findByRole("dialog");

    const input = screen.getByLabelText("默认模型") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "gpt-4o" } });
    fireEvent.blur(input);

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({ defaultModel: "gpt-4o" }),
    );
  });

  it("默认 Provider 失焦时保存", async () => {
    render(<SettingsPanel open onClose={vi.fn()} />);
    await screen.findByRole("dialog");

    const input = screen.getByLabelText("默认 Provider") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "openai" } });
    fireEvent.blur(input);

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({ defaultProvider: "openai" }),
    );
  });

  it("更改主题会 PATCH theme", async () => {
    render(<SettingsPanel open onClose={vi.fn()} />);
    await screen.findByRole("dialog");

    fireEvent.change(screen.getByRole("combobox", { name: "主题" }), {
      target: { value: "light" },
    });

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({ theme: "light" }),
    );
  });

  it("更改思考层级会 PATCH defaultThinkingLevel", async () => {
    render(<SettingsPanel open onClose={vi.fn()} />);
    await screen.findByRole("dialog");

    fireEvent.change(screen.getByRole("combobox", { name: "思考层级" }), {
      target: { value: "high" },
    });

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        defaultThinkingLevel: "high",
      }),
    );
  });
});
