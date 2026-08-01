/**
 * Мини-графики Modules Lab + открытие отдельного окна «График комплекса».
 * Fallback: модалка, если IPC labChart ещё не в preload (нужен рестарт Electron).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  chartSeriesMeta,
  layoutModuleChartKeys,
  moduleChartColumns,
  parseSeriesKey,
  pumpPowerSeries,
  sensorSeries,
  seriesKey,
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
 * Пустой payload — «Импорт лога»; если в main уже есть последний sync — подтянется.
 */
export async function openLabChartLogViewer(): Promise<{
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
    const current = await window.desktop.pullLabChartState?.();
    if (!current || typeof current !== "object") {
      await window.desktop.syncLabChartState?.(EMPTY_LAB_CHART_PAYLOAD);
    }
    const res = await window.desktop.openLabChartWindow({});
    if (res && "ok" in res && res.ok === false) {
      return { ok: false, error: res.error || "Не удалось открыть окно" };
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

/** Синхронизация в окно графика: хватает на 15+ мин многоканальной сессии. */
const SYNC_MAX_EVENTS = 30_000;

function buildSyncPayload(
  events: LabEvent[],
  allSensors: string[],
  focus: string | null,
  valvesMap: Record<DrinkxHost, string[]>,
  heaterIds: string[],
  liveActuators?: LabChartSyncPayload["liveActuators"]
): LabChartSyncPayload {
  // Клапаны/насосы не выкидывать при обрезке — иначе оверлеи пустые.
  const actuators = events.filter(
    (e) => e.kind === "valve" || e.kind === "pump" || e.kind === "heater"
  );
  const rest = events.filter(
    (e) => e.kind !== "valve" && e.kind !== "pump" && e.kind !== "heater"
  );
  const keepAct = actuators.slice(-8_000);
  const keepRest = rest.slice(-(SYNC_MAX_EVENTS - keepAct.length));
  const trimmed = [...keepAct, ...keepRest].sort(
    (a, b) => Date.parse(a.at) - Date.parse(b.at)
  );
  return {
    events: trimmed,
    allSensors,
    initialSensor: focus,
    valvesMap,
    heaterIds,
    liveActuators,
  };
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
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      await window.desktop.syncLabChartState(payload);
      const res = await window.desktop.openLabChartWindow({
        focusSensor: sensor,
      });
      if (res && "ok" in res && res.ok === false) {
        setModalFallback(true);
        setOpenError(res.error || "Не удалось открыть окно");
        return;
      }
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

  useEffect(() => {
    if (!chartOpen) return;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      const payload = buildSyncPayload(
        events,
        allSensors,
        focus,
        valvesMap,
        heaterIds,
        liveActuators
      );
      void window.desktop.syncLabChartState?.(payload);
    }, 400);
    return () => {
      if (syncTimer.current) clearTimeout(syncTimer.current);
    };
  }, [chartOpen, events, allSensors, focus, valvesMap, heaterIds, liveActuators]);

  /** Heartbeat: даже если React не пересоздал events, подтягиваем срез в окно. */
  useEffect(() => {
    if (!chartOpen) return;
    const id = setInterval(() => {
      const payload = buildSyncPayload(
        events,
        allSensors,
        focus,
        valvesMap,
        heaterIds,
        liveActuators
      );
      void window.desktop.syncLabChartState?.(payload);
    }, 1500);
    return () => clearInterval(id);
  }, [chartOpen, events, allSensors, focus, valvesMap, heaterIds, liveActuators]);

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
    let pts = sensorSeries(events, name, 100);
    if (local === "pumpPower" && pts.length < 2 && module) {
      const fromPump = pumpPowerSeries(events, null, 100, module);
      if (fromPump.length > pts.length) pts = fromPump;
    }
    if (pts.length === 1) {
      const p = pts[0]!;
      pts = [
        { t: p.t - 1000, v: p.v },
        { t: p.t, v: p.v },
      ];
    }
    const meta = chartSeriesMeta(name);
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
        {pts.length < 2 ? (
          <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
            мало точек ({pts.length}) — клик для окна
          </p>
        ) : (
          <Sparkline points={pts} height={72} />
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
    void window.desktop.pullLabChartState?.().then((raw) => {
      if (raw && typeof raw === "object") {
        setPayload(raw as LabChartSyncPayload);
      }
    });
    const offState = window.desktop.onLabChartState?.((raw) => {
      if (raw && typeof raw === "object") {
        setPayload(raw as LabChartSyncPayload);
      }
    });
    const offFocus = window.desktop.onLabChartFocus?.((p) => {
      if (p.focusSensor) setFocus(p.focusSensor);
    });
    return () => {
      offState?.();
      offFocus?.();
    };
  }, []);

  return (
    <LabChartPanel
      {...payload}
      initialSensor={focus ?? payload.initialSensor}
      windowMode
    />
  );
}

function Sparkline({
  points,
  height = 72,
}: {
  points: Array<{ t: number; v: number }>;
  height?: number;
}) {
  const w = 320;
  const h = height;
  const pad = 4;
  const vs = points.map((p) => p.v);
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  const span = max - min || 1;
  const path = points
    .map((p, i) => {
      const x = pad + (i / (points.length - 1)) * (w - pad * 2);
      const y = h - pad - ((p.v - min) / span) * (h - pad * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
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
      <text x={pad} y={h - 2} fill="var(--text-muted)" fontSize="10">
        {min.toFixed(2)}
      </text>
    </svg>
  );
}
