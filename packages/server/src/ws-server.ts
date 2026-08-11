/**
 * WebSocket 服务：连接管理。
 * 一个 chat 一个连接，事件透传。
 */
import type { WebSocket } from "ws";
import type { IncomingMessage } from "http";

export type ClientMessage =
  | { type: "message"; content: string }
  | { type: "stop" };

export interface WsCallbacks {
  onMessage: (ws: WebSocket, msg: ClientMessage) => void;
  onClose: (ws: WebSocket) => void;
}

export function createWsServer(callbacks: WsCallbacks) {
  const connections = new Set<WebSocket>();

  function send(ws: WebSocket, event: Record<string, unknown>): void {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(event));
    }
  }

  function handleConnection(ws: WebSocket, _req: IncomingMessage): void {
    connections.add(ws);

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString()) as ClientMessage;
        callbacks.onMessage(ws, msg);
      } catch {
        // 忽略解析失败的消息
      }
    });

    ws.on("close", () => {
      connections.delete(ws);
      callbacks.onClose(ws);
    });

    ws.on("error", () => {
      connections.delete(ws);
    });
  }

  return { send, handleConnection, connections };
}
