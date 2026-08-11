/**
 * Setup API：首次启动引导，检测和写入 API Key。
 */
import type { IncomingMessage, ServerResponse } from "http";
import { existsSync, readFileSync, writeFileSync, appendFileSync } from "fs";
import { join } from "path";

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

/** 检测是否已配置 API Key */
function hasApiKey(cwd: string): boolean {
  // 检查环境变量
  const envKeys = [
    "MIMI_API_KEY_DEEPSEEK",
    "MIMI_API_KEY_ANTHROPIC",
    "MIMI_API_KEY_OPENAI",
  ];
  for (const key of envKeys) {
    if (process.env[key]) return true;
  }

  // 检查 .env 文件
  const envPath = join(cwd, ".env");
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, "utf-8");
    for (const key of envKeys) {
      if (content.includes(`${key}=`) && !content.includes(`${key}=\r\n`) && !content.includes(`${key}=\n`)) {
        return true;
      }
    }
  }

  return false;
}

export async function handleSetup(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  cwd: string,
): Promise<void> {
  // GET /api/setup/status - 检测 API Key 配置状态
  if (url === "/api/setup/status" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ hasApiKey: hasApiKey(cwd) }));
    return;
  }

  // POST /api/setup/apikey - 写入 API Key 到 .env
  if (url === "/api/setup/apikey" && req.method === "POST") {
    const body = await readJsonBody(req);
    const apiKey = body.apiKey as string | undefined;

    if (!apiKey || !apiKey.trim()) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "apiKey is required" }));
      return;
    }

    const envPath = join(cwd, ".env");
    const line = `MIMI_API_KEY_DEEPSEEK=${apiKey.trim()}\n`;

    try {
      if (existsSync(envPath)) {
        appendFileSync(envPath, line, "utf-8");
      } else {
        writeFileSync(envPath, line, "utf-8");
      }
      // 同步设置到当前进程环境变量
      process.env.MIMI_API_KEY_DEEPSEEK = apiKey.trim();

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to write .env" }));
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not Found" }));
}
