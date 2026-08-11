import { useEffect, useState, useCallback } from "react";
import { SetupView } from "./components/setup/SetupView";
import { Sidebar } from "./components/sidebar/Sidebar";
import { SessionList } from "./components/sidebar/SessionList";
import type { SessionInfo } from "./lib/types";

type AppState = "loading" | "setup" | "chat";

function getSessionIdFromHash(): string | null {
  const match = location.hash.match(/^#\/chat\/(.+)/);
  return match ? match[1] : null;
}

function setHashSessionId(id: string) {
  location.hash = `#/chat/${id}`;
}

export default function App() {
  const [appState, setAppState] = useState<AppState>("loading");
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(
    getSessionIdFromHash,
  );

  // 检查 API Key 配置状态
  useEffect(() => {
    fetch("/api/setup/status")
      .then((res) => res.json())
      .then((data: { hasApiKey: boolean }) => {
        setAppState(data.hasApiKey ? "chat" : "setup");
      })
      .catch(() => setAppState("setup"));
  }, []);

  // 加载会话列表
  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions");
      const data: SessionInfo[] = await res.json();
      setSessions(data);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (appState === "chat") {
      loadSessions();
    }
  }, [appState, loadSessions]);

  // 监听 hash 变化
  useEffect(() => {
    const handler = () => setActiveSessionId(getSessionIdFromHash());
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);

  const handleNewSession = async () => {
    try {
      const res = await fetch("/api/sessions", { method: "POST" });
      const { id } = await res.json();
      await loadSessions();
      setHashSessionId(id);
    } catch {
      // ignore
    }
  };

  const handleDeleteSession = async (id: string) => {
    try {
      await fetch(`/api/sessions/${id}`, { method: "DELETE" });
      if (activeSessionId === id) {
        setActiveSessionId(null);
        location.hash = "";
      }
      await loadSessions();
    } catch {
      // ignore
    }
  };

  if (appState === "loading") {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        加载中...
      </div>
    );
  }

  if (appState === "setup") {
    return <SetupView />;
  }

  return (
    <div className="flex h-screen">
      <Sidebar>
        <SessionList
          sessions={sessions}
          activeSessionId={activeSessionId}
          onNewSession={handleNewSession}
          onSelectSession={setHashSessionId}
          onDeleteSession={handleDeleteSession}
        />
      </Sidebar>

      <main className="flex flex-1 flex-col">
        {activeSessionId ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            会话 {activeSessionId.slice(0, 8)} — ChatView 待实现 (Phase 6)
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            选择或创建一个会话开始
          </div>
        )}
      </main>
    </div>
  );
}
