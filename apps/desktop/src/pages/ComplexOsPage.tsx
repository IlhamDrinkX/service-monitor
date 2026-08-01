/**
 * ComplexOS — полевая диагностика и сервисные команды.
 * Опасные действия требуют sm.writeUnlocked (сервисный пароль).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CLEANING_TIMING_KEYS,
  CLEANING_TIMING_LABELS,
  COMPLEXOS_SUBJECTS,
  NATS_SUBJECTS,
  type CleaningTimingKey,
  type NatsConnectionInfo,
} from "@service-monitor/core";
import { ActionButton } from "../components/ActionButton";
import { HelpTip } from "../components/HelpTip";
import { onEnterNavigate } from "../lib/form-nav";
import { safeDesktopCall, smLog } from "../lib/sm-log";
import { useComplexSession } from "../state/useComplexSession";

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isWriteUnlocked(): boolean {
  return (
    typeof sessionStorage !== "undefined" &&
    sessionStorage.getItem("sm.writeUnlocked") === "1"
  );
}

function pretty(data: unknown): string {
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

function shortId(id: unknown): string {
  const s = String(id ?? "");
  if (s.length <= 10) return s || "—";
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

type OrderRow = {
  orderId?: string;
  number?: number | string;
  status?: string;
  menuItemName?: string;
};

function asOrderRows(list: unknown[] | undefined): OrderRow[] {
  if (!Array.isArray(list)) return [];
  return list.map((item) => {
    if (!item || typeof item !== "object") return {};
    const o = item as Record<string, unknown>;
    return {
      orderId: typeof o.orderId === "string" ? o.orderId : undefined,
      number: (o.number as number | string | undefined) ?? undefined,
      status: typeof o.status === "string" ? o.status : undefined,
      menuItemName:
        typeof o.menuItemName === "string" ? o.menuItemName : undefined,
    };
  });
}

export function ComplexOsPage() {
  const { session, warn } = useComplexSession();
  const sessionOk = session.connected === true;
  const canTryNats = sessionOk && !!session.natsUrl;
  const [nats, setNats] = useState<NatsConnectionInfo>({
    connected: false,
    server: null,
    message: "NATS не подключён",
  });
  const live = nats.connected;
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(
    null
  );
  const [unlocked, setUnlocked] = useState(isWriteUnlocked);
  const [osStatus, setOsStatus] = useState<Record<string, unknown> | null>(
    null
  );
  const [dump, setDump] = useState<unknown>(null);
  const [cleaningCfg, setCleaningCfg] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [timingDraft, setTimingDraft] = useState<
    Partial<Record<CleaningTimingKey, number>>
  >({});
  const [cmId, setCmId] = useState("");
  const [troubles, setTroubles] = useState<unknown>(null);
  const [showDump, setShowDump] = useState(false);
  const [orders, setOrders] = useState<{
    waitingOrders?: unknown[];
    progressOrders?: unknown[];
    readyOrders?: unknown[];
    takedOrders?: unknown[];
  } | null>(null);
  const [busLive, setBusLive] = useState(false);
  const autoTried = useRef(false);
  const refreshStatusRef = useRef<() => Promise<void>>(async () => undefined);

  useEffect(() => {
    void window.desktop.natsInfo().then(setNats).catch(() => undefined);
    return window.desktop.onNatsState(setNats);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setUnlocked(isWriteUnlocked()), 1500);
    return () => clearInterval(id);
  }, []);

  const req = useCallback(
    async (
      subject: string,
      payload: Record<string, unknown> = {},
      timeoutMs = 4_000
    ) => {
      try {
        return await window.desktop.natsRequest({
          subject,
          payload,
          timeoutMs,
          priority: "command",
        });
      } catch (e) {
        return { ok: false as const, error: errText(e) };
      }
    },
    []
  );

  async function ensureNats() {
    if (nats.connected) return true;
    if (!canTryNats) {
      setToast({ text: "Нужна активная сессия с NATS", error: true });
      return false;
    }
    const info = await window.desktop.natsConnect(session.natsUrl ?? undefined);
    setNats(info);
    if (!info.connected) {
      setToast({ text: info.message, error: true });
      return false;
    }
    return true;
  }

  useEffect(() => {
    if (!canTryNats || nats.connected || autoTried.current) return;
    autoTried.current = true;
    void (async () => {
      const info = await window.desktop.natsConnect(
        session.natsUrl ?? undefined
      );
      setNats(info);
    })();
  }, [canTryNats, nats.connected, session.natsUrl]);

  function requireUnlock(): boolean {
    if (isWriteUnlocked()) return true;
    setToast({
      text: "Разблокируйте правки в Настройках (сервисный пароль)",
      error: true,
    });
    return false;
  }

  async function refreshStatus(opts?: { silent?: boolean }) {
    if (!(await ensureNats())) return;
    if (!opts?.silent) {
      setBusy("status");
      setToast(null);
    }
    try {
      const res = await req(COMPLEXOS_SUBJECTS.status, {}, 5_000);
      if (!res.ok) {
        if (!opts?.silent) setToast({ text: res.error, error: true });
        return;
      }
      const body =
        res.data && typeof res.data === "object"
          ? ((res.data as Record<string, unknown>).result as
              | Record<string, unknown>
              | undefined) ?? (res.data as Record<string, unknown>)
          : null;
      setOsStatus(body);
      if (!opts?.silent) setToast({ text: "status ok" });
    } finally {
      if (!opts?.silent) setBusy(null);
    }
  }
  refreshStatusRef.current = () => refreshStatus({ silent: true });

  async function refreshOrders(opts?: { silent?: boolean }) {
    if (!(await ensureNats())) return;
    if (!opts?.silent) setBusy("orders");
    try {
      const res = await req(COMPLEXOS_SUBJECTS.orders, {}, 8_000);
      if (!res.ok) {
        if (!opts?.silent) setToast({ text: res.error, error: true });
        return;
      }
      const body =
        res.data && typeof res.data === "object"
          ? ((res.data as Record<string, unknown>).result as Record<
              string,
              unknown
            >) ?? (res.data as Record<string, unknown>)
          : null;
      setOrders(
        (body as {
          waitingOrders?: unknown[];
          progressOrders?: unknown[];
          readyOrders?: unknown[];
          takedOrders?: unknown[];
        }) ?? null
      );
      if (!opts?.silent) setToast({ text: "orders ok" });
    } finally {
      if (!opts?.silent) setBusy(null);
    }
  }

  useEffect(() => {
    if (!live) {
      setBusLive(false);
      void safeDesktopCall(
        "natsUnsubscribeBus",
        () =>
          window.desktop.natsUnsubscribeBus?.("complexos") ??
          Promise.resolve({ ok: true as const }),
        { ok: true as const }
      );
      return;
    }
    let cancelled = false;
    smLog("info", "complexos", "subscribe alert bus");
    void (async () => {
      const sub = await safeDesktopCall(
        "natsSubscribeBus",
        () =>
          window.desktop.natsSubscribeBus?.(
            [
              COMPLEXOS_SUBJECTS.alertCreated,
              COMPLEXOS_SUBJECTS.alertCleared,
              COMPLEXOS_SUBJECTS.helpNeeded,
            ],
            "complexos"
          ) ??
          Promise.resolve({
            ok: false as const,
            error: "natsSubscribeBus missing",
          }),
        { ok: false as const, error: "natsSubscribeBus missing" }
      );
      if (cancelled) return;
      if (sub.ok) {
        setBusLive(true);
        smLog("info", "complexos", "alert bus ON", {
          subjects: "subjects" in sub ? sub.subjects : undefined,
        });
      } else {
        setBusLive(false);
        smLog("warn", "complexos", "alert bus failed", sub);
      }
    })();
    const off =
      typeof window.desktop.onNatsBus === "function"
        ? window.desktop.onNatsBus((msg) => {
            const short = msg.subject.split(".").pop() ?? msg.subject;
            smLog("info", "complexos", `bus ${short}`);
            setToast({ text: `bus · ${short}` });
            void refreshStatusRef.current();
          })
        : () => undefined;
    return () => {
      cancelled = true;
      off();
      void safeDesktopCall(
        "natsUnsubscribeBus",
        () =>
          window.desktop.natsUnsubscribeBus?.("complexos") ??
          Promise.resolve({ ok: true as const }),
        { ok: true as const }
      );
      setBusLive(false);
    };
  }, [live]);

  useEffect(() => {
    if (!live) return;
    smLog("info", "complexos", "orders auto-poll start");
    const id = window.setInterval(() => {
      void refreshOrders({ silent: true });
    }, 7_000);
    return () => {
      clearInterval(id);
      smLog("info", "complexos", "orders auto-poll stop");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- poll while live
  }, [live]);

  async function refreshDump() {
    if (!(await ensureNats())) return;
    setBusy("dump");
    try {
      const res = await req(COMPLEXOS_SUBJECTS.dumpDevices, {}, 8_000);
      if (!res.ok) {
        setToast({ text: res.error, error: true });
        return;
      }
      const body =
        res.data && typeof res.data === "object"
          ? ((res.data as Record<string, unknown>).result ?? res.data)
          : res.data;
      setDump(body);
      // Попытка вытащить coffeeMachineId
      try {
        const devices = (body as { devices?: { devices?: Array<{ id?: string }> } })
          ?.devices?.devices;
        if (Array.isArray(devices) && devices[0]?.id && !cmId) {
          setCmId(String(devices[0].id));
        }
      } catch {
        // ignore
      }
      setShowDump(true);
      setToast({ text: "dump-devices ok" });
    } finally {
      setBusy(null);
    }
  }

  async function refreshCleaningConfig() {
    if (!(await ensureNats())) return;
    setBusy("clean-cfg");
    try {
      const res = await req(COMPLEXOS_SUBJECTS.cleaningConfig, {}, 5_000);
      if (!res.ok) {
        setToast({ text: res.error, error: true });
        return;
      }
      const body =
        (res.data &&
          typeof res.data === "object" &&
          ((res.data as Record<string, unknown>).result as
            | Record<string, unknown>
            | undefined)) ||
        (res.data as Record<string, unknown>);
      setCleaningCfg(body);
      const draft: Partial<Record<CleaningTimingKey, number>> = {};
      for (const k of CLEANING_TIMING_KEYS) {
        const v = Number(body?.[k]);
        if (Number.isFinite(v)) draft[k] = v;
      }
      setTimingDraft(draft);
      setToast({ text: "cleaning-config ok" });
    } finally {
      setBusy(null);
    }
  }

  async function saveCleaningTimings() {
    if (!requireUnlock()) return;
    if (!(await ensureNats())) return;
    if (
      !window.confirm(
        "Записать timings мойки через coffeemachine.update-config?\n" +
          "Изменения runtime — после рестарта cm-drv могут откатиться к osconfig."
      )
    ) {
      return;
    }
    setBusy("clean-save");
    try {
      const patch: Record<string, number> = {};
      for (const k of CLEANING_TIMING_KEYS) {
        const v = timingDraft[k];
        if (typeof v === "number" && Number.isFinite(v)) patch[k] = v;
      }
      const res = await window.desktop.natsUpdateConfig(patch);
      if (!res.ok) {
        setToast({ text: res.error, error: true });
        return;
      }
      setToast({ text: "timings записаны (update-config)" });
      await refreshCleaningConfig();
    } finally {
      setBusy(null);
    }
  }

  async function setPause(pause: boolean) {
    if (!(await ensureNats())) return;
    if (!window.confirm(pause ? "Поставить очередь на pause?" : "Снять pause?"))
      return;
    setBusy("pause");
    try {
      const res = await req(COMPLEXOS_SUBJECTS.pause, { pause }, 5_000);
      if (!res.ok) {
        setToast({ text: res.error, error: true });
        return;
      }
      setToast({ text: pause ? "paused" : "resumed" });
      await refreshStatus();
    } finally {
      setBusy(null);
    }
  }

  async function doTransition(transition: string) {
    if (!(await ensureNats())) return;
    if (!window.confirm(`Переход режима: ${transition}?`)) return;
    setBusy("transition");
    try {
      const res = await req(
        COMPLEXOS_SUBJECTS.transition,
        { transition },
        30_000
      );
      if (!res.ok) {
        setToast({ text: res.error, error: true });
        return;
      }
      setToast({ text: `transition → ${transition}` });
      await refreshStatus();
    } finally {
      setBusy(null);
    }
  }

  async function startBigWash() {
    if (!requireUnlock()) return;
    if (!(await ensureNats())) return;
    const id = cmId.trim();
    if (!id) {
      setToast({ text: "Укажите coffeeMachineId (из dump)", error: true });
      return;
    }
    if (
      !window.confirm(
        `Big Wash (start-cleaning) для ${id}?\nНужны реагенты и пустые стаканы.`
      )
    ) {
      return;
    }
    setBusy("wash");
    try {
      const viaOs = await req(
        COMPLEXOS_SUBJECTS.cmAction,
        { action: "start-cleaning", coffeeMachineId: id, name: "Big Wash" },
        15_000
      );
      if (viaOs.ok) {
        setToast({ text: "start-cleaning через ComplexOS" });
        return;
      }
      const direct = await req(
        NATS_SUBJECTS.startCleaning,
        { hwid: id, name: "Big Wash" },
        15_000
      );
      if (!direct.ok) {
        setToast({
          text: `OS: ${viaOs.error}; direct: ${direct.error}`,
          error: true,
        });
        return;
      }
      setToast({ text: "startcleaning напрямую" });
    } finally {
      setBusy(null);
    }
  }

  async function stopCm() {
    if (!requireUnlock()) return;
    if (!(await ensureNats())) return;
    const id = cmId.trim() || "dx";
    if (!window.confirm(`Stop CM (${id})? Оборвёт brew/мойку.`)) return;
    setBusy("stop-cm");
    try {
      const viaOs = await req(
        COMPLEXOS_SUBJECTS.cmAction,
        { action: "stop", coffeeMachineId: id },
        10_000
      );
      if (viaOs.ok) {
        setToast({ text: "stop через ComplexOS" });
        return;
      }
      const direct = await req("coffeemachine.stop", { hwid: id }, 8_000);
      if (!direct.ok) {
        setToast({
          text: `OS: ${viaOs.error}; direct: ${direct.error}`,
          error: true,
        });
        return;
      }
      setToast({ text: "coffeemachine.stop ok" });
    } finally {
      setBusy(null);
    }
  }

  async function graceRestart() {
    if (!requireUnlock()) return;
    if (!(await ensureNats())) return;
    if (
      !window.confirm(
        "Grace restart ComplexOS? Дождётся очереди и перезапустит процессы."
      )
    ) {
      return;
    }
    setBusy("restart");
    try {
      const res = await req(COMPLEXOS_SUBJECTS.graceRestart, {}, 10_000);
      if (!res.ok) {
        setToast({ text: res.error, error: true });
        return;
      }
      setToast({ text: "grace-restart отправлен" });
    } finally {
      setBusy(null);
    }
  }

  async function forceRestart() {
    if (!requireUnlock()) return;
    if (!(await ensureNats())) return;
    if (
      !window.confirm(
        "FORCE restart ComplexOS? Немедленный exit процессов. Продолжить?"
      )
    ) {
      return;
    }
    setBusy("force-restart");
    try {
      const pub = await window.desktop.natsPublish({
        subject: COMPLEXOS_SUBJECTS.restart,
        payload: {},
      });
      if (!pub.ok) {
        setToast({ text: pub.error, error: true });
        return;
      }
      setToast({ text: "core.restart published" });
    } finally {
      setBusy(null);
    }
  }

  async function dismissAlert(key: string) {
    if (!(await ensureNats())) return;
    setBusy("alert");
    try {
      const res = await req(
        COMPLEXOS_SUBJECTS.alertReact,
        { key, action: "dismiss" },
        5_000
      );
      if (!res.ok) {
        setToast({ text: res.error, error: true });
        return;
      }
      setToast({ text: `alert ${key} dismissed` });
      await refreshStatus();
    } finally {
      setBusy(null);
    }
  }

  async function loadTroubles() {
    if (!(await ensureNats())) return;
    setBusy("troubles");
    try {
      const res = await req(COMPLEXOS_SUBJECTS.troubles, {}, 5_000);
      if (!res.ok) {
        setToast({ text: res.error, error: true });
        return;
      }
      setTroubles(
        (res.data as Record<string, unknown>)?.result ?? res.data
      );
      setToast({ text: "troubles ok" });
    } finally {
      setBusy(null);
    }
  }

  const transitions = useMemo(() => {
    const t = osStatus?.transitions;
    return Array.isArray(t) ? (t as string[]) : [];
  }, [osStatus]);

  const alerts = useMemo(() => {
    const a = osStatus?.alerts;
    if (!a) return [] as Array<{ key?: string; title?: string }>;
    if (Array.isArray(a)) return a as Array<{ key?: string; title?: string }>;
    if (typeof a === "object") {
      return Object.entries(a as Record<string, unknown>).map(([key, v]) => ({
        key,
        title: typeof v === "string" ? v : pretty(v),
      }));
    }
    return [];
  }, [osStatus]);

  const controlsDisabled = busy !== null || !live;

  return (
    <div className="stack">
      <div className={`panel${warn ? " panel-warn" : ""}`}>
        <h2>ComplexOS</h2>
        <p className="lead">
          Диагностика ОС комплекса по NATS. Опасные команды (мойка, restart,
          запись timings) — после сервисного пароля в Настройках.
        </p>
        <div className="row">
          <span className={`badge${sessionOk ? " on" : " danger"}`}>
            {sessionOk ? `сессия ${session.mode}` : session.message}
          </span>
          <span className={`badge${live ? " on" : ""}`}>
            {live ? nats.message : "NATS offline"}
          </span>
          <span className={`badge${unlocked ? " on" : ""}`}>
            {unlocked ? "правки разрешены" : "только чтение / безопасные"}
          </span>
          <ActionButton
            helpId="cos.nats"
            disabled={busy !== null || !canTryNats}
            onClick={() => void ensureNats()}
          >
            NATS
          </ActionButton>
          <ActionButton
            helpId="cos.status"
            variant="primary"
            disabled={controlsDisabled}
            onClick={() => void refreshStatus()}
          >
            Status
          </ActionButton>
          <ActionButton
            helpId="cos.dump"
            disabled={controlsDisabled}
            onClick={() => void refreshDump()}
          >
            Dump devices
          </ActionButton>
          <ActionButton
            helpId="cos.cleaningConfig"
            disabled={controlsDisabled}
            onClick={() => void refreshCleaningConfig()}
          >
            Cleaning config
          </ActionButton>
          <ActionButton
            helpId="cos.troubles"
            disabled={controlsDisabled}
            onClick={() => void loadTroubles()}
          >
            Troubles
          </ActionButton>
          <ActionButton
            helpId="cos.orders"
            disabled={controlsDisabled}
            onClick={() => void refreshOrders()}
          >
            Orders
          </ActionButton>
          <span className={`badge${busLive ? " on" : ""}`}>
            <HelpTip controlId="cos.alertBus" />
            {busLive ? "alert bus ON" : "alert bus off"}
          </span>
        </div>
        {toast ? (
          <div className={`toast${toast.error ? " error" : ""}`}>
            {toast.text}
          </div>
        ) : null}
      </div>

      <div className="grid-2">
        <div className="panel panel-compact">
          <h2>Статус ОС</h2>
          {osStatus ? (
            <dl className="cos-kv">
              <div>
                <dt>mode</dt>
                <dd>
                  <code>{String(osStatus.mode ?? "—")}</code>
                  {osStatus.isPaused ? " · paused" : ""}
                </dd>
              </div>
              <div>
                <dt>version</dt>
                <dd>{String(osStatus.version ?? "—")}</dd>
              </div>
              <div>
                <dt>name</dt>
                <dd>{String(osStatus.name ?? "—")}</dd>
              </div>
              <div>
                <dt>comment</dt>
                <dd className="muted">{String(osStatus.comment ?? "—")}</dd>
              </div>
            </dl>
          ) : (
            <p className="muted">Нажмите Status</p>
          )}
          <div className="row" style={{ marginTop: 12 }}>
            <ActionButton
              helpId="cos.pause"
              disabled={controlsDisabled}
              onClick={() => void setPause(true)}
            >
              Pause
            </ActionButton>
            <ActionButton
              helpId="cos.resume"
              disabled={controlsDisabled}
              onClick={() => void setPause(false)}
            >
              Resume
            </ActionButton>
            {transitions.map((t) => (
              <ActionButton
                key={t}
                helpId="cos.transition"
                disabled={controlsDisabled}
                onClick={() => void doTransition(t)}
              >
                → {t}
              </ActionButton>
            ))}
          </div>
        </div>

        <div className="panel panel-compact">
          <h2>Alerts</h2>
          {alerts.length === 0 ? (
            <p className="muted">Нет alerts в status</p>
          ) : (
            <ul className="cos-alert-list">
              {alerts.map((a, i) => (
                <li key={a.key ?? i}>
                  <code>{a.key ?? "?"}</code>
                  <span className="muted">{a.title ?? ""}</span>
                  {a.key ? (
                    <ActionButton
                      helpId="cos.dismissAlert"
                      className="btn-compact"
                      disabled={controlsDisabled}
                      onClick={() => void dismissAlert(a.key!)}
                    >
                      dismiss
                    </ActionButton>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="panel panel-compact">
        <h2 className="row" style={{ gap: 8, alignItems: "center" }}>
          Orders
          <HelpTip controlId="cos.orders" />
        </h2>
        <p className="muted" style={{ marginTop: 0 }}>
          <code>complexos.dashboard.orders</code> · автообновление ~7с
        </p>
        {orders ? (
          <div className="cos-orders-grid">
            {(
              [
                ["waiting", orders.waitingOrders],
                ["progress", orders.progressOrders],
                ["ready", orders.readyOrders],
                ["taked", orders.takedOrders],
              ] as const
            ).map(([title, list]) => {
              const rows = asOrderRows(list);
              return (
                <div key={title} className="cos-orders-col">
                  <h3>
                    {title}{" "}
                    <span className="muted">({rows.length})</span>
                  </h3>
                  {rows.length === 0 ? (
                    <p className="muted">—</p>
                  ) : (
                    <ul className="cos-orders-list">
                      {rows.slice(0, title === "taked" ? 8 : 20).map((r, i) => (
                        <li key={r.orderId ?? `${title}-${i}`}>
                          <strong>#{r.number ?? "?"}</strong>{" "}
                          {r.menuItemName ?? "—"}
                          <span className="muted">
                            {" "}
                            · {r.status ?? "?"} · {shortId(r.orderId)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="muted">Нажмите Orders</p>
        )}
      </div>

      <div className="panel panel-compact">
        <h2>Мойка · Big Wash</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Facade умеет <code>startcleaning</code>. Требует сервисный пароль.
        </p>
        <div className="row" style={{ flexWrap: "wrap", gap: 10 }}>
          <label className="muted lab-param">
            coffeeMachineId
            <HelpTip controlId="cos.cmId" />
            <input
              value={cmId}
              disabled={!live}
              onChange={(e) => setCmId(e.target.value)}
              placeholder="dx / hwid из dump"
              style={{ width: 200, minWidth: 160 }}
              onKeyDown={(e) =>
                onEnterNavigate(e, {
                  onAction: () => {
                    if (unlocked && !controlsDisabled) void startBigWash();
                  },
                })
              }
            />
          </label>
          <ActionButton
            helpId="cos.bigWash"
            variant="primary"
            disabled={controlsDisabled || !unlocked}
            onClick={() => void startBigWash()}
          >
            Start Big Wash
          </ActionButton>
          <ActionButton
            helpId="cos.stopCm"
            disabled={controlsDisabled || !unlocked}
            onClick={() => void stopCm()}
          >
            Stop CM
          </ActionButton>
        </div>
      </div>

      <div className="panel panel-compact">
        <h2>Cleaning timings (runtime)</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Чтение: <code>complexos.dashboard.cleaning-config</code>. Запись:{" "}
          <code>coffeemachine.update-config</code> (не в osconfig ERP).
        </p>
        {cleaningCfg ? (
          <div className="cos-timing-grid">
            {CLEANING_TIMING_KEYS.map((k, idx) => (
              <label key={k} className="muted">
                <span className="row" style={{ gap: 6, alignItems: "center" }}>
                  {CLEANING_TIMING_LABELS[k]}
                  <HelpTip controlId={`cos.timing.${k}`} />
                </span>
                <input
                  type="number"
                  value={timingDraft[k] ?? ""}
                  disabled={!live || !unlocked}
                  data-cos-timing={k}
                  onChange={(e) =>
                    setTimingDraft((prev) => ({
                      ...prev,
                      [k]: Number(e.target.value) || 0,
                    }))
                  }
                  onKeyDown={(e) => {
                    const nextKey = CLEANING_TIMING_KEYS[idx + 1];
                    if (nextKey) {
                      onEnterNavigate(e, {
                        next: document.querySelector(
                          `input[data-cos-timing="${nextKey}"]`
                        ) as HTMLInputElement | null,
                      });
                    } else {
                      onEnterNavigate(e, {
                        onAction: () => {
                          if (unlocked && cleaningCfg) void saveCleaningTimings();
                        },
                      });
                    }
                  }}
                />
              </label>
            ))}
          </div>
        ) : (
          <p className="muted">Загрузите Cleaning config</p>
        )}
        <div className="row" style={{ marginTop: 10 }}>
          <ActionButton
            helpId="cos.saveTimings"
            disabled={controlsDisabled || !unlocked || !cleaningCfg}
            onClick={() => void saveCleaningTimings()}
          >
            Записать timings
          </ActionButton>
        </div>
      </div>

      <div className="panel panel-compact">
        <h2>Опасная зона</h2>
        <div className="row">
          <ActionButton
            helpId="cos.graceRestart"
            disabled={controlsDisabled || !unlocked}
            onClick={() => void graceRestart()}
          >
            Grace restart OS
          </ActionButton>
          <ActionButton
            helpId="cos.forceRestart"
            disabled={controlsDisabled || !unlocked}
            onClick={() => void forceRestart()}
          >
            Force restart OS
          </ActionButton>
        </div>
      </div>

      {troubles != null ? (
        <div className="panel">
          <h2>Troubles</h2>
          <pre className="code-block" style={{ maxHeight: 280 }}>
            {pretty(troubles)}
          </pre>
        </div>
      ) : null}

      {dump != null ? (
        <div className="panel">
          <h2>
            <button
              type="button"
              className="linkish"
              onClick={() => setShowDump((v) => !v)}
              style={{
                background: "none",
                border: "none",
                color: "inherit",
                cursor: "pointer",
                padding: 0,
                font: "inherit",
              }}
            >
              dump-devices {showDump ? "▾" : "▸"}
            </button>
          </h2>
          {showDump ? (
            <pre className="code-block" style={{ maxHeight: 420 }}>
              {pretty(dump)}
            </pre>
          ) : null}
        </div>
      ) : null}

      {osStatus ? (
        <div className="panel">
          <h2>Raw status</h2>
          <pre className="code-block" style={{ maxHeight: 320 }}>
            {pretty(osStatus)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
