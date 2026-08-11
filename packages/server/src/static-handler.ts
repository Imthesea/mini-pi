/**
 * 托管 webui 构建产物的静态文件服务。
 * SPA fallback: /api/ 以外的路径返回 index.html。
 */
import type { IncomingMessage, ServerResponse } from "http";
import { createReadStream, existsSync, statSync } from "fs";
import { join, extname } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const STATIC_DIR = join(__dirname, "..", "static");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".json": "application/json",
};

export function handleStatic(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
): void {
  if (req.method !== "GET") return;

  // 去掉 query string
  let filePath = url;
  const qIndex = filePath.indexOf("?");
  if (qIndex !== -1) filePath = filePath.slice(0, qIndex);

  // 根路径 → index.html
  if (filePath === "/" || filePath === "") {
    filePath = "/index.html";
  }

  const fullPath = join(STATIC_DIR, filePath);

  // 安全检查：防止路径穿越
  if (!fullPath.startsWith(STATIC_DIR)) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  if (existsSync(fullPath) && statSync(fullPath).isFile()) {
    serveFile(res, fullPath);
    return;
  }

  // SPA fallback: 所有非 /api/ 路径返回 index.html
  if (!url.startsWith("/api/")) {
    const indexPath = join(STATIC_DIR, "index.html");
    if (existsSync(indexPath)) {
      serveFile(res, indexPath);
      return;
    }
  }

  res.writeHead(404).end("Not Found");
}

function serveFile(res: ServerResponse, filePath: string): void {
  const ext = extname(filePath);
  const mime = MIME_TYPES[ext] ?? "application/octet-stream";
  const size = statSync(filePath).size;

  res.writeHead(200, {
    "Content-Type": mime,
    "Content-Length": size,
    "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600",
  });

  createReadStream(filePath).pipe(res);
}
