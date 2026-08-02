/**

 * Бортовой lab-logger на complexos: install / status / realtime / download.

 * Additive page — does not start dense LabTelemetry poll.

 */



import { useCallback, useEffect, useRef, useState } from "react";

import {

  LAB_LOGGER_POLL_INTERVAL_MS_DEFAULT,

  LAB_LOGGER_POLL_INTERVAL_MS_MAX,

  LAB_LOGGER_POLL_INTERVAL_MS_MIN,

  LAB_LOGGER_REMOTE_ROOT,

  LAB_LOGGER_USER_UNIT_REL,

  clampLabLoggerPollIntervalMs,

  collectOnboardSeriesKeys,

  convertOnboardRecordsToLabEvents,

  formatLabLoggerStatusLine,

  formatLabLoggerStatusParts,

  isLabLoggerRealtimeReady,

  isSeries4ForLabLogger,

  maxOnboardRecordTs,

  mergeOnboardLabEvents,

  nextOnboardEventsFromTs,

  onboardHeaterIds,

  onboardHeaterPwmOverlayKeys,

  onboardPumpOverlayHosts,

  onboardValveOverlayKeys,

  resolveLabLoggerSourceKind,

  trimLabEventsForChartSync,

  valvesMapFromOnboardEvents,

  type LabEvent,

  type LabLoggerHealth,

  type LabLoggerStatus,

} from "@service-monitor/core";

import { ActionButton } from "../components/ActionButton";

import { HelpTip } from "../components/HelpTip";

import {

  buildLabChartSyncPayload,

  openLabChartLogViewer,

} from "../components/ModulesLabCharts";

import { useComplexSession } from "../state/useComplexSession";



const LOG_MAX = 120;



type LogLevel = "info" | "ok" | "err";

type LogEntry = { id: number; ts: number; level: LogLevel; text: string };



function errText(e: unknown): string {

  return e instanceof Error ? e.message : String(e);

}



function fmtTime(ts: number): string {

  return new Date(ts).toLocaleTimeString("ru-RU", {

    hour: "2-digit",

    minute: "2-digit",

    second: "2-digit",

  });

}



export function LabLoggerPage() {

  const { session, warn } = useComplexSession();

  const live = session.connected === true;

  const seriesOk = isSeries4ForLabLogger(session.seriesLabel);

  const controlsDisabled = !live || !seriesOk;



  const [busy, setBusy] = useState<string | null>(null);

  const [status, setStatus] = useState<LabLoggerStatus | null>(null);

  const [health, setHealth] = useState<LabLoggerHealth | null>(null);

  const [retainHours, setRetainHours] = useState(24);

  const [autostart, setAutostart] = useState(true);

  const [wipeData, setWipeData] = useState(true);

  const [eventsPreview, setEventsPreview] = useState<string>("");

  const [snapshotPreview, setSnapshotPreview] = useState<string>("");

  const [log, setLog] = useState<LogEntry[]>([]);

  const [pollIntervalMs, setPollIntervalMs] = useState(

    LAB_LOGGER_POLL_INTERVAL_MS_DEFAULT

  );

  const [watching, setWatching] = useState(false);

  const [watchCount, setWatchCount] = useState(0);



  const logIdRef = useRef(0);

  const logElRef = useRef<HTMLPreElement | null>(null);

  const watchEventsRef = useRef<LabEvent[]>([]);

  const fromTsRef = useRef(0);

  const watchBusyRef = useRef(false);

  const watchingRef = useRef(false);



  const pushLog = useCallback((level: LogLevel, text: string) => {

    const id = ++logIdRef.current;

    setLog((prev) => {

      const next = [...prev, { id, ts: Date.now(), level, text }];

      return next.length > LOG_MAX ? next.slice(-LOG_MAX) : next;

    });

  }, []);



  useEffect(() => {

    const el = logElRef.current;

    if (!el) return;

    el.scrollTop = el.scrollHeight;

  }, [log]);



  useEffect(() => {

    if (status?.retainHours != null) setRetainHours(status.retainHours);

    if (status?.unitEnabled != null) setAutostart(status.unitEnabled);

  }, [status]);



  useEffect(() => {

    watchingRef.current = watching;

  }, [watching]);



  const refreshStatus = useCallback(async () => {

    if (!live) {

      pushLog("err", "Нужна активная сессия");

      return;

    }

    if (typeof window.desktop.labLoggerStatus !== "function") {

      pushLog("err", "IPC labLogger не доступен — перезапустите SM один раз");

      return;

    }

    setBusy("status");

    try {

      const res = await window.desktop.labLoggerStatus();

      if (!res.ok) {

        pushLog("err", res.error);

        setStatus(null);

        return;

      }

      setStatus(res.status);

      if (res.status.health) setHealth(res.status.health);

      pushLog("ok", formatLabLoggerStatusLine(res.status));

    } catch (e) {

      pushLog("err", errText(e));

    } finally {

      setBusy(null);

    }

  }, [live, pushLog]);



  const runInstall = useCallback(async () => {

    if (controlsDisabled) return;

    setBusy("install");

    try {

      const res = await window.desktop.labLoggerInstall({

        retainHours,

        enableAutostart: autostart,

      });

      if (!res.ok) {

        pushLog("err", res.error);

        return;

      }

      pushLog("ok", res.message);

      await refreshStatus();

    } catch (e) {

      pushLog("err", errText(e));

    } finally {

      setBusy(null);

    }

  }, [autostart, controlsDisabled, pushLog, refreshStatus, retainHours]);



  const runUninstall = useCallback(async () => {

    if (controlsDisabled) return;

    const confirmWipe = wipeData
      ? "Удалить lab-logger на complexos вместе со всеми следами (код, data/, lock, unit)?"
      : "Удалить lab-logger (unit + код)? Рекомендуется стереть data/.";
    if (typeof window.confirm === "function" && !window.confirm(confirmWipe)) {
      return;
    }

    setBusy("uninstall");

    try {

      if (watchingRef.current) {

        setWatching(false);

        pushLog("info", "Realtime остановлен (uninstall)");

      }

      const res = await window.desktop.labLoggerUninstall({ wipeData: wipeData !== false });

      if (!res.ok) {

        pushLog("err", res.error);

        return;

      }

      pushLog("ok", res.message);

      setHealth(null);

      setStatus(null);

      await refreshStatus();

    } catch (e) {

      pushLog("err", errText(e));

    } finally {

      setBusy(null);

    }

  }, [controlsDisabled, pushLog, refreshStatus, wipeData]);



  const runAutostart = useCallback(

    async (enabled: boolean) => {

      if (controlsDisabled) return;

      setBusy("autostart");

      try {

        const res = await window.desktop.labLoggerSetAutostart({ enabled });

        if (!res.ok) {

          pushLog("err", res.error);

          return;

        }

        setAutostart(enabled);

        pushLog("ok", res.message);

        await refreshStatus();

      } catch (e) {

        pushLog("err", errText(e));

      } finally {

        setBusy(null);

      }

    },

    [controlsDisabled, pushLog, refreshStatus]

  );



  const runRetention = useCallback(async () => {

    if (controlsDisabled) return;

    setBusy("retention");

    try {

      const res = await window.desktop.labLoggerSetRetention({ retainHours });

      if (!res.ok) {

        pushLog("err", res.error);

        return;

      }

      pushLog("ok", res.message);

      await refreshStatus();

    } catch (e) {

      pushLog("err", errText(e));

    } finally {

      setBusy(null);

    }

  }, [controlsDisabled, pushLog, refreshStatus, retainHours]);



  const syncChartFromEvents = useCallback(async (events: LabEvent[]) => {

    const sensors = collectOnboardSeriesKeys(events);

    const valveKeys = onboardValveOverlayKeys(events);

    const pumpHosts = onboardPumpOverlayHosts(events);

    const heaterPwmKeys = onboardHeaterPwmOverlayKeys(events);

    const heaterIds = onboardHeaterIds(events);

    const payload = buildLabChartSyncPayload(

      trimLabEventsForChartSync(events),

      sensors,

      {

        focus: sensors[0] ?? null,

        valvesMap: valvesMapFromOnboardEvents(events),

        heaterIds: heaterIds.length ? heaterIds : ["heater1", "heater2"],

        overlays: {

          valves: valveKeys,

          pumpOn: pumpHosts,

          heaterPwm: heaterPwmKeys,

        },

      }

    );

    if (typeof window.desktop.syncLabChartState === "function") {

      await window.desktop.syncLabChartState(payload);

    }

  }, []);



  const pollRealtimeOnce = useCallback(async () => {

    if (watchBusyRef.current) return;

    watchBusyRef.current = true;

    try {

      const res = await window.desktop.labLoggerFetchEvents({

        fromTs: fromTsRef.current,

      });

      if (!res.ok) {

        pushLog("err", `realtime: ${res.error}`);

        return;

      }

      const batchTs = maxOnboardRecordTs(res.events);

      if (batchTs != null) {

        fromTsRef.current = nextOnboardEventsFromTs(batchTs);

      }

      const converted = convertOnboardRecordsToLabEvents(res.events);

      if (converted.length === 0) return;

      const merged = mergeOnboardLabEvents(watchEventsRef.current, converted);

      watchEventsRef.current = merged;

      setWatchCount(merged.length);

      await syncChartFromEvents(merged);

    } catch (e) {

      pushLog("err", errText(e));

    } finally {

      watchBusyRef.current = false;

    }

  }, [pushLog, syncChartFromEvents]);



  const stopWatch = useCallback(() => {

    setWatching(false);

    pushLog("info", "Realtime остановлен");

  }, [pushLog]);



  const startWatch = useCallback(async () => {

    if (controlsDisabled) return;

    if (!isLabLoggerRealtimeReady(status)) {

      pushLog(

        "err",

        "Логгер не запущен — сначала Установить / Статус (unit active)"

      );

      return;

    }

    if (typeof window.desktop.labLoggerFetchEvents !== "function") {

      pushLog("err", "IPC labLogger не доступен — перезапустите SM");

      return;

    }

    setBusy("watch");

    try {

      fromTsRef.current = 0;

      watchEventsRef.current = [];

      setWatchCount(0);

      const open = await openLabChartLogViewer(null);

      if (!open.ok) {

        pushLog("err", open.error ?? "Не удалось открыть окно графика");

        return;

      }

      setWatching(true);

      pushLog(

        "ok",

        `Realtime: окно графика, poll ${clampLabLoggerPollIntervalMs(pollIntervalMs)}ms (SSH curl /lab/events)`

      );

      await pollRealtimeOnce();

    } catch (e) {

      pushLog("err", errText(e));

      setWatching(false);

    } finally {

      setBusy(null);

    }

  }, [

    controlsDisabled,

    pollIntervalMs,

    pollRealtimeOnce,

    pushLog,

    status,

  ]);



  useEffect(() => {

    if (!watching) return;

    const ms = clampLabLoggerPollIntervalMs(pollIntervalMs);

    const id = window.setInterval(() => {

      void pollRealtimeOnce();

    }, ms);

    return () => window.clearInterval(id);

  }, [watching, pollIntervalMs, pollRealtimeOnce]);



  // Закрытие окна графиков (крестик/Alt+F4) должно останавливать realtime —
  // иначе poll-цикл продолжает дёргать SSH curl /lab/events вхолостую, пока
  // пользователь не нажмёт «Стоп» вручную. Главный процесс уже шлёт
  // labChart:closed при закрытии окна (electron/main/index.ts), здесь только
  // подписка.
  useEffect(() => {
    if (typeof window.desktop.onLabChartClosed !== "function") return;
    const unsubscribe = window.desktop.onLabChartClosed(() => {
      stopWatch();
    });
    return () => unsubscribe?.();
  }, [stopWatch]);



  const runLoadPreview = useCallback(async () => {

    if (controlsDisabled) return;

    if (status?.installed !== true) {

      pushLog("err", "Логгер не установлен на этом комплексе");

      return;

    }

    setBusy("view");

    try {

      const [snapRes, evRes] = await Promise.all([

        window.desktop.labLoggerFetchSnapshot(),

        window.desktop.labLoggerFetchEvents({ fromTs: 0 }),

      ]);

      if (!snapRes.ok) {

        pushLog("err", `snapshot: ${snapRes.error}`);

      } else {

        setSnapshotPreview(JSON.stringify(snapRes.snapshot, null, 2));

        pushLog("ok", "snapshot загружен");

      }

      if (!evRes.ok) {

        pushLog("err", `events: ${evRes.error}`);

      } else {

        const n = evRes.events.length;

        const tail = evRes.events.slice(-40);

        setEventsPreview(JSON.stringify(tail, null, 2));

        pushLog("ok", `events: ${n} (показаны последние ${tail.length})`);

      }

      const h = await window.desktop.labLoggerFetchHealth();

      if (h.ok) setHealth(h.health);

    } catch (e) {

      pushLog("err", errText(e));

    } finally {

      setBusy(null);

    }

  }, [controlsDisabled, pushLog, status]);



  const runDownload = useCallback(async () => {

    if (controlsDisabled) return;

    if (status?.installed !== true) {

      pushLog("err", "Логгер не установлен на этом комплексе");

      return;

    }

    setBusy("download");

    try {

      const res = await window.desktop.labLoggerDownloadRing();

      if (!res.ok) {

        pushLog("err", res.error);

        return;

      }

      pushLog("ok", `Полный ring: ${res.bytes} байт → ${res.path}`);

    } catch (e) {

      pushLog("err", errText(e));

    } finally {

      setBusy(null);

    }

  }, [controlsDisabled, pushLog, status]);



  const pathLabel = status?.remotePath ?? LAB_LOGGER_REMOTE_ROOT;

  const realtimeReady = isLabLoggerRealtimeReady(status);

  const statusParts = status ? formatLabLoggerStatusParts(status) : [];



  return (

    <div className="stack">

      <div className={`panel${warn ? " panel-warn" : ""}`}>

        <h2 className="row" style={{ gap: 8, alignItems: "center" }}>

          Бортовой лог

          <HelpTip controlId="nav.labLogger" />

        </h2>

        <p className="lead">

          Установка Python lab-logger на <strong>complexos</strong> (серия 4.x).

          Только просмотр и выгрузка — без актуаторов. Не запускает плотный Lab

          dual-poll с ноутбука. На комплексе — delta+heartbeat (не полный

          snapshot каждый тик).

        </p>

        <p

          className="muted row"

          style={{ gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 0 }}

        >

          Путь на complexos: <code>{pathLabel}</code>

          <span>·</span>

          unit: <code>{LAB_LOGGER_USER_UNIT_REL}</code>

          <HelpTip controlId="labLogger.path" />

        </p>

        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>

          <span className={`badge${live ? " on" : ""}`}>

            {live ? "сессия ok" : "нет сессии"}

          </span>

          <span className={`badge${seriesOk ? " on" : " danger"}`}>

            {session.seriesLabel

              ? `серия ${session.seriesLabel}`

              : "серия не задана"}

            {seriesOk ? "" : " · нужен 4.x"}

          </span>

          {watching ? (

            <span className="badge on">realtime · {watchCount} evt</span>

          ) : null}

          {(() => {
            const src = resolveLabLoggerSourceKind(status);
            if (src === "fake") {
              return (
                <span className="badge danger" title="Демо FakeSource — не полевые клапаны">
                  источник: FAKE
                </span>
              );
            }
            if (src === "nats") {
              return <span className="badge on">источник: NATS</span>;
            }
            if (src === "idle") {
              return (
                <span className="badge" title="NATS недоступен или nats.py не установлен">
                  источник: idle
                </span>
              );
            }
            return null;
          })()}

        </div>

        {statusParts.length > 0 ? (

          <div className="lab-logger-status" aria-live="polite">

            {statusParts.map((p) => (

              <span key={p} className="lab-logger-status-part">

                {p}

              </span>

            ))}

          </div>

        ) : null}

      </div>



      <div className="panel">

        <h3 className="row" style={{ gap: 8, alignItems: "center" }}>

          Управление

          <HelpTip controlId="labLogger.install" />

        </h3>

        <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "center" }}>

          <label className="row" style={{ gap: 6, alignItems: "center" }}>

            Retention (ч)

            <HelpTip controlId="labLogger.retention" />

            <input

              type="number"

              min={1}

              max={168}

              value={retainHours}

              disabled={controlsDisabled || busy != null || watching}

              onChange={(e) => setRetainHours(Number(e.target.value) || 24)}

              style={{ width: 72 }}

            />

          </label>

          <label className="row" style={{ gap: 6, alignItems: "center" }}>

            <input

              type="checkbox"

              checked={autostart}

              disabled={controlsDisabled || busy != null || watching}

              onChange={(e) => setAutostart(e.target.checked)}

            />

            Autostart при install

            <HelpTip controlId="labLogger.autostart" />

          </label>

          <label className="row" style={{ gap: 6, alignItems: "center" }}>

            <input

              type="checkbox"

              checked={wipeData}

              disabled={controlsDisabled || busy != null || watching}

              onChange={(e) => setWipeData(e.target.checked)}

            />

            Uninstall: стереть всё (код + data + unit)

            <HelpTip controlId="labLogger.uninstall" />

          </label>

        </div>

        <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 10 }}>

          <ActionButton

            disabled={controlsDisabled || busy != null}

            onClick={() => void refreshStatus()}

          >

            {busy === "status" ? "…" : "Статус"}

          </ActionButton>

          <HelpTip controlId="labLogger.status" />

          <ActionButton

            disabled={controlsDisabled || busy != null || watching}

            onClick={() => void runInstall()}

          >

            {busy === "install" ? "…" : "Установить"}

          </ActionButton>

          <ActionButton

            disabled={controlsDisabled || busy != null || watching}

            onClick={() => void runRetention()}

          >

            {busy === "retention" ? "…" : "Записать retention"}

          </ActionButton>

          <ActionButton

            disabled={controlsDisabled || busy != null || watching}

            onClick={() => void runAutostart(true)}

          >

            Autostart on

          </ActionButton>

          <ActionButton

            disabled={controlsDisabled || busy != null || watching}

            onClick={() => void runAutostart(false)}

          >

            Autostart off

          </ActionButton>

          <ActionButton

            disabled={controlsDisabled || busy != null}

            onClick={() => void runUninstall()}

          >

            {busy === "uninstall" ? "…" : "Удалить"}

          </ActionButton>

        </div>

        {!live ? (

          <p className="muted">Сначала подключите сессию (вкладка Сессия).</p>

        ) : null}

        {live && !seriesOk ? (

          <p className="muted">

            Сейчас только серия 4.x. Path B / серия 3 — позже.

          </p>

        ) : null}

      </div>



      <div className="panel">

        <h3 className="row" style={{ gap: 8, alignItems: "center" }}>

          Realtime

          <HelpTip controlId="labLogger.realtime" />

        </h3>

        <p className="muted" style={{ marginTop: 0 }}>

          Тянет <code>/lab/events?from=</code> через SSH curl на complexos

          (localhost:8765). Сигналы = Modules: клапаны MODULE_VALVES, msValve,

          тэны/PWM, насосы, DX токи. Не включает Modules LabTelemetry. Интервал ≥{" "}

          {LAB_LOGGER_POLL_INTERVAL_MS_MIN} ms (SSH тяжелее in-process NATS).

        </p>

        <div

          className="row"

          style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}

        >

          <label className="row" style={{ gap: 6, alignItems: "center" }}>

            Poll (мс)

            <input

              type="number"

              min={LAB_LOGGER_POLL_INTERVAL_MS_MIN}

              max={LAB_LOGGER_POLL_INTERVAL_MS_MAX}

              step={100}

              value={pollIntervalMs}

              disabled={controlsDisabled || watching}

              onChange={(e) =>

                setPollIntervalMs(

                  clampLabLoggerPollIntervalMs(Number(e.target.value))

                )

              }

              style={{ width: 88 }}

            />

          </label>

          {!watching ? (

            <ActionButton

              disabled={

                controlsDisabled || busy != null || !realtimeReady

              }

              onClick={() => void startWatch()}

            >

              {busy === "watch" ? "…" : "Смотреть realtime"}

            </ActionButton>

          ) : (

            <ActionButton onClick={() => stopWatch()}>

              Стоп realtime

            </ActionButton>

          )}

        </div>

        {!realtimeReady && live && seriesOk ? (

          <p className="muted">

            Кнопка доступна, когда логгер установлен и unit/process active

            (нажмите Статус).

          </p>

        ) : null}

      </div>



      <div className="panel">

        <h3 className="row" style={{ gap: 8, alignItems: "center" }}>

          Полный лог

          <HelpTip controlId="labLogger.download" />

        </h3>

        <p className="muted" style={{ marginTop: 0 }}>

          Основное действие — скачать ring jsonl. Превью snapshot/events —

          для быстрой проверки HTTP.

        </p>

        <div

          className="row"

          style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}

        >

          <ActionButton

            variant="primary"

            disabled={controlsDisabled || busy != null || status?.installed !== true}

            onClick={() => void runDownload()}

            helpId="labLogger.download"

          >

            {busy === "download" ? "…" : "Скачать полный ring"}

          </ActionButton>

          <ActionButton

            disabled={controlsDisabled || busy != null || status?.installed !== true}

            onClick={() => void runLoadPreview()}

            helpId="labLogger.view"

          >

            {busy === "view" ? "…" : "Превью snapshot / events"}

          </ActionButton>

        </div>

        {live && seriesOk && status?.installed !== true ? (

          <p className="muted">

            Логгер не установлен на этом комплексе — сначала «Установить»

            выше (или нажмите «Статус», если уже устанавливали).

          </p>

        ) : null}

        {health ? (

          <p className="lab-logger-health muted">

            health: ok={String(health.ok)} · source={health.source} · age=

            {health.lastSampleAgeMs != null

              ? `${Math.round(health.lastSampleAgeMs)}ms`

              : "—"}{" "}

            · ticks={health.ticks} · disk={health.diskBytes}b · lock=

            {String(health.lockHeld)}

            {health.topologyWarnings.length

              ? ` · warnings: ${health.topologyWarnings.join("; ")}`

              : ""}

          </p>

        ) : null}

        {snapshotPreview ? (

          <details style={{ marginTop: 8 }}>

            <summary>Snapshot JSON</summary>

            <pre className="log" style={{ maxHeight: 220 }}>

              {snapshotPreview}

            </pre>

          </details>

        ) : null}

        {eventsPreview ? (

          <details style={{ marginTop: 8 }} open>

            <summary>Events (хвост)</summary>

            <pre className="log" style={{ maxHeight: 280 }}>

              {eventsPreview}

            </pre>

          </details>

        ) : null}

      </div>



      <div className="panel">

        <h3>Журнал</h3>

        <pre className="log" ref={logElRef} style={{ maxHeight: 200 }}>

          {log.length === 0

            ? "—"

            : log

                .map((e) => `${fmtTime(e.ts)} [${e.level}] ${e.text}`)

                .join("\n")}

        </pre>

      </div>

    </div>

  );

}


