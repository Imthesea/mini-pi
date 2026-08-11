export interface WsClient {
  connect(url: string): void;
  send(msg: unknown): void;
  close(): void;
  onEvent(handler: (event: unknown) => void): () => void;
}

export function createWsClient(): WsClient {
  let ws: WebSocket | null = null;
  let url = "";
  const handlers = new Set<(event: unknown) => void>();
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function connect(wsUrl: string) {
    url = wsUrl;
    close();

    ws = new WebSocket(wsUrl);
    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        handlers.forEach((h) => h(data));
      } catch {
        // ignore non-JSON messages
      }
    };

    ws.onclose = () => {
      ws = null;
      // 自动重连
      if (url) {
        reconnectTimer = setTimeout(() => connect(url), 2000);
      }
    };

    ws.onerror = () => {
      ws?.close();
    };
  }

  function send(msg: unknown) {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  function close() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    url = "";
    if (ws) {
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      ws.close();
    }
  }

  function onEvent(handler: (event: unknown) => void): () => void {
    handlers.add(handler);
    return () => handlers.delete(handler);
  }

  return { connect, send, close, onEvent };
}
