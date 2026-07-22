/**
 * Контекст общей сессии (только Provider — для Fast Refresh).
 */

import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  emptyDevices,
  emptySession,
  shouldWarnSession,
  type ComplexSessionSnapshot,
  type SessionMode,
} from "@service-monitor/core";

export type SessionContextValue = {
  session: ComplexSessionSnapshot;
  warn: boolean;
  refresh: () => Promise<void>;
  connect: (input: {
    mode: SessionMode;
    seriesLabel?: string;
  }) => Promise<ComplexSessionSnapshot>;
  disconnect: () => Promise<void>;
  refreshNetwork: () => Promise<ComplexSessionSnapshot>;
};

export const SessionContext = createContext<SessionContextValue | null>(null);

function normalizeSnapshot(
  snap: ComplexSessionSnapshot | null | undefined
): ComplexSessionSnapshot {
  if (!snap || typeof snap !== "object") return emptySession();
  return {
    ...emptySession(),
    ...snap,
    devices: Array.isArray(snap.devices) ? snap.devices : emptyDevices(),
    natsOnline: snap.natsOnline === true,
    message: snap.message || emptySession().message,
  };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<ComplexSessionSnapshot>(emptySession());

  const refresh = useCallback(async () => {
    try {
      if (!window.desktop?.sessionGet) return;
      const snap = await window.desktop.sessionGet();
      setSession(normalizeSnapshot(snap));
    } catch (e) {
      console.error("[session] refresh failed", e);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 4000);
    const offState = window.desktop?.onSessionState?.((snap) => {
      setSession(normalizeSnapshot(snap));
    });
    const offResume = window.desktop?.onAppResumed?.(() => {
      void refresh();
    });
    return () => {
      clearInterval(id);
      offState?.();
      offResume?.();
    };
  }, [refresh]);

  const connect = useCallback(
    async (input: { mode: SessionMode; seriesLabel?: string }) => {
      const snap = await window.desktop.sessionConnect(input);
      const normalized = normalizeSnapshot(snap);
      setSession(normalized);
      return normalized;
    },
    []
  );

  const disconnect = useCallback(async () => {
    const snap = await window.desktop.sessionDisconnect();
    setSession(normalizeSnapshot(snap));
  }, []);

  const refreshNetwork = useCallback(async () => {
    const snap = await window.desktop.sessionRefreshNetwork();
    const normalized = normalizeSnapshot(snap);
    setSession(normalized);
    return normalized;
  }, []);

  const warn = shouldWarnSession(session);

  const value = useMemo(
    () => ({ session, warn, refresh, connect, disconnect, refreshNetwork }),
    [session, warn, refresh, connect, disconnect, refreshNetwork]
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}
