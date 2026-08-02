/**
 * NATS connect / disconnect / muster / auto-retry / resume for Modules Lab.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  type DrinkxHost,
  type NatsConnectionInfo,
  type NatsMusterEntry,
} from "@service-monitor/core";
import { errText, pickHostFromMuster, resolveHwid } from "./modulesLabHost";
import { matchMusterHwid } from "./modulesLabNatsHelpers";
import type { ModulesLabToast } from "./ModulesLabContext";

type SessionSlice = {
  connected: boolean | null | undefined;
  natsUrl?: string | null;
};

export function useModulesLabNats(opts: {
  session: SessionSlice;
  host: DrinkxHost;
  setHost: Dispatch<SetStateAction<DrinkxHost>>;
  setHwid: Dispatch<SetStateAction<string>>;
  setModules: Dispatch<SetStateAction<NatsMusterEntry[]>>;
  hostRef: MutableRefObject<DrinkxHost>;
  setBusy: Dispatch<SetStateAction<string | null>>;
  setToast: Dispatch<SetStateAction<ModulesLabToast | null>>;
  valvePkgAbort: MutableRefObject<AbortController | null>;
  warmupAbort: MutableRefObject<AbortController | null>;
  heaterTimers: MutableRefObject<Map<string, ReturnType<typeof setTimeout>>>;
}) {
  const {
    session,
    host,
    setHost,
    setHwid,
    setModules,
    hostRef,
    setBusy,
    setToast,
    valvePkgAbort,
    warmupAbort,
    heaterTimers,
  } = opts;

  const [nats, setNats] = useState<NatsConnectionInfo>({
    connected: false,
    server: null,
    message: "NATS не подключён",
  });
  const autoNatsTried = useRef(false);

  const sessionOk = session.connected === true;
  /** Probe может мигать — к NATS пробуем при живой сессии + natsUrl. */
  const canTryNats = sessionOk && !!session.natsUrl;
  const live = nats.connected;

  useEffect(() => {
    void window.desktop.natsInfo().then(setNats).catch(() => undefined);
    return window.desktop.onNatsState(setNats);
  }, []);

  const applyMusterModules = useCallback(
    (
      modules: NatsMusterEntry[],
      mode: "connect" | "auto" | "muster"
    ): DrinkxHost => {
      setModules(modules);
      const nextHost = pickHostFromMuster(modules, hostRef.current);
      if (nextHost !== hostRef.current) {
        setHost(nextHost);
        setHwid(resolveHwid(nextHost, modules));
        if (mode === "connect") {
          setToast({
            text: `Модуль ${hostRef.current} offline → ${nextHost}`,
          });
        }
      } else if (mode === "auto") {
        setHwid(resolveHwid(nextHost, modules));
      } else {
        const matchHwid = matchMusterHwid(modules, nextHost);
        if (matchHwid) setHwid(matchHwid);
        else if (mode === "muster") setHwid(resolveHwid(nextHost, modules));
      }
      return nextHost;
    },
    [hostRef, setHost, setHwid, setModules, setToast]
  );

  async function connectNats() {
    if (!canTryNats) {
      setToast({
        text: "Нужна активная сессия (вкладка Сессия)",
        error: true,
      });
      return;
    }
    setBusy("nats");
    setToast(null);
    try {
      // Явно URL из сессии — даже если probe natsOnline=false.
      const info = await window.desktop.natsConnect(
        session.natsUrl ?? undefined
      );
      setNats(info);
      if (!info.connected) {
        setToast({ text: info.message, error: true });
        return;
      }
      try {
        await window.desktop.natsSubscribeStatus();
      } catch (e) {
        console.warn("[modules] subscribe", e);
      }
      try {
        const muster = await window.desktop.natsMuster(900);
        if (muster.ok) {
          applyMusterModules(muster.modules, "connect");
        }
      } catch (e) {
        console.warn("[modules] muster", e);
      }
      setToast((prev) => prev ?? { text: info.message });
    } catch (e) {
      setToast({ text: errText(e), error: true });
    } finally {
      setBusy(null);
    }
  }

  // Auto-connect NATS: несколько попыток (probe часто отстаёт от туннеля).
  useEffect(() => {
    if (!canTryNats || nats.connected) return;
    let cancelled = false;
    let attempts = 0;
    const tryConnect = async () => {
      while (!cancelled && attempts < 4 && !nats.connected) {
        attempts += 1;
        autoNatsTried.current = true;
        try {
          const info = await window.desktop.natsConnect(
            session.natsUrl ?? undefined
          );
          if (cancelled) return;
          setNats(info);
          if (info.connected) {
            try {
              await window.desktop.natsSubscribeStatus();
            } catch {
              // ignore
            }
            try {
              const muster = await window.desktop.natsMuster(900);
              if (muster.ok) {
                applyMusterModules(muster.modules, "auto");
              }
            } catch {
              // ignore
            }
            return;
          }
        } catch (e) {
          console.warn("[modules] auto-nats", attempts, e);
        }
        await new Promise((r) => setTimeout(r, 1200 * attempts));
      }
    };
    void tryConnect();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canTryNats, session.natsUrl]);

  useEffect(() => {
    if (!canTryNats) autoNatsTried.current = false;
  }, [canTryNats]);

  // После sleep/wake main шлёт app:resumed — переподключаем NATS.
  useEffect(() => {
    return window.desktop.onAppResumed((payload) => {
      autoNatsTried.current = false;
      if (payload.connected === false) {
        setNats({
          connected: false,
          server: null,
          message: "Сессия после сна не восстановлена",
        });
        return;
      }
      void (async () => {
        try {
          await window.desktop.natsDisconnect();
        } catch {
          // ignore
        }
        if (session.connected && session.natsUrl) {
          await connectNats();
        }
      })();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.connected, session.natsUrl]);

  async function disconnectNats() {
    setBusy("nats");
    try {
      valvePkgAbort.current?.abort();
      warmupAbort.current?.abort();
      for (const t of heaterTimers.current.values()) clearTimeout(t);
      heaterTimers.current.clear();
      const info = await window.desktop.natsDisconnect();
      setNats(info);
    } catch (e) {
      setToast({ text: errText(e), error: true });
    } finally {
      setBusy(null);
    }
  }

  async function resolveMuster() {
    setBusy("muster");
    try {
      const res = await window.desktop.natsMuster(900);
      if (!res.ok) {
        setToast({ text: res.error, error: true });
        return;
      }
      const nextHost = applyMusterModules(res.modules, "muster");
      setToast({
        text: res.modules.length
          ? `Модулей: ${res.modules.length}` +
            (nextHost !== host ? ` · активен ${nextHost}` : "")
          : "Muster пуст — используем dx." + host,
        error: res.modules.length === 0,
      });
    } catch (e) {
      setToast({ text: errText(e), error: true });
    } finally {
      setBusy(null);
    }
  }

  return {
    nats,
    setNats,
    live,
    sessionOk,
    canTryNats,
    connectNats,
    disconnectNats,
    resolveMuster,
  };
}
