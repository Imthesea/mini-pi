import { useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

export function SetupView() {
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!apiKey.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/setup/apikey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save API key");
      }
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-6 rounded-lg border border-border p-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">mimi</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            AI Coding Assistant
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">
            DeepSeek API Key
          </label>
          <Input
            type="password"
            placeholder="sk-..."
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          />
          {error && (
            <p className="text-sm text-red-500">{error}</p>
          )}
        </div>

        <Button
          className="w-full"
          onClick={handleSubmit}
          disabled={loading || !apiKey.trim()}
        >
          {loading ? "保存中..." : "开始使用"}
        </Button>
      </div>
    </div>
  );
}
