/**
 * Settings 路由单元测试。
 */
import type { IncomingMessage, ServerResponse } from "http";
import { describe, it, expect, vi } from "vitest";
import { SettingsManager } from "@mimi/coding-agent";
import {
  readSettingsView,
  applySettingsPatch,
  handleSettings,
} from "../routes/settings.js";

function mockReq(method: string): IncomingMessage {
  return { method } as unknown as IncomingMessage;
}

function mockReqWithBody(
  method: string,
  body: Record<string, unknown>,
): IncomingMessage {
  const json = JSON.stringify(body);
  return {
    method,
    on(event: string, cb: (chunk?: string) => void) {
      if (event === "data") cb(json);
      if (event === "end") cb();
      return this;
    },
  } as unknown as IncomingMessage;
}

function mockRes() {
  return {
    writeHead: vi.fn(),
    end: vi.fn(),
  } as unknown as {
    writeHead: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  };
}

describe("readSettingsView", () => {
  it("返回精简视图", () => {
    const sm = SettingsManager.inMemory({
      theme: "dark",
      defaultModel: "deepseek-chat",
      defaultProvider: "deepseek",
      defaultThinkingLevel: "medium",
      compaction: { enabled: true, reserveTokens: 100, keepRecentTokens: 50 },
      retry: { enabled: false, maxRetries: 1, baseDelayMs: 10 },
      transport: "websocket",
    });
    const view = readSettingsView(sm);
    expect(view.theme).toBe("dark");
    expect(view.defaultModel).toBe("deepseek-chat");
    expect(view.defaultProvider).toBe("deepseek");
    expect(view.defaultThinkingLevel).toBe("medium");
    expect(view.compaction.enabled).toBe(true);
    expect(view.retry.enabled).toBe(false);
    expect(view.transport).toBe("websocket");
  });

  it("未设置字段返回 null", () => {
    const sm = SettingsManager.inMemory({});
    const view = readSettingsView(sm);
    expect(view.theme).toBeNull();
    expect(view.defaultModel).toBeNull();
    expect(view.defaultProvider).toBeNull();
    expect(view.defaultThinkingLevel).toBeNull();
  });
});

describe("applySettingsPatch", () => {
  it("应用合法字段", () => {
    const sm = SettingsManager.inMemory({});
    applySettingsPatch(sm, {
      theme: "light",
      defaultModel: "deepseek-chat",
      defaultProvider: "deepseek",
      defaultThinkingLevel: "high",
      compaction: { enabled: false },
      retry: { enabled: false },
      transport: "sse",
    });
    expect(sm.getTheme()).toBe("light");
    expect(sm.getDefaultModel()).toBe("deepseek-chat");
    expect(sm.getDefaultProvider()).toBe("deepseek");
    expect(sm.getDefaultThinkingLevel()).toBe("high");
    expect(sm.getCompactionEnabled()).toBe(false);
    expect(sm.getRetryEnabled()).toBe(false);
    expect(sm.getTransport()).toBe("sse");
  });

  it("忽略非法/未知字段", () => {
    const sm = SettingsManager.inMemory({ theme: "dark" });
    applySettingsPatch(sm, {
      theme: 123, // 非 string
      defaultThinkingLevel: "bogus", // 非法 level
      compaction: { enabled: "yes" }, // 非 boolean
      bogus: "x",
    });
    expect(sm.getTheme()).toBe("dark");
    expect(sm.getDefaultThinkingLevel()).toBeUndefined();
    expect(sm.getCompactionEnabled()).toBe(true); // 默认值，未被改
  });
});

describe("handleSettings", () => {
  it("GET 返回 settings 视图", async () => {
    const sm = SettingsManager.inMemory({ theme: "dark" });
    const res = mockRes();
    await handleSettings(
      mockReq("GET"),
      res as unknown as ServerResponse,
      "/api/settings",
      sm,
    );
    const body = JSON.parse(res.end.mock.calls[0][0] as string);
    expect(body.theme).toBe("dark");
  });

  it("PATCH 应用后返回更新视图", async () => {
    const sm = SettingsManager.inMemory({});
    const res = mockRes();
    await handleSettings(
      mockReqWithBody("PATCH", { theme: "light" }),
      res as unknown as ServerResponse,
      "/api/settings",
      sm,
    );
    const body = JSON.parse(res.end.mock.calls[0][0] as string);
    expect(body.theme).toBe("light");
    expect(sm.getTheme()).toBe("light");
  });

  it("未知路径返回 404", async () => {
    const sm = SettingsManager.inMemory({});
    const res = mockRes();
    await handleSettings(
      mockReq("GET"),
      res as unknown as ServerResponse,
      "/api/unknown",
      sm,
    );
    expect(res.writeHead).toHaveBeenCalledWith(404, expect.anything());
  });
});
