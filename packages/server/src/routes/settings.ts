/**
 * Settings API：读取/更新全局设置。
 *
 * 只暴露 v1 面板需要的核心配置，其余配置留在 SettingsManager 内部。
 */
import type { IncomingMessage, ServerResponse } from "http";
import type { SettingsManager } from "@mimi/coding-agent";

const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
type ThinkingLevelValue = (typeof THINKING_LEVELS)[number];

/** 读取 request body 并解析 JSON */
function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data) as Record<string, unknown>);
      } catch {
        resolve({});
      }
    });
  });
}

function isThinkingLevel(v: unknown): v is ThinkingLevelValue {
  return (
    typeof v === "string" && (THINKING_LEVELS as readonly string[]).includes(v)
  );
}

/** 读取 settings 的精简视图（供前端 Settings 面板展示） */
export function readSettingsView(sm: SettingsManager) {
  return {
    theme: sm.getTheme() ?? null,
    defaultModel: sm.getDefaultModel() ?? null,
    defaultProvider: sm.getDefaultProvider() ?? null,
    defaultThinkingLevel: sm.getDefaultThinkingLevel() ?? null,
    compaction: sm.getCompactionSettings(),
    retry: sm.getRetrySettings(),
    transport: sm.getTransport(),
  };
}

/** 把 PATCH body 应用到 settings，忽略未知/非法字段 */
export function applySettingsPatch(
  sm: SettingsManager,
  patch: Record<string, unknown>,
): void {
  if (typeof patch.theme === "string") sm.setTheme(patch.theme);
  if (typeof patch.defaultModel === "string") sm.setDefaultModel(patch.defaultModel);
  if (typeof patch.defaultProvider === "string")
    sm.setDefaultProvider(patch.defaultProvider);
  if (isThinkingLevel(patch.defaultThinkingLevel))
    sm.setDefaultThinkingLevel(patch.defaultThinkingLevel);
  if (typeof patch.transport === "string") sm.setTransport(patch.transport);

  if (patch.compaction && typeof patch.compaction === "object") {
    const enabled = (patch.compaction as { enabled?: unknown }).enabled;
    if (typeof enabled === "boolean") sm.setCompactionEnabled(enabled);
  }
  if (patch.retry && typeof patch.retry === "object") {
    const enabled = (patch.retry as { enabled?: unknown }).enabled;
    if (typeof enabled === "boolean") sm.setRetryEnabled(enabled);
  }
}

export async function handleSettings(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  settingsManager: SettingsManager,
): Promise<void> {
  // GET /api/settings - 读取
  if (url === "/api/settings" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(readSettingsView(settingsManager)));
    return;
  }

  // PATCH /api/settings - 更新
  if (url === "/api/settings" && req.method === "PATCH") {
    const patch = await readJsonBody(req);
    applySettingsPatch(settingsManager, patch);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(readSettingsView(settingsManager)));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not Found" }));
}
