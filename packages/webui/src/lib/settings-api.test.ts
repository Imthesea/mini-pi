import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchSettings, updateSettings } from "./settings-api";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(response: Partial<Response>) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

const VIEW = {
  theme: "dark",
  defaultModel: "deepseek-chat",
  defaultProvider: "deepseek",
  defaultThinkingLevel: "medium",
  compaction: { enabled: true, reserveTokens: 100, keepRecentTokens: 50 },
  retry: { enabled: true, maxRetries: 3, baseDelayMs: 2000 },
  transport: "auto",
};

describe("fetchSettings", () => {
  it("GET /api/settings 并返回视图", async () => {
    const fetchMock = stubFetch(jsonResponse(VIEW));

    const view = await fetchSettings();

    expect(fetchMock).toHaveBeenCalledWith("/api/settings");
    expect(view.defaultModel).toBe("deepseek-chat");
  });

  it("非 ok 响应抛错", async () => {
    stubFetch(jsonResponse({}, false));

    await expect(fetchSettings()).rejects.toThrow();
  });
});

describe("updateSettings", () => {
  it("PATCH /api/settings 携带 patch body", async () => {
    const fetchMock = stubFetch(jsonResponse(VIEW));

    const view = await updateSettings({ theme: "light" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settings",
      expect.objectContaining({ method: "PATCH" }),
    );
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(options.body as string)).toEqual({ theme: "light" });
    expect(view.theme).toBe("dark");
  });

  it("非 ok 响应抛错", async () => {
    stubFetch(jsonResponse({}, false));

    await expect(updateSettings({ theme: "light" })).rejects.toThrow();
  });
});
