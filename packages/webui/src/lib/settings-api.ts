import type { SettingsPatch, SettingsView } from "./types";

/** 读取全局设置 */
export async function fetchSettings(): Promise<SettingsView> {
  const res = await fetch("/api/settings");
  if (!res.ok) throw new Error(`Failed to load settings: ${res.status}`);
  return res.json();
}

/** 更新全局设置，返回更新后的视图 */
export async function updateSettings(
  patch: SettingsPatch,
): Promise<SettingsView> {
  const res = await fetch("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Failed to update settings: ${res.status}`);
  return res.json();
}
