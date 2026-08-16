import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// 每次重新导入模块，隔离模块级 token 状态
let api: typeof import("./api");

beforeEach(async () => {
  vi.resetModules();
  api = await import("./api");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(response: Partial<Response>) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe("authenticate", () => {
  it("首次调用请求 token 并缓存", async () => {
    const fetchMock = stubFetch(jsonResponse({ token: "abc" }));

    await api.authenticate();

    expect(fetchMock).toHaveBeenCalledWith("/api/auth", { method: "POST" });
    expect(api.getToken()).toBe("abc");
  });

  it("已缓存 token 时不重复请求", async () => {
    const fetchMock = stubFetch(jsonResponse({ token: "abc" }));

    await api.authenticate();
    await api.authenticate();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("认证失败时抛错", async () => {
    stubFetch(jsonResponse({}, false, 401));

    await expect(api.authenticate()).rejects.toThrow("Authentication failed");
  });
});

describe("request", () => {
  it("有 token 时附带 Authorization header", async () => {
    stubFetch(jsonResponse({ token: "abc" }));
    await api.authenticate();

    const fetchMock = stubFetch(jsonResponse({ data: 1 }));
    await api.request("/api/data");

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(options.headers).toMatchObject({ Authorization: "Bearer abc" });
  });

  it("无 token 时不附带 Authorization header", async () => {
    const fetchMock = stubFetch(jsonResponse({ data: 1 }));

    await api.request("/api/data");

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(options.headers).not.toHaveProperty("Authorization");
  });

  it("非 2xx 响应抛错并带上服务端 error", async () => {
    stubFetch(jsonResponse({ error: "bad request" }, false, 400));

    await expect(api.request("/api/data")).rejects.toThrow("bad request");
  });
});

describe("getToken", () => {
  it("未认证时返回 null", () => {
    expect(api.getToken()).toBeNull();
  });
});
