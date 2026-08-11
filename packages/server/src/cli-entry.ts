/**
 * `mimi-serve` CLI 入口。启动 Web UI 服务。
 *
 * 使用方式：npx mimi-serve [--port <number>]
 */
import {
  SettingsManager,
  SessionManager,
  createAgentSessionServices,
  getAgentDir,
} from "@mimi/coding-agent";
import { startServer } from "./index.js";

function parsePort(): number {
  const portIndex = process.argv.indexOf("--port");
  if (portIndex !== -1 && portIndex + 1 < process.argv.length) {
    const port = parseInt(process.argv[portIndex + 1], 10);
    if (!isNaN(port) && port > 0 && port < 65536) return port;
  }
  return 32123;
}

async function main(): Promise<void> {
  const cwd = process.cwd();
  const agentDir = getAgentDir();
  const port = parsePort();

  const settingsManager = SettingsManager.create(cwd, agentDir);
  const sessionManager = await SessionManager.continueRecent(cwd);
  const services = await createAgentSessionServices({ cwd, agentDir });

  await startServer({
    port,
    cwd,
    settingsManager,
    sessionManager,
    services,
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
