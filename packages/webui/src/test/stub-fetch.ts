import { vi } from "vitest";

/** 用 vi.stubGlobal 替换全局 fetch，返回 mock 以便断言调用参数。 */
export function stubFetch(response: Partial<Response>) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** 构造一个最小的 Response 形状，供 fetch mock 返回。 */
export function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}
