import { useEffect, useRef, useCallback } from "react";
import { authenticate } from "../lib/api";
import { createWsClient, type WsClient } from "../lib/client";

interface UseWebSocketOptions {
  sessionId: string;
}

interface UseWebSocketResult {
  send: (msg: unknown) => void;
  onEvent: (handler: (event: unknown) => void) => () => void;
}

export function useWebSocket({
  sessionId,
}: UseWebSocketOptions): UseWebSocketResult {
  const clientRef = useRef<WsClient | null>(null);

  useEffect(() => {
    let cancelled = false;
    const client = createWsClient();
    clientRef.current = client;

    authenticate()
      .then(() => {
        if (cancelled) return;
        const protocol = location.protocol === "https:" ? "wss" : "ws";
        const url = `${protocol}://${location.host}/ws?session=${sessionId}`;
        client.connect(url);
      })
      .catch(() => { /* ignore auth failure */ });

    return () => {
      cancelled = true;
      client.close();
    };
  }, [sessionId]);

  const send = useCallback((msg: unknown) => {
    clientRef.current?.send(msg);
  }, []);

  const onEvent = useCallback(
    (handler: (event: unknown) => void) => {
      return clientRef.current?.onEvent(handler) ?? (() => {});
    },
    [],
  );

  return { send, onEvent };
}
