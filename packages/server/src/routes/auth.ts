/**
 * POST /api/auth — 签发访问票证。
 * v1 localhost 免密：直接返回 token。
 */
import type { IncomingMessage, ServerResponse } from "http";

export function handleAuth(
  req: IncomingMessage,
  res: ServerResponse,
  issueToken: () => { token: string; expiresIn: number },
): void {
  if (req.method !== "POST") {
    res.writeHead(405).end("Method Not Allowed");
    return;
  }

  const { token, expiresIn } = issueToken();
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ token, expires_in: expiresIn }));
}
