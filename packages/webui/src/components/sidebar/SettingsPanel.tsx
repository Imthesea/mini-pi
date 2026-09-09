import { useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { fetchSettings, updateSettings } from "../../lib/settings-api";
import type { SettingsPatch, SettingsView } from "../../lib/types";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];
const THEME_OPTIONS = ["auto", "light", "dark"];
const TRANSPORT_OPTIONS = ["auto", "websocket", "sse"];

/** 字段标签 + 控件的小包裹，减少重复 */
function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/**
 * 设置面板（模态）。
 *
 * open 为 true 时拉取全局设置，展示可编辑项；改动即 PATCH 保存，
 * 并用返回的视图回填。文本项失焦保存，下拉/开关即时保存。
 */
export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    setSettings(null);
    fetchSettings()
      .then((view) => {
        if (!cancelled) setSettings(view);
      })
      .catch(() => {
        if (!cancelled) setError("加载设置失败");
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  async function apply(patch: SettingsPatch) {
    setError(null);
    try {
      const view = await updateSettings(patch);
      setSettings(view);
    } catch {
      setError("保存设置失败");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="设置"
    >
      <div
        className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-lg border border-border bg-background p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold">设置</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && <p className="mb-3 text-xs text-danger">{error}</p>}

        {!settings ? (
          <p className="text-sm text-muted-foreground">加载中...</p>
        ) : (
          <div className="flex flex-col gap-4">
            <Field label="默认模型">
              <Input
                defaultValue={settings.defaultModel ?? ""}
                placeholder="未设置"
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v !== (settings.defaultModel ?? "")) {
                    apply({ defaultModel: v });
                  }
                }}
              />
            </Field>

            <Field label="默认 Provider">
              <Input
                defaultValue={settings.defaultProvider ?? ""}
                placeholder="未设置"
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v !== (settings.defaultProvider ?? "")) {
                    apply({ defaultProvider: v });
                  }
                }}
              />
            </Field>

            <Field label="思考层级">
              <select
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={settings.defaultThinkingLevel ?? "off"}
                onChange={(e) => apply({ defaultThinkingLevel: e.target.value })}
              >
                {THINKING_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="主题">
              <select
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={settings.theme ?? "auto"}
                onChange={(e) => apply({ theme: e.target.value })}
              >
                {THEME_OPTIONS.map((theme) => (
                  <option key={theme} value={theme}>
                    {theme}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="传输方式">
              <select
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={settings.transport}
                onChange={(e) => apply({ transport: e.target.value })}
              >
                {TRANSPORT_OPTIONS.map((transport) => (
                  <option key={transport} value={transport}>
                    {transport}
                  </option>
                ))}
              </select>
            </Field>

            <div className="flex flex-col gap-3 border-t border-border pt-3">
              <label className="flex items-center justify-between text-xs">
                <span>上下文压缩</span>
                <input
                  type="checkbox"
                  checked={settings.compaction.enabled}
                  onChange={(e) =>
                    apply({ compaction: { enabled: e.target.checked } })
                  }
                />
              </label>

              <label className="flex items-center justify-between text-xs">
                <span>失败重试</span>
                <input
                  type="checkbox"
                  checked={settings.retry.enabled}
                  onChange={(e) =>
                    apply({ retry: { enabled: e.target.checked } })
                  }
                />
              </label>
            </div>
          </div>
        )}

        <div className="mt-5 flex justify-end">
          <Button variant="ghost" size="sm" onClick={onClose}>
            完成
          </Button>
        </div>
      </div>
    </div>
  );
}
