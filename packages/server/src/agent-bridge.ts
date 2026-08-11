/**
 * Agent 桥接：订阅 AgentSessionEvent 并转发到 WebSocket。
 */
import type { WebSocket } from "ws";
import type { AgentSession, AgentSessionEvent } from "@mimi/coding-agent";
import type { createWsServer } from "./ws-server.js";

/** WS 连接的 session 绑定表 */
const wsSessionMap = new WeakMap<WebSocket, AgentSession>();

export function createAgentBridge(
  wsServer: ReturnType<typeof createWsServer>,
) {
  function bindSession(ws: WebSocket, session: AgentSession): void {
    // 先解除旧绑定（防止重复连接）
    const existing = wsSessionMap.get(ws);
    if (existing) {
      existing.abort();
    }

    wsSessionMap.set(ws, session);

    const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
      wsServer.send(ws, event as unknown as Record<string, unknown>);
    });

    ws.on("close", unsubscribe);
  }

  function unbindSession(ws: WebSocket): void {
    const session = wsSessionMap.get(ws);
    if (session) {
      session.abort();
      wsSessionMap.delete(ws);
    }
  }

  function getSession(ws: WebSocket): AgentSession | undefined {
    return wsSessionMap.get(ws);
  }

  return { bindSession, unbindSession, getSession };
}
