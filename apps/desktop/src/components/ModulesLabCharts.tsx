/**
 * Мини-графики Modules Lab + открытие отдельного окна «График комплекса».
 * Fallback: модалка, если IPC labChart ещё не в preload (нужен рестарт Electron).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  chartSeriesMeta,
  isFiniteSeriesValue,
  layoutModuleChartKeys,
  mergeLabChartSyncEvents,
  moduleChartColumns,
  parseSeriesKey,
  pumpPowerSeries,
  sensorSeries,
  seriesHasDrawablePoints,
  seriesKey,
  seriesPathD,
  seriesYDomain,
  trimLabEventsForChartSync,
  type DrinkxHost,
  type LabEvent,
} from "@service-monitor/core";
import {
  EMPTY_LAB_CHART_PAYLOAD,
  LabChartPanel,
  type LabChartSyncPayload,
} from "./LabChartPanel";

export { EMPTY_LAB_CHART_PAYLOAD };

/**
 * Открыть окно графика для просмотра/импорта лога без живой сессии.
 * Если передан livePayload — синхронизируем его (кнопка «Лог графика» на Modules).
 * Иначе: пустой payload для «Импорт лога»; если в main уже есть последний sync — подтянется.
 */
export async function openLabChartLogViewer(
  livePayload?: LabChartSyncPayload | null
): Promise<{
  ok: boolean;
  error?: string;
}> {
  if (typeof window.desktop.openLabChartWindow !== "function") {
    return {
      ok: false,
      error:
        "IPC labChart недоступен — нужен рестарт приложения.",
    };
  }
  try {
    const focus =
      livePayload?.initialSensor ??
      livePayload?.allSensors[0] ??
      null;
    // Open first so the window appears even if a large IPC sync is slow.
    const res = await window.desktop.openLabChartWindow(
      focus ? { focusSensor: focus } : {}
    );
    if (res && "ok" in res && res.ok === false) {
      return { ok: false, error: res.error || "Не удалось открыть окно" };
    }
    if (livePayload && livePayload.events.length > 0) {
      await window.desktop.syncLabChartState?.(livePayload);
    } else {
      const current = await window.desktop.pullLabChartState?.();
      if (!current || typeof current !== "object") {
        await window.desktop.syncLabChartState?.(EMPTY_LAB_CHART_PAYLOAD);
      }
    }
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

type Props = {
  events: LabEvent[];
  sensorNames: string[];
  availableSensors?: string[];
  valveIdsByModule?: Record<DrinkxHost, string[]>;
  /** @deprecated use valveIdsByModule */
  valveIds?: string[];
  heaterIds?: string[];
  groupByModule?: boolean;
  liveActuators?: LabChartSyncPayload["liveActuators"];
};

function buildSyncPayload(
  events: LabEvent[],
  allSensors: string[],
  focus: string | null,
  valvesMap: Record<DrinkxHost, string[]>,
  heaterIds: string[],
  liveActuators?: LabChartSyncPayload["liveActuators"],
  overlays?: LabChartSyncPayload["overlays"]
): LabChartSyncPayload {
  return {
    events: trimLabEventsForChartSync(events),
    allSensors,
    initialSensor: focus,
    valvesMap,
    heaterIds,
    liveActuators,
    overlays,
  };
}

/** Собрать payload для IPC окна графика (Modules toolbar / charts). */
export function buildLabChartSyncPayload(
  events: LabEvent[],
  allSensors: string[],
  opts?: {
    focus?: string | null;
    valvesMap?: Record<DrinkxHost, string[]>;
    heaterIds?: string[];
    liveActuators?: LabChartSyncPayload["liveActuators"];
    overlays?: LabChartSyncPayload["overlays"];
  }
): LabChartSyncPayload {
  return buildSyncPayload(
    events,
    allSensors,
    opts?.focus ?? allSensors[0] ?? null,
    opts?.valvesMap ?? { milk: [], coffee: [], water: [] },
    opts?.heaterIds ?? [],
    opts?.liveActuators,
    opts?.overlays
  );
}

export function ModulesLabCharts({
  events,
  sensorNames,
  availableSensors,
  valveIdsByModule,
  valveIds = [],
  heaterIds = [],
  groupByModule = false,
  liveActuators,
}: Props) {
  const [chartOpen, setChartOpen] = useState(false);
  const [modalFallback, setModalFallback] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  const valvesMap = useMemo(() => {
    if (valveIdsByModule) return valveIdsByModule;
    return {
      milk: valveIds,
      coffee: valveIds,
      water: valveIds,
    } as Record<DrinkxHost, string[]>;
  }, [valveIdsByModule, valveIds]);

  const allSensors = useMemo(() => {
    const set = new Set<string>(availableSensors ?? sensorNames);
    for (const n of sensorNames) set.add(n);
    for (const e of events) {
      if (e.kind === "sensor") set.add(seriesKey(e.module, e.name));
    }
    return [...set];
  }, [availableSensors, sensorNames, events]);

  /** Latest sync inputs — interval must NOT reset on every events render.
   * Declared after valvesMap/allSensors (TDZ): syncLatest used to read them
   * before initialization and crashed ModulesLabCharts on mount. */
  const syncLatest = useRef({
    events,
    allSensors,
    focus,
    valvesMap,
    heaterIds,
    liveActuators,
  });
  syncLatest.current = {
    events,
    allSensors,
    focus,
    valvesMap,
    heaterIds,
    liveActuators,
  };

  const groupedNames = useMemo(() => {
    if (!groupByModule) return null;
    const map: Record<string, string[]> = {
      milk: [],
      coffee: [],
      water: [],
      other: [],
    };
    for (const name of sensorNames) {
      const { module } = parseSeriesKey(name);
      if (module === "milk" || module === "coffee" || module === "water") {
        map[module]!.push(name);
      } else {
        map.other!.push(name);
      }
    }
    return map;
  }, [groupByModule, sensorNames]);

  async function openChart(sensor: string | null) {
    setFocus(sensor);
    setOpenError(null);
    const payload = buildSyncPayload(
      events,
      allSensors,
      sensor,
      valvesMap,
      heaterIds,
      liveActuators
    );

    if (typeof window.desktop.openLabChartWindow !== "function") {
      setModalFallback(true);
      setOpenError(
        "IPC labChart недоступен — нужен рестарт приложения. Открыл встроенный просмотр."
      );
      return;
    }

    try {
      // Open first, then sync — large trimLabEventsForChartSync payloads
      // must not block BrowserWindow creation.
      const res = await window.desktop.openLabChartWindow({
        focusSensor: sensor,
      });
      if (res && "ok" in res && res.ok === false) {
        setModalFallback(true);
        setOpenError(res.error || "Не удалось открыть окно");
        return;
      }
      await window.desktop.syncLabChartState(payload);
      setChartOpen(true);
      setModalFallback(false);
    } catch (e) {
      setModalFallback(true);
      setOpenError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    const offClosed = window.desktop.onLabChartClosed?.(() => {
      setChartOpen(false);
    });
    void window.desktop.labChartIsOpen?.().then((r) => {
      if (r?.open) setChartOpen(true);
    });
    return () => offClosed?.();
  }, []);

  /**
   * Stable throttle: deps only [chartOpen]. Previously debounce(400) + interval
   * listed `events`/`liveActuators` and reset on every poll emit — under dual
   * poll (~800ms, multiple emits/tick) the timer never fired, so the chart
   * window froze on the open-time slice (~15 min of data at 30k/33 evt/s).
   */
  useEffect(() => {
    if (!chartOpen) return;
    const push = () => {
      const s = syncLatest.current;
      const payload = buildSyncPayload(
        s.events,
        s.allSensors,
        s.focus,
        s.valvesMap,
        s.heaterIds,
        s.liveActuators
      );
      void window.desktop.syncLabChartState?.(payload);
    };
    push();
    const id = setInterval(push, 1000);
    return () => clearInterval(id);
  }, [chartOpen]);

  if (sensorNames.length === 0) {
    return (
      <div className="stack" style={{ gap: 8 }}>
        <p className="muted" style={{ margin: 0 }}>
          Нет точек датчиков — подождите опрос комплекса, включите треки или
          откройте сохранённый лог.
        </p>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn"
            onClick={() => void openChart(null)}
          >
            Открыть лог графика
          </button>
          <span className="muted" style={{ fontSize: "0.8rem" }}>
            без сессии · «Импорт лога» в окне
          </span>
          {openError ? (
            <span
              className="muted"
              style={{ fontSize: "0.8rem", color: "var(--danger, #e87a9a)" }}
            >
              {openError}
            </span>
          ) : null}
        </div>
        {modalFallback ? (
          <div
            className="lab-chart-modal-backdrop"
            role="presentation"
            onClick={() => setModalFallback(false)}
          >
            <div
              className="lab-chart-modal"
              role="dialog"
              aria-modal="true"
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className="row"
                style={{ justifyContent: "flex-end", marginBottom: 8 }}
              >
                <button
                  type="button"
                  className="btn"
                  onClick={() => setModalFallback(false)}
                >
                  Закрыть
                </button>
              </div>
              <LabChartPanel
                {...buildSyncPayload(
                  events,
                  allSensors,
                  focus,
                  valvesMap,
                  heaterIds,
                  liveActuators
                )}
                windowMode={false}
              />
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  function renderCard(name: string) {
    const { module, name: local } = parseSeriesKey(name);
    const until = Date.now();
    const since = until - 60_000;
    let pts = sensorSeries(events, name, 100, since, until);
    if (local === "pumpPower" && pts.filter((p) => p.v != null).length < 2 && module) {
      const fromPump = pumpPowerSeries(events, since, 100, module, until);
      if (fromPump.filter((p) => p.v != null).length > pts.filter((p) => p.v != null).length) {
        pts = fromPump;
      }
    }
    const finite = pts.filter((p) => isFiniteSeriesValue(p.v));
    if (finite.length === 1) {
      const p = finite[0]!;
      pts = [
        { t: p.t - 1000, v: p.v },
        { t: p.t, v: p.v },
      ];
    }
    const meta = chartSeriesMeta(name);
    const drawable = seriesHasDrawablePoints(pts);
    return (
      <button
        key={name}
        type="button"
        className="lab-chart-card lab-chart-card-btn"
        onClick={() => void openChart(name)}
        title="Открыть график комплекса в отдельном окне"
      >
        <div className="lab-chart-title">
          {meta.label}
          <span className="lab-chart-meta">
            {meta.code}
            {meta.unit ? ` · ${meta.unit}` : ""}
          </span>
        </div>
        {!drawable ? (
          <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
            мало точек — клик для окна
          </p>
        ) : (
          <Sparkline points={pts} until={until} height={72} />
        )}
      </button>
    );
  }

  const modalPayload = buildSyncPayload(
    events,
    allSensors,
    focus,
    valvesMap,
    heaterIds,
    liveActuators
  );

  return (
    <>
      <div className="row" style={{ marginBottom: 10, gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn"
          onClick={() => void openChart(sensorNames[0] ?? null)}
        >
          Открыть график в окне
        </button>
        <span className="muted" style={{ fontSize: "0.8rem" }}>
          отдельное окно · второй монитор / полный экран (F11)
        </span>
        {openError ? (
          <span className="muted" style={{ fontSize: "0.8rem", color: "var(--danger, #e87a9a)" }}>
            {openError}
          </span>
        ) : null}
      </div>
      {groupedNames ? (
        <div className="lab-charts-grouped">
          {(["milk", "coffee", "water"] as const).map((mod) => {
            if (groupedNames[mod]!.length === 0) return null;
            const { slots, rest } = layoutModuleChartKeys(
              mod,
              groupedNames[mod]!
            );
            const cols = moduleChartColumns(mod);
            return (
              <div key={mod} className="lab-charts-group">
                <div className="lab-charts-group-title">{mod}</div>
                <div
                  className={`lab-charts lab-charts-semantic lab-charts-cols-${cols}`}
                >
                  {slots.map((name, i) =>
                    name == null ? (
                      <div
                        key={`${mod}-spacer-${i}`}
                        className="lab-chart-spacer"
                        aria-hidden
                      />
                    ) : (
                      renderCard(name)
                    )
                  )}
                </div>
                {rest.length > 0 ? (
                  <div className="lab-charts" style={{ marginTop: 10 }}>
                    {rest.map(renderCard)}
                  </div>
                ) : null}
              </div>
            );
          })}
          {groupedNames.other!.length > 0 ? (
            <div className="lab-charts-group">
              <div className="lab-charts-group-title">прочее</div>
              <div className="lab-charts">{groupedNames.other!.map(renderCard)}</div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="lab-charts">{sensorNames.map(renderCard)}</div>
      )}

      {modalFallback ? (
        <div
          className="lab-chart-modal-backdrop"
          role="presentation"
          onClick={() => setModalFallback(false)}
        >
          <div
            className="lab-chart-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="row" style={{ justifyContent: "flex-end", marginBottom: 8 }}>
              <button
                type="button"
                className="btn"
                onClick={() => setModalFallback(false)}
              >
                Закрыть
              </button>
            </div>
            <LabChartPanel {...modalPayload} windowMode={false} />
          </div>
        </div>
      ) : null}
    </>
  );
}

/** Страница отдельного окна графика (live sync или standalone + импорт лога). */
export function LabChartWindowPage() {
  const [payload, setPayload] = useState<LabChartSyncPayload>(
    EMPTY_LAB_CHART_PAYLOAD
  );
  const [focus, setFocus] = useState<string | null>(() => {
    try {
      return new URLSearchParams(window.location.search).get("focus");
    } catch {
      return null;
    }
  });

  useEffect(() => {
    const applySync = (raw: unknown) => {
      if (!raw || typeof raw !== "object") return;
      const next = raw as LabChartSyncPayload;
      setPayload((prev) => ({
        ...next,
        events: mergeLabChartSyncEvents(prev.events, next.events ?? []),
      }));
    };
    void window.desktop.pullLabChartState?.().then((raw) => {
      applySync(raw);
    });
    const offState = window.desktop.onLabChartState?.((raw) => {
      applySync(raw);
    });
    const offFocus = window.desktop.onLabChartFocus?.((p) => {
      if (p.focusSensor) setFocus(p.focusSensor);
    });
    return () => {
      offState?.();
      offFocus?.();
    };
  }, []);

  const initial =
    focus ??
    payload.initialSensor ??
    payload.allSensors[0] ??
    null;

  return (
    <LabChartPanel
      {...payload}
      initialSensor={initial}
      windowMode
    />
  );
}

function Sparkline({
  points,
  until,
  height = 72,
}: {
  points: Array<{ t: number; v: number | null }>;
  until: number;
  height?: number;
}) {
  const w = 320;
  const h = height;
  const pad = 4;
  if (!seriesHasDrawablePoints(points)) {
    return (
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} className="lab-spark">
        <text x={pad} y={h / 2} fill="var(--text-muted)" fontSize="11">
          —
        </text>
      </svg>
    );
  }
  const { min, max } = seriesYDomain(points);
  const span = max - min || 1;
  const t0 = Math.min(points[0]!.t, until - 1_000);
  const t1 = Math.max(until, points[points.length - 1]!.t);
  const tSpan = t1 - t0 || 1;
  const path = seriesPathD(
    points,
    (t) => pad + ((t - t0) / tSpan) * (w - pad * 2),
    (v) => h - pad - ((v - min) / span) * (h - pad * 2)
  );
  const lastFinite = [...points].reverse().find((p) => isFiniteSeriesValue(p.v))!;
  const currentLabel =
    lastFinite.t < until - 2_000
      ? "—"
      : (lastFinite.v as number).toFixed(2);
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width="100%"
      height={h}
      className="lab-spark"
    >
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2" />
      <text x={pad} y={12} fill="var(--text-muted)" fontSize="10">
        {max.toFixed(2)}
      </text>
      <text x={w - pad - 36} y={12} fill="var(--text-muted)" fontSize="10">
        {currentLabel}
      </text>
      <text x={pad} y={h - 2} fill="var(--text-muted)" fontSize="10">
        {min.toFixed(2)}
      </text>
    </svg>
  );
}
