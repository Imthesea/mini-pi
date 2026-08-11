let token: string | null = null;

export async function authenticate(): Promise<void> {
  if (token) return;

  const res = await fetch("/api/auth", { method: "POST" });
  if (!res.ok) throw new Error("Authentication failed");
  const data = await res.json();
  token = data.token;
}

export async function request<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  if (options.body && typeof options.body === "string") {
    headers["Content-Type"] = headers["Content-Type"] || "application/json";
  }

  const res = await fetch(path, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

export function getToken(): string | null {
  return token;
}
