/**
 * Полный UI графика комплекса (отдельное окно / enlarge).
 * Срез маркера — скрываемый; импорт/экспорт полного лога событий.
 */

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type SetStateAction,
} from "react";
import {
  DRINKX_HOSTS,
  HEATER_LABELS,
  VALVE_LABELS,
  booleanStepSeries,
  chartSeriesMeta,
  chartSinceMs,
  collectOnboardSeriesKeys,
  complexSensorCatalog,
  convertOnboardRecordsToLabEvents,
  isFiniteSeriesValue,
  maxLabEventAtMs,
  onboardHeaterIds,
  onboardHeaterPwmOverlayKeys,
  onboardPumpOverlayHosts,
  onboardValveOverlayKeys,
  parseOnboardRingJsonlText,
  parseSeriesKey,
  pumpPowerSeries,
  sensorSeries,
  seriesHasDrawablePoints,
  seriesKey,
  seriesPathD,
  seriesYDomain,
  snapshotAt,
  valvesMapFromOnboardEvents,
  type ChartTimeScale,
  type DrinkxHost,
  type LabEvent,
  type LabSnapshotRow,
} from "@service-monitor/core";
import {
  LAB_CHART_MIN_WINDOW_MS,
  LAB_CHART_PRESET_MS,
  clampChartWindowMs,
  findBooleanSegmentEdges,
  formatBooleanSegmentTooltip,
  formatWindowDurationLabel,
  matchPresetScale,
  panOffsetFromOverviewFraction,
  panOffsetForViewStart,
  zoomChartViewport,
} from "../lib/lab-chart-viewport";

const SERIES_COLORS = [
  "#3db8a8",
  "#e8a838",
  "#6ea8fe",
  "#e87a9a",
  "#a78bfa",
  "#84cc16",
  "#f97316",
  "#22d3ee",
];

const ACTUATOR_COLORS = [
  "#94a3b8",
  "#64748b",
  "#cbd5e1",
  "#78716c",
  "#a8a29e",
  "#71717a",
  "#52525b",
  "#eab308",
];

type YScale = "auto" | "norm" | "stack" | "0-5" | "0-100" | "0-120";

export type LabChartSyncPayload = {
  events: LabEvent[];
  allSensors: string[];
  initialSensor: string | null;
  valvesMap: Record<DrinkxHost, string[]>;
  heaterIds: string[];
  liveActuators?: {
    valves: Record<string, boolean>;
    pumps: Partial<Record<DrinkxHost, boolean>>;
  };
  /** Live sync / onboard: auto-enable these valve overlays (`milk.drain`). */
  overlays?: {
    valves?: string[];
    pumpOn?: DrinkxHost[];
    pumpPower?: DrinkxHost[];
    heaterPwm?: string[];
  };
};

/** Пустой снимок для окна графика без сессии / до импорта лога. */
export const EMPTY_LAB_CHART_PAYLOAD: LabChartSyncPayload = {
  events: [],
  allSensors: [],
  initialSensor: null,
  valvesMap: { milk: [], coffee: [], water: [] },
  heaterIds: [],
};

const LOG_KIND = "service-monitor-lab-chart";
const LOG_VERSION = 1;

/**
 * Canonical Modules chart order (`complexSensorCatalog()`: per module —
 * overheats, input, pumpCurrent, heater outs, pumpPower, pumpCurrentL,
 * heater PWMs — milk → coffee → water), used to order both the sidebar
 * sensor checklist and the plotted lanes. Onboard events arrive in whatever
 * order the poller happens to emit them each tick (facade sensors, then
 * heaters, then pumps, then DX) — reusing that as display order produced a
 * chart layout that didn't resemble the Modules tab at all (e.g. all heater
 * PWM lanes grouped together instead of sitting next to their own module's
 * readings). Anything not in the fixed catalog (unexpected/future sensor
 * name) still shows, just appended after in first-seen order.
 */
const SENSOR_CATALOG_RANK: ReadonlyMap<string, number> = new Map(
  complexSensorCatalog().map((key, i) => [key, i])
);
function sensorCatalogRank(key: string): number {
  return SENSOR_CATALOG_RANK.get(key) ?? Number.MAX_SAFE_INTEGER;
}

function heaterPwmKey(mod: DrinkxHost, hid: string): string {
  return seriesKey(mod, `${hid}_pwm`);
}

function formatSliceValue(value: string | number | boolean | null): string {
  if (value === true) return "ON";
  if (value === false) return "OFF";
  if (value == null) return "—";
  return String(value);
}

/** Подпись полосы: модуль не выкидываем (milk·насос). */
function laneLabel(label: string): string {
  const short = label
    .replace(/ · Насос ON\/OFF$/i, "·насос")
    .replace(/^milk · /i, "milk·")
    .replace(/^coffee · /i, "coffee·")
    .replace(/^water · /i, "water·");
  return short.length > 30 ? `${short.slice(0, 28)}…` : short;
}

function compactSeriesLabel(label: string, code: string): string {
  const short = label
    .replace(/^milk · /i, "m·")
    .replace(/^coffee · /i, "c·")
    .replace(/^water · /i, "w·");
  if (short.length <= 22) return short;
  return code.length <= 22 ? code : `${code.slice(0, 20)}…`;
}

function rowModule(row: LabSnapshotRow): DrinkxHost | "other" {
  if (row.module === "milk" || row.module === "coffee" || row.module === "water") {
    return row.module;
  }
  return "other";
}

function moveKey(order: string[], key: string, dir: -1 | 1): string[] {
  const i = order.indexOf(key);
  if (i < 0) return order;
  const j = i + dir;
  if (j < 0 || j >= order.length) return order;
  const next = [...order];
  const tmp = next[i]!;
  next[i] = next[j]!;
  next[j] = tmp;
  return next;
}

/**
 * Достраиваем ступеньки до now по истории событий.
 * Без истории — пусто: live-снимок НЕ растягиваем на весь view
 * (раньше viewStart→now заливало насос ON на всю шкалу).
 */
function finalizeActuatorPoints(
  points: Array<{ t: number; v: number }>,
  now: number
): Array<{ t: number; v: number }> {
  if (points.length === 0) return [];
  const out = points.map((p) => ({ ...p }));
  const last = out[out.length - 1]!;
  if (last.t < now) {
    out.push({ t: now, v: last.v });
  }
  return out;
}

function isLabChartLog(raw: unknown): raw is {
  kind: string;
  version: number;
  events: LabEvent[];
  allSensors?: string[];
  valvesMap?: Record<DrinkxHost, string[]>;
  heaterIds?: string[];
  selected?: string[];
  overlays?: {
    valves?: string[];
    pumpOn?: DrinkxHost[];
    pumpPower?: DrinkxHost[];
    heaterPwm?: string[];
  };
  timeScale?: ChartTimeScale;
  yScale?: YScale;
  markerAt?: string | null;
  sliceOrder?: Partial<Record<DrinkxHost, string[]>>;
} {
  if (!raw || typeof raw !== "object") return false;
  const o = raw as Record<string, unknown>;
  return (
    o.kind === LOG_KIND &&
    typeof o.version === "number" &&
    Array.isArray(o.events)
  );
}

/**
 * Local fallback for small files when labChartImportLog IPC is missing
 * (needs Electron restart). Prefer main-process streaming import.
 */
function parseOnboardRingJsonl(text: string): unknown[] | null {
  return parseOnboardRingJsonlText(text);
}

type ContinuousSeries = {
  id: string;
  label: string;
  code: string;
  unit: string;
  color: string;
  points: Array<{ t: number; v: number | null }>;
};

type ActuatorSeries = {
  id: string;
  label: string;
  color: string;
  points: Array<{ t: number; v: number }>;
};

export function LabChartPanel({
  events,
  allSensors,
  initialSensor,
  valvesMap,
  heaterIds,
  liveActuators: _liveActuators,
  overlays,
  windowMode = false,
}: LabChartSyncPayload & { windowMode?: boolean }) {
  const [replay, setReplay] = useState<LabChartSyncPayload | null>(null);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialSensor ? [initialSensor] : [])
  );
  const [timeScale, setTimeScale] = useState<ChartTimeScale>("5m");
  /**
   * Непрерывное окно (колёсико / ручки overview). `null` = брать пресет
   * из timeScale (`all` → весь span).
   */
  const [customWindowMs, setCustomWindowMs] = useState<number | null>(null);
  const [yScale, setYScale] = useState<YScale>("auto");
  /** Сдвиг назад от «живого» края (мс). 0 = следим за сейчас. */
  const [panOffsetMs, setPanOffsetMs] = useState(0);
  const [showPumpOn, setShowPumpOn] = useState<Set<DrinkxHost>>(() => new Set());
  const [showPumpPower, setShowPumpPower] = useState<Set<DrinkxHost>>(() => new Set());
  const [valvesOn, setValvesOn] = useState<Set<string>>(
    () => new Set(overlays?.valves ?? [])
  );
  const [heaterPwmOn, setHeaterPwmOn] = useState<Set<string>>(() => new Set());
  const [markerT, setMarkerT] = useState<number | null>(null);
  const [overlaysOpen, setOverlaysOpen] = useState(false);
  const [sliceOpen, setSliceOpen] = useState(true);
  const [sliceOrder, setSliceOrder] = useState<Record<DrinkxHost, string[]>>(
    () => ({ milk: [], coffee: [], water: [] })
  );
  const importRef = useRef<HTMLInputElement>(null);
  /** Live wall-clock for window mode so the axis advances even between IPC syncs. */
  const [wallNow, setWallNow] = useState(() => Date.now());
  const [importProgress, setImportProgress] = useState<{
    pct: number;
    label: string;
  } | null>(null);

  useEffect(() => {
    if (!windowMode || replay) return;
    const id = setInterval(() => setWallNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [windowMode, replay]);

  /** Onboard / sync: enable valve overlays listed in payload.overlays.valves. */
  useEffect(() => {
    const keys = overlays?.valves;
    if (!keys?.length) return;
    setValvesOn((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const k of keys) {
        if (!next.has(k)) {
          next.add(k);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [overlays?.valves]);

  useEffect(() => {
    const pumps = overlays?.pumpOn;
    if (!pumps?.length) return;
    setShowPumpOn((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const h of pumps) {
        if (!next.has(h)) {
          next.add(h);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [overlays?.pumpOn]);

  const effectiveEvents = replay?.events ?? events;
  const effectiveSensors = replay?.allSensors ?? allSensors;
  const effectiveValvesMap = replay?.valvesMap ?? valvesMap;
  const effectiveHeaterIds = replay?.heaterIds ?? heaterIds;
  const replayNow = useMemo(() => {
    if (!replay) return null;
    return maxLabEventAtMs(replay.events);
  }, [replay]);
  const clockNow = replayNow ?? (windowMode ? wallNow : Date.now());

  const dataSpan = useMemo(() => {
    let minT = Number.POSITIVE_INFINITY;
    let maxT = Number.NEGATIVE_INFINITY;
    for (const event of effectiveEvents) {
      const t = Date.parse(event.at);
      if (!Number.isFinite(t)) continue;
      if (t < minT) minT = t;
      if (t > maxT) maxT = t;
    }
    if (!Number.isFinite(minT)) {
      return { minT: clockNow - 60_000, maxT: clockNow };
    }
    return { minT, maxT: Math.max(maxT, clockNow) };
  }, [effectiveEvents, clockNow]);

  const dataSpanMs = Math.max(0, dataSpan.maxT - dataSpan.minT);

  const windowMs = useMemo(() => {
    if (customWindowMs != null) {
      return clampChartWindowMs(customWindowMs, { dataSpanMs });
    }
    if (timeScale === "all") return null;
    return LAB_CHART_PRESET_MS[timeScale];
  }, [customWindowMs, dataSpanMs, timeScale]);

  /**
   * Сколько можно сдвинуть окно назад: правый край уходит от «сейчас»
   * до тех пор, пока левый край не совпадёт с самым ранним событием сессии.
   * Для «всё» панорамирование не нужно — ось = весь span.
   */
  const maxPanMs = useMemo(() => {
    if (windowMs == null) return 0;
    return Math.max(0, clockNow - dataSpan.minT - windowMs);
  }, [clockNow, dataSpan.minT, windowMs]);

  const panClamped = Math.min(Math.max(0, panOffsetMs), maxPanMs);
  const viewEnd = clockNow - panClamped;
  /** Фиксированные шкалы: ровно 1m/5m/15m, даже если слева ещё нет точек. */
  const viewStart =
    windowMs == null ? dataSpan.minT : viewEnd - windowMs;
  const since = windowMs == null ? dataSpan.minT : viewStart;
  /** ~1 Гц × 15 мин + запас; «всё» — не режем ниже объёма буфера. */
  const limit =
    windowMs == null
      ? Math.max(20_000, effectiveEvents.length)
      : Math.max(2_000, Math.ceil((windowMs / 1000) * 2) + 100);

  const scaleSelectValue = matchPresetScale(windowMs);

  function applyTimeScale(next: ChartTimeScale) {
    setTimeScale(next);
    setCustomWindowMs(null);
    setPanOffsetMs(0);
  }

  function applyViewportZoom(anchorT: number, factor: number) {
    const baseWindow =
      windowMs ??
      clampChartWindowMs(LAB_CHART_PRESET_MS["15m"], { dataSpanMs });
    const next = zoomChartViewport({
      windowMs: baseWindow,
      panOffsetMs: windowMs == null ? 0 : panClamped,
      clockNow,
      dataMinT: dataSpan.minT,
      anchorT,
      // From «всё»: first notch opens a 15m window about the cursor (factor≈1).
      factor: windowMs == null ? 1 : factor,
    });
    setCustomWindowMs(next.windowMs);
    setPanOffsetMs(next.panOffsetMs);
    if (timeScale === "all") setTimeScale("15m");
  }

  function applyOverviewPan(fraction: number) {
    if (windowMs == null) return;
    setPanOffsetMs(
      panOffsetFromOverviewFraction({
        fraction,
        windowMs,
        clockNow,
        dataMinT: dataSpan.minT,
        mode: "seek",
      })
    );
  }

  function applyOverviewWindowStart(viewStartMs: number) {
    if (windowMs == null) return;
    setPanOffsetMs(
      panOffsetForViewStart({
        viewStartMs,
        windowMs,
        clockNow,
        dataMinT: dataSpan.minT,
      })
    );
  }

  function applyOverviewResize(edge: "in" | "out", fraction: number) {
    const span = Math.max(1, dataSpan.maxT - dataSpan.minT);
    const t = dataSpan.minT + Math.min(1, Math.max(0, fraction)) * span;
    if (edge === "in") {
      const nextWindow = clampChartWindowMs(viewEnd - t, { dataSpanMs });
      setCustomWindowMs(nextWindow);
      setPanOffsetMs(Math.max(0, clockNow - viewEnd));
    } else {
      const nextEnd = Math.min(
        clockNow,
        Math.max(viewStart + LAB_CHART_MIN_WINDOW_MS, t)
      );
      const nextWindow = clampChartWindowMs(nextEnd - viewStart, {
        dataSpanMs,
      });
      setCustomWindowMs(nextWindow);
      setPanOffsetMs(Math.max(0, clockNow - (viewStart + nextWindow)));
    }
    if (timeScale === "all") setTimeScale("5m");
  }

  useEffect(() => {
    if (panOffsetMs > maxPanMs) setPanOffsetMs(maxPanMs);
  }, [maxPanMs, panOffsetMs]);

  useEffect(() => {
    if (!initialSensor || replay) return;
    setSelected((prev) => {
      if (prev.has(initialSensor)) return prev;
      return new Set(prev).add(initialSensor);
    });
  }, [initialSensor, replay]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F11" && windowMode) {
        e.preventDefault();
        void window.desktop.labChartToggleFullScreen?.();
        return;
      }
      if (e.key === "Escape") {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
        if (markerT != null) {
          e.preventDefault();
          setMarkerT(null);
        }
        return;
      }
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      e.preventDefault();
      const start = chartSinceMs(timeScale, clockNow);
      const span =
        timeScale === "all"
          ? 60_000
          : Math.max(1_000, (clockNow - (start ?? clockNow - 60_000)) * 0.02);
      const step = e.shiftKey ? span * 5 : span;
      setMarkerT((prev) => {
        const base = prev ?? clockNow;
        return e.key === "ArrowLeft" ? base - step : base + step;
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clockNow, markerT, timeScale, windowMode]);

  const continuous = useMemo(() => {
    const series: ContinuousSeries[] = [];
    let ci = 0;
    const pushSeries = (id: string) => {
      if (series.some((item) => item.id === id)) return;
      const meta = chartSeriesMeta(id);
      const { module, name: local } = parseSeriesKey(id);
      let points = sensorSeries(
        effectiveEvents,
        id,
        limit,
        since,
        viewEnd
      );
      if (
        local === "pumpPower" &&
        points.filter((p) => isFiniteSeriesValue(p.v)).length < 2 &&
        module
      ) {
        const fromPump = pumpPowerSeries(
          effectiveEvents,
          since,
          limit,
          module,
          viewEnd
        );
        if (
          fromPump.filter((p) => isFiniteSeriesValue(p.v)).length >
          points.filter((p) => isFiniteSeriesValue(p.v)).length
        ) {
          points = fromPump;
        }
      }
      series.push({
        id,
        label: meta.label,
        code: meta.code,
        unit: meta.unit,
        color: SERIES_COLORS[ci % SERIES_COLORS.length]!,
        points,
      });
      ci += 1;
    };
    // Canonical Modules order first (see SENSOR_CATALOG_RANK) — covers plain
    // sensors, pumpPower and heater PWM together, module by module.
    for (const key of complexSensorCatalog()) {
      const { module: mod, name: local } = parseSeriesKey(key);
      if (local === "pumpPower") {
        if (showPumpPower.has(mod as DrinkxHost)) pushSeries(key);
        continue;
      }
      if (local.endsWith("_pwm")) {
        if (heaterPwmOn.has(key)) pushSeries(key);
        continue;
      }
      if (selected.has(key)) pushSeries(key);
    }
    // Anything selected/enabled but outside the fixed catalog (unexpected or
    // future sensor names) — still shown, appended after (pushSeries dedupes
    // ids already added above, so this is a pure fallback pass).
    for (const name of effectiveSensors) {
      if (selected.has(name)) pushSeries(name);
    }
    for (const mod of DRINKX_HOSTS) {
      if (showPumpPower.has(mod)) pushSeries(seriesKey(mod, "pumpPower"));
      for (const hid of effectiveHeaterIds) {
        const id = heaterPwmKey(mod, hid);
        if (heaterPwmOn.has(id)) pushSeries(id);
      }
    }
    return series;
  }, [
    effectiveEvents,
    effectiveHeaterIds,
    effectiveSensors,
    heaterPwmOn,
    limit,
    selected,
    showPumpPower,
    since,
    viewEnd,
  ]);

  const actuators = useMemo(() => {
    const list: ActuatorSeries[] = [];
    let ai = 0;
    for (const mod of DRINKX_HOSTS) {
      for (const id of effectiveValvesMap[mod] ?? []) {
        const key = seriesKey(mod, id);
        if (!valvesOn.has(key)) continue;
        const raw = booleanStepSeries(
          effectiveEvents,
          "valve",
          key,
          since,
          limit,
          viewEnd
        );
        list.push({
          id: `valve:${key}`,
          label: `${mod} · ${VALVE_LABELS[id] ?? id}`,
          color: ACTUATOR_COLORS[ai++ % ACTUATOR_COLORS.length]!,
          points: finalizeActuatorPoints(raw, viewEnd),
        });
      }
      if (showPumpOn.has(mod)) {
        const key = seriesKey(mod, "pump");
        const raw = booleanStepSeries(
          effectiveEvents,
          "pump",
          key,
          since,
          limit,
          viewEnd
        );
        list.push({
          id: `pump:${key}`,
          label: `${mod} · Насос ON/OFF`,
          color: ACTUATOR_COLORS[ai++ % ACTUATOR_COLORS.length]!,
          points: finalizeActuatorPoints(raw, viewEnd),
        });
      }
    }
    return list;
  }, [
    effectiveEvents,
    effectiveValvesMap,
    limit,
    showPumpOn,
    since,
    valvesOn,
    viewEnd,
  ]);

  const slice = useMemo(
    () => (markerT == null ? [] : snapshotAt(effectiveEvents, markerT)),
    [effectiveEvents, markerT]
  );
  const sliceByModule = useMemo(() => {
    const map: Record<DrinkxHost | "other", LabSnapshotRow[]> = {
      milk: [],
      coffee: [],
      water: [],
      other: [],
    };
    for (const row of slice) map[rowModule(row)].push(row);
    return map;
  }, [slice]);

  useEffect(() => {
    if (markerT == null) return;
    setSliceOrder((prev) => {
      const next = { ...prev };
      for (const mod of DRINKX_HOSTS) {
        const keys = sliceByModule[mod].map((row) => `${row.kind}:${row.key}`);
        const kept = prev[mod].filter((key) => keys.includes(key));
        next[mod] = [...kept, ...keys.filter((key) => !kept.includes(key))];
      }
      return next;
    });
  }, [markerT, sliceByModule]);

  const sensorsByModule = useMemo(() => {
    const map: Record<DrinkxHost, string[]> = { milk: [], coffee: [], water: [] };
    for (const key of effectiveSensors) {
      const { module } = parseSeriesKey(key);
      if (module === "milk" || module === "coffee" || module === "water") {
        map[module].push(key);
      }
    }
    // Sidebar checklist order should match the plotted order (see
    // SENSOR_CATALOG_RANK) instead of raw event-arrival order.
    for (const mod of DRINKX_HOSTS) {
      map[mod].sort((a, b) => sensorCatalogRank(a) - sensorCatalogRank(b));
    }
    return map;
  }, [effectiveSensors]);

  function toggleSensor(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleSet(setter: Dispatch<SetStateAction<Set<string>>>, id: string) {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleHostSet(
    setter: Dispatch<SetStateAction<Set<DrinkxHost>>>,
    mod: DrinkxHost
  ) {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(mod)) next.delete(mod);
      else next.add(mod);
      return next;
    });
  }

  function exportChartLog() {
    const t = markerT ?? clockNow;
    const payload = {
      kind: LOG_KIND,
      version: LOG_VERSION,
      exportedAt: new Date().toISOString(),
      markerAt: markerT == null ? null : new Date(markerT).toISOString(),
      timeScale,
      yScale,
      events: effectiveEvents,
      allSensors: effectiveSensors,
      valvesMap: effectiveValvesMap,
      heaterIds: effectiveHeaterIds,
      selected: [...selected],
      overlays: {
        valves: [...valvesOn],
        pumpOn: [...showPumpOn],
        pumpPower: [...showPumpPower],
        heaterPwm: [...heaterPwmOn],
      },
      sliceOrder,
      snapshot: snapshotAt(effectiveEvents, t),
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `complex-chart-${new Date(t)
      .toISOString()
      .replace(/[:.]/g, "-")}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  /** Onboard ring events (already converted + capped in main) → replay. */
  function loadOnboardEventsReplay(converted: LabEvent[]): void {
    if (converted.length === 0) {
      throw new Error(
        "Ring пуст или не содержит распознаваемых записей (v/ts/kind/module/name)"
      );
    }
    const importedSensors = collectOnboardSeriesKeys(converted);
    const payload: LabChartSyncPayload = {
      events: converted,
      allSensors: importedSensors,
      initialSensor: null,
      valvesMap: valvesMapFromOnboardEvents(converted),
      heaterIds: (() => {
        const ids = onboardHeaterIds(converted);
        return ids.length ? ids : heaterIds;
      })(),
    };
    setReplay(payload);
    setSelected(new Set(importedSensors.slice(0, 1)));
    setValvesOn(new Set(onboardValveOverlayKeys(converted)));
    setShowPumpOn(new Set(onboardPumpOverlayHosts(converted)));
    setShowPumpPower(new Set());
    setHeaterPwmOn(new Set(onboardHeaterPwmOverlayKeys(converted)));
    setMarkerT(null);
    setSliceOpen(true);
  }

  /** Onboard ring (.jsonl) raw records → replay (small-file renderer fallback). */
  function loadOnboardRingReplay(records: unknown[]): void {
    loadOnboardEventsReplay(
      convertOnboardRecordsToLabEvents(records, "onboard-import")
    );
  }

  function applyChartLogRaw(raw: {
    events: LabEvent[];
    allSensors?: string[];
    selected?: string[];
    valvesMap?: Record<DrinkxHost, string[]>;
    heaterIds?: string[];
    overlays?: {
      valves?: string[];
      pumpOn?: DrinkxHost[];
      pumpPower?: DrinkxHost[];
      heaterPwm?: string[];
    };
    timeScale?: ChartTimeScale;
    yScale?: YScale;
    markerAt?: string | null;
    sliceOrder?: Partial<Record<DrinkxHost, string[]>>;
  }): void {
    const importedSensors = raw.allSensors ?? allSensors;
    const payload: LabChartSyncPayload = {
      events: raw.events,
      allSensors: importedSensors,
      initialSensor: null,
      valvesMap: raw.valvesMap ?? valvesMap,
      heaterIds: raw.heaterIds ?? heaterIds,
    };
    setReplay(payload);
    setSelected(new Set(raw.selected ?? importedSensors.slice(0, 1)));
    setValvesOn(new Set(raw.overlays?.valves ?? []));
    setShowPumpOn(new Set(raw.overlays?.pumpOn ?? []));
    setShowPumpPower(new Set(raw.overlays?.pumpPower ?? []));
    setHeaterPwmOn(new Set(raw.overlays?.heaterPwm ?? []));
    if (raw.timeScale) {
      setTimeScale(raw.timeScale);
      setCustomWindowMs(null);
      setPanOffsetMs(0);
    }
    if (raw.yScale) setYScale(raw.yScale);
    if (raw.sliceOrder) {
      setSliceOrder({
        milk: raw.sliceOrder.milk ?? [],
        coffee: raw.sliceOrder.coffee ?? [],
        water: raw.sliceOrder.water ?? [],
      });
    }
    const importedMarker = raw.markerAt ? Date.parse(raw.markerAt) : NaN;
    setMarkerT(Number.isFinite(importedMarker) ? importedMarker : null);
    setSliceOpen(true);
  }

  /** Preferred path: main streams/parses file — no 39 MB in renderer IPC. */
  async function importChartLogViaMain(path?: string): Promise<void> {
    if (typeof window.desktop.labChartImportLog !== "function") {
      throw new Error(
        "IPC labChart:importLog недоступен — перезапустите приложение"
      );
    }
    const unsub = window.desktop.onLabChartImportProgress?.((p) => {
      const pct =
        p.bytesTotal > 0
          ? Math.min(99, Math.round((100 * p.bytesRead) / p.bytesTotal))
          : p.phase === "done"
            ? 100
            : 0;
      const label =
        p.phase === "open"
          ? "Выберите файл…"
          : p.phase === "read"
            ? `Чтение… ${pct}%${p.records ? ` · ~${p.records} строк` : ""}`
            : p.phase === "done"
              ? `Готово · ${p.events} точек`
              : p.message || "Ошибка импорта";
      setImportProgress({ pct: p.phase === "done" ? 100 : pct, label });
    });
    try {
      setImportProgress({ pct: 0, label: "Импорт…" });
      const res = await window.desktop.labChartImportLog(
        path ? { path } : undefined
      );
      if (!res.ok) {
        if (res.canceled) return;
        throw new Error(res.error);
      }
      if (res.format === "chart-log") {
        if (!isLabChartLog(res.raw) || res.raw.version !== LOG_VERSION) {
          throw new Error("Неподдерживаемый формат «Экспорт лога»");
        }
        applyChartLogRaw(res.raw);
        return;
      }
      loadOnboardEventsReplay(res.events);
      if (res.meta.capped) {
        window.alert(
          `Импорт ок (downsample): ${res.meta.eventsAfterCap} из ${res.meta.eventsBeforeCap} событий для графика. ` +
            `Полный файл остаётся на диске: ${res.meta.path}`
        );
      }
    } finally {
      unsub?.();
      setImportProgress(null);
    }
  }

  /** Fallback when IPC missing: small files only via <input type=file>. */
  async function importChartLogFileFallback(file: File) {
    try {
      // Electron File often exposes absolute path — prefer main stream.
      const filePath =
        typeof (file as File & { path?: string }).path === "string"
          ? (file as File & { path: string }).path
          : "";
      if (
        filePath &&
        typeof window.desktop.labChartImportLog === "function" &&
        (file.size > 2 * 1024 * 1024 || /\.jsonl$/i.test(file.name))
      ) {
        await importChartLogViaMain(filePath);
        return;
      }

      const text = await file.text();

      let raw: unknown = null;
      let wholeFileParseError: unknown = null;
      try {
        raw = JSON.parse(text);
      } catch (e) {
        wholeFileParseError = e;
      }
      if (raw != null && isLabChartLog(raw) && raw.version === LOG_VERSION) {
        applyChartLogRaw(raw);
        return;
      }

      const ringRecords = parseOnboardRingJsonl(text);
      if (ringRecords) {
        loadOnboardRingReplay(ringRecords);
        return;
      }

      throw new Error(
        wholeFileParseError
          ? "Неподдерживаемый файл: ожидается «Экспорт лога» (.json) этого окна или ring бортового логгера (.jsonl)"
          : "Неподдерживаемый формат лога"
      );
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "Не удалось импортировать лог"
      );
    } finally {
      if (importRef.current) importRef.current.value = "";
    }
  }

  async function onImportClick() {
    try {
      if (typeof window.desktop.labChartImportLog === "function") {
        await importChartLogViaMain();
        return;
      }
      importRef.current?.click();
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "Не удалось импортировать лог"
      );
      setImportProgress(null);
    }
  }

  function orderedRows(mod: DrinkxHost): LabSnapshotRow[] {
    const rows = sliceByModule[mod];
    const byId = new Map(rows.map((row) => [`${row.kind}:${row.key}`, row]));
    const ordered = sliceOrder[mod]
      .map((key) => byId.get(key))
      .filter((row): row is LabSnapshotRow => row != null);
    for (const row of rows) {
      if (!sliceOrder[mod].includes(`${row.kind}:${row.key}`)) ordered.push(row);
    }
    return ordered;
  }

  function renderSliceRow(mod: DrinkxHost, row: LabSnapshotRow) {
    const id = `${row.kind}:${row.key}`;
    return (
      <div key={id} className="lab-chart-slice-row">
        <div className="lab-chart-slice-row-move">
          {([-1, 1] as const).map((dir) => (
            <button
              key={dir}
              type="button"
              className="btn btn-compact"
              aria-label={dir < 0 ? "Выше" : "Ниже"}
              onClick={() =>
                setSliceOrder((prev) => ({
                  ...prev,
                  [mod]: moveKey(prev[mod], id, dir),
                }))
              }
            >
              {dir < 0 ? "↑" : "↓"}
            </button>
          ))}
        </div>
        <div className="lab-chart-slice-row-grid">
          <span className="lab-chart-slice-k">{row.label}</span>
          <strong className="lab-chart-slice-v">
            {formatSliceValue(row.value)}
            {row.unit ? ` ${row.unit}` : ""}
          </strong>
          <code className="lab-chart-meta">{row.code}</code>
          <span className="lab-chart-meta">
            {row.at ? new Date(row.at).toLocaleTimeString() : "—"}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={`lab-chart-panel${windowMode ? " is-window" : ""}`}>
      <div className="lab-chart-modal-head">
        <h2 style={{ margin: 0, fontSize: "1.1rem" }}>
          График комплекса{replay ? " · просмотр лога" : ""}
        </h2>
        <div className="row" style={{ gap: 8 }}>
          <input
            ref={importRef}
            type="file"
            accept="application/json,.json,.jsonl"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importChartLogFileFallback(file);
            }}
          />
          <button
            type="button"
            className="btn"
            disabled={importProgress != null}
            onClick={() => void onImportClick()}
          >
            {importProgress ? `Импорт… ${importProgress.pct}%` : "Импорт лога"}
          </button>
          <button type="button" className="btn" onClick={exportChartLog}>
            Экспорт лога
          </button>
          {replay ? (
            <button type="button" className="btn" onClick={() => setReplay(null)}>
              {events.length > 0 ? "Живой режим" : "Очистить лог"}
            </button>
          ) : null}
          {windowMode ? (
            <button
              type="button"
              className="btn"
              onClick={() => void window.desktop.labChartToggleFullScreen?.()}
              title="F11"
            >
              Полный экран
            </button>
          ) : null}
        </div>
      </div>
      {importProgress ? (
        <p className="muted" style={{ margin: "0 0 8px", fontSize: "0.9rem" }}>
          {importProgress.label}
        </p>
      ) : null}

      <div className="lab-chart-modal-toolbar">
        <label className="muted">
          время{" "}
          <select
            value={scaleSelectValue}
            onChange={(event) => {
              const v = event.target.value;
              if (v === "custom") return;
              applyTimeScale(v as ChartTimeScale);
            }}
          >
            <option value="1m">1 мин</option>
            <option value="5m">5 мин</option>
            <option value="15m">15 мин</option>
            <option value="all">всё</option>
            {scaleSelectValue === "custom" && windowMs != null ? (
              <option value="custom">
                {formatWindowDurationLabel(windowMs)}
              </option>
            ) : null}
          </select>
        </label>
        <label className="muted">
          шкала Y{" "}
          <select
            value={yScale}
            onChange={(event) => setYScale(event.target.value as YScale)}
          >
            <option value="stack">стек (полосы)</option>
            <option value="norm">норм. % (одна ось)</option>
            <option value="auto">auto (общая)</option>
            <option value="0-5">0–5 (bar / A)</option>
            <option value="0-100">0–100 (%)</option>
            <option value="0-120">0–120 (°C)</option>
          </select>
        </label>
        {markerT != null ? (
          <>
            <button type="button" className="btn" onClick={() => setMarkerT(null)}>
              Сбросить маркер
            </button>
            <button
              type="button"
              className="btn btn-compact"
              onClick={() => setSliceOpen((value) => !value)}
            >
              {sliceOpen ? "Скрыть срез" : "Срез"}
            </button>
          </>
        ) : (
          <span className="muted">
            Клик — маркер · колесо — зум · ← → · Shift быстрее
            {windowMode ? " · F11 полный экран" : ""}
          </span>
        )}
        <button
          type="button"
          className="btn btn-compact"
          onClick={() => setOverlaysOpen((value) => !value)}
        >
          {overlaysOpen ? "Скрыть модули" : "Модули milk/coffee/water"}
        </button>
      </div>

      {effectiveEvents.length === 0 ? (
        <p className="muted" style={{ margin: "0 0 8px" }}>
          Нет данных — нажмите «Импорт лога» и выберите JSON (Экспорт лога /
          service-monitor-lab-chart), либо дождитесь опроса комплекса.
        </p>
      ) : null}

      {overlaysOpen ? (
        <div className="lab-chart-overlays">
          {DRINKX_HOSTS.map((mod) => (
            <div key={mod} className="lab-chart-overlay-mod">
              <div className="lab-chart-overlay-title">{mod}</div>
              <div className="lab-chart-overlay-body">
                <div className="row" style={{ gap: 6, marginBottom: 6 }}>
                  <button
                    type="button"
                    className="btn btn-compact"
                    onClick={() => {
                      setValvesOn((prev) => {
                        const next = new Set(prev);
                        for (const id of effectiveValvesMap[mod] ?? []) {
                          next.add(seriesKey(mod, id));
                        }
                        return next;
                      });
                      setShowPumpOn((prev) => new Set(prev).add(mod));
                      setShowPumpPower((prev) => new Set(prev).add(mod));
                      setHeaterPwmOn((prev) => {
                        const next = new Set(prev);
                        for (const id of effectiveHeaterIds) {
                          next.add(heaterPwmKey(mod, id));
                        }
                        return next;
                      });
                      setSelected((prev) => {
                        const next = new Set(prev);
                        for (const name of sensorsByModule[mod]) next.add(name);
                        return next;
                      });
                      setYScale("stack");
                    }}
                  >
                    все
                  </button>
                  <button
                    type="button"
                    className="btn btn-compact"
                    onClick={() => {
                      setValvesOn((prev) => {
                        const next = new Set(prev);
                        for (const id of effectiveValvesMap[mod] ?? []) {
                          next.delete(seriesKey(mod, id));
                        }
                        return next;
                      });
                      setShowPumpOn((prev) => {
                        const next = new Set(prev);
                        next.delete(mod);
                        return next;
                      });
                      setShowPumpPower((prev) => {
                        const next = new Set(prev);
                        next.delete(mod);
                        return next;
                      });
                      setHeaterPwmOn((prev) => {
                        const next = new Set(prev);
                        for (const id of effectiveHeaterIds) {
                          next.delete(heaterPwmKey(mod, id));
                        }
                        return next;
                      });
                      setSelected((prev) => {
                        const next = new Set(prev);
                        for (const name of sensorsByModule[mod]) next.delete(name);
                        return next;
                      });
                    }}
                  >
                    сброс
                  </button>
                </div>
                <div className="lab-chart-side-title">Датчики</div>
                {sensorsByModule[mod].map((name) => {
                  const meta = chartSeriesMeta(name);
                  return (
                    <label key={name} className="lab-chart-check">
                      <input
                        type="checkbox"
                        checked={selected.has(name)}
                        onChange={() => toggleSensor(name)}
                      />
                      <span>
                        {meta.label.replace(`${mod} · `, "")}
                        <span className="lab-chart-meta">{meta.code}</span>
                      </span>
                    </label>
                  );
                })}
                <div className="lab-chart-side-title" style={{ marginTop: 8 }}>
                  Исполнители
                </div>
                {(effectiveValvesMap[mod] ?? []).map((id) => {
                  const key = seriesKey(mod, id);
                  return (
                    <label key={key} className="lab-chart-check">
                      <input
                        type="checkbox"
                        checked={valvesOn.has(key)}
                        onChange={() => toggleSet(setValvesOn, key)}
                      />
                      <span>
                        {VALVE_LABELS[id] ?? id}
                        <span className="lab-chart-meta">{key}</span>
                      </span>
                    </label>
                  );
                })}
                <label className="lab-chart-check">
                  <input
                    type="checkbox"
                    checked={showPumpOn.has(mod)}
                    onChange={() => toggleHostSet(setShowPumpOn, mod)}
                  />
                  <span>
                    Насос ON/OFF
                    <span className="lab-chart-meta">{mod}</span>
                  </span>
                </label>
                <label className="lab-chart-check">
                  <input
                    type="checkbox"
                    checked={showPumpPower.has(mod)}
                    onChange={() => toggleHostSet(setShowPumpPower, mod)}
                  />
                  <span>Мощность насоса %</span>
                </label>
                {effectiveHeaterIds.map((id) => {
                  const key = heaterPwmKey(mod, id);
                  return (
                    <label key={key} className="lab-chart-check">
                      <input
                        type="checkbox"
                        checked={heaterPwmOn.has(key)}
                        onChange={() => toggleSet(setHeaterPwmOn, key)}
                      />
                      <span>
                        {HEATER_LABELS[id] ?? id} ШИМ
                        <span className="lab-chart-meta">{key}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="lab-chart-main">
        <div className="lab-chart-plot-scroll">
          <MultiChart
            continuous={continuous}
            actuators={actuators}
            yScale={yScale}
            viewStart={viewStart}
            viewEnd={viewEnd}
            markerT={markerT}
            onMark={setMarkerT}
            onZoom={(anchorT, factor) => applyViewportZoom(anchorT, factor)}
          />
        </div>
        {effectiveEvents.length > 0 ? (
          <ChartOverviewScrubber
            dataMinT={dataSpan.minT}
            dataMaxT={dataSpan.maxT}
            viewStart={viewStart}
            viewEnd={viewEnd}
            panClamped={panClamped}
            windowMs={windowMs}
            onSeekFraction={applyOverviewPan}
            onMoveWindowStart={applyOverviewWindowStart}
            onResizeEdge={applyOverviewResize}
            onZoomAt={(frac, factor) => {
              const span = Math.max(1, dataSpan.maxT - dataSpan.minT);
              applyViewportZoom(dataSpan.minT + frac * span, factor);
            }}
            onLive={() => setPanOffsetMs(0)}
          />
        ) : null}
        <div className="lab-chart-legend">
          {continuous.map((series) => (
            <button
              key={series.id}
              type="button"
              className="lab-chart-legend-chip"
              title={`${series.label}${series.unit ? ` (${series.unit})` : ""} · ${series.code}`}
              onClick={() => {
                const { name, module } = parseSeriesKey(series.id);
                if (name === "pumpPower" && module && DRINKX_HOSTS.includes(module as DrinkxHost)) {
                  toggleHostSet(setShowPumpPower, module as DrinkxHost);
                } else if (name.endsWith("_pwm")) {
                  toggleSet(setHeaterPwmOn, series.id);
                } else {
                  toggleSensor(series.id);
                }
              }}
            >
              <i style={{ background: series.color }} />
              {compactSeriesLabel(series.label, series.code)}
            </button>
          ))}
          {actuators.map((series) => (
            <span
              key={series.id}
              className="lab-chart-legend-chip is-actuator"
              title={series.label}
            >
              <i style={{ background: series.color }} />
              {laneLabel(series.label)}
            </span>
          ))}
        </div>
      </div>

      {markerT != null && sliceOpen ? (
        <div className="lab-chart-slice-board">
          <div className="lab-chart-slice-board-head">
            <h3 style={{ margin: 0, fontSize: "0.95rem" }}>
              Срез · {new Date(markerT).toLocaleTimeString()}
            </h3>
            <span className="muted" style={{ fontSize: "0.8rem" }}>
              ↑↓ меняют порядок · клик не трогает график
            </span>
          </div>
          <div className="lab-chart-slice-scroll">
            <div className="lab-chart-slice-grid">
              {(() => {
                const milk = orderedRows("milk");
                const mid = Math.ceil(milk.length / 2);
                const columns: Array<[string, DrinkxHost, LabSnapshotRow[]]> = [
                  ["milk", "milk", milk.slice(0, mid)],
                  ["milk", "milk", milk.slice(mid)],
                  ["coffee", "coffee", orderedRows("coffee")],
                  ["water", "water", orderedRows("water")],
                ];
                return columns.map(([title, mod, rows], index) => (
                  <div key={`${title}-${index}`} className="lab-chart-slice-col">
                    <div className="lab-chart-side-title">{title}</div>
                    {rows.length > 0 ? (
                      rows.map((row) => renderSliceRow(mod, row))
                    ) : (
                      <p className="muted" style={{ margin: 0, fontSize: "0.8rem" }}>
                        нет данных
                      </p>
                    )}
                  </div>
                ));
              })()}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function sampleAt(
  points: Array<{ t: number; v: number | null }>,
  t: number,
  mode: "linear" | "step"
): number | null {
  if (points.length === 0) return null;
  const first = points[0]!;
  if (t <= first.t) return first.v;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (t > b.t) continue;
    if (mode === "step") return a.v;
    if (a.v == null || b.v == null) return null;
    const span = b.t - a.t || 1;
    return a.v + ((b.v - a.v) * (t - a.t)) / span;
  }
  const last = points[points.length - 1]!;
  // Continuous: не экстраполируем last-known за конец ряда (gap при NATS loss).
  // Step (actuators): держат ступеньку до now через finalizeActuatorPoints.
  if (t > last.t) return mode === "step" ? last.v : null;
  return last.v;
}

type HoverTip = {
  x: number;
  y: number;
  label: string;
  value: string;
  detail?: string;
  color: string;
};

/** Overview track: full history with in/out brackets for the visible window. */
function ChartOverviewScrubber({
  dataMinT,
  dataMaxT,
  viewStart,
  viewEnd,
  panClamped,
  windowMs,
  onSeekFraction,
  onMoveWindowStart,
  onResizeEdge,
  onZoomAt,
  onLive,
}: {
  dataMinT: number;
  dataMaxT: number;
  viewStart: number;
  viewEnd: number;
  panClamped: number;
  windowMs: number | null;
  onSeekFraction: (fraction: number) => void;
  onMoveWindowStart: (viewStartMs: number) => void;
  onResizeEdge: (edge: "in" | "out", fraction: number) => void;
  onZoomAt: (fraction: number, factor: number) => void;
  onLive: () => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<null | {
    mode: "pan" | "in" | "out";
    originFrac: number;
    originViewStart: number;
  }>(null);

  const span = Math.max(1, dataMaxT - dataMinT);
  const leftPct = Math.min(
    100,
    Math.max(0, ((viewStart - dataMinT) / span) * 100)
  );
  const rightPct = Math.min(
    100,
    Math.max(0, ((viewEnd - dataMinT) / span) * 100)
  );
  const widthPct = Math.max(0.4, rightPct - leftPct);

  function fractionFromClientX(clientX: number): number {
    const el = trackRef.current;
    if (!el) return 0.5;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return 0.5;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const frac = fractionFromClientX(event.clientX);
      if (drag.mode === "pan") {
        const deltaMs = (frac - drag.originFrac) * span;
        onMoveWindowStart(drag.originViewStart + deltaMs);
      } else {
        onResizeEdge(drag.mode, frac);
      }
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [onMoveWindowStart, onResizeEdge, span]);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const frac = fractionFromClientX(event.clientX);
      if (event.shiftKey) {
        const deltaMs = (event.deltaY > 0 ? 0.05 : -0.05) * span;
        onMoveWindowStart(viewStart + deltaMs);
        return;
      }
      const factor = event.deltaY > 0 ? 1.18 : 1 / 1.18;
      onZoomAt(frac, factor);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [onMoveWindowStart, onZoomAt, span, viewStart]);

  return (
    <div className="lab-chart-time-scroll">
      <span className="muted" style={{ fontSize: "0.75rem", flex: "0 0 auto" }}>
        история
      </span>
      <div
        ref={trackRef}
        className="lab-chart-overview"
        title="Перетащите скобки окна · колесо — зум · Shift+колесо — панорама"
        onMouseDown={(event) => {
          if (event.button !== 0) return;
          const frac = fractionFromClientX(event.clientX);
          const inView =
            frac >= leftPct / 100 - 0.012 && frac <= rightPct / 100 + 0.012;
          if (!inView && windowMs != null) {
            onSeekFraction(frac);
            return;
          }
          dragRef.current = {
            mode: "pan",
            originFrac: frac,
            originViewStart: viewStart,
          };
        }}
      >
        <div className="lab-chart-overview-track" />
        <div
          className="lab-chart-overview-window"
          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
        >
          <button
            type="button"
            className="lab-chart-overview-handle is-in"
            aria-label="Начало окна"
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              dragRef.current = {
                mode: "in",
                originFrac: fractionFromClientX(event.clientX),
                originViewStart: viewStart,
              };
            }}
          />
          <button
            type="button"
            className="lab-chart-overview-handle is-out"
            aria-label="Конец окна"
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              dragRef.current = {
                mode: "out",
                originFrac: fractionFromClientX(event.clientX),
                originViewStart: viewStart,
              };
            }}
          />
        </div>
      </div>
      <span className="muted" style={{ fontSize: "0.75rem", flex: "0 0 auto" }}>
        сейчас
      </span>
      <button
        type="button"
        className="btn btn-compact"
        disabled={panClamped === 0}
        onClick={onLive}
      >
        к живому
      </button>
      <span className="muted" style={{ fontSize: "0.72rem" }}>
        {new Date(viewStart).toLocaleTimeString("ru-RU")} –{" "}
        {new Date(viewEnd).toLocaleTimeString("ru-RU")}
        {windowMs != null ? ` · ${formatWindowDurationLabel(windowMs)}` : ""}
      </span>
    </div>
  );
}

function MultiChart({
  continuous,
  actuators,
  yScale,
  viewStart,
  viewEnd,
  markerT,
  onMark,
  onZoom,
}: {
  continuous: ContinuousSeries[];
  actuators: ActuatorSeries[];
  yScale: YScale;
  viewStart: number;
  viewEnd: number;
  markerT: number | null;
  onMark: (t: number) => void;
  onZoom?: (anchorT: number, factor: number) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const clipId = useId().replace(/:/g, "");
  const [box, setBox] = useState({ w: 1100, h: 420 });
  const [hover, setHover] = useState<HoverTip | null>(null);
  const [tipBox, setTipBox] = useState<{ left: number; top: number } | null>(
    null
  );

  /** Keep tip near (sx, sy), prefer above-right, flip at plot edges. */
  useLayoutEffect(() => {
    if (!hover) {
      setTipBox(null);
      return;
    }
    const wrap = wrapRef.current;
    const tip = tipRef.current;
    if (!wrap || !tip) return;
    const svg = wrap.querySelector("svg.lab-spark") as SVGSVGElement | null;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return;

    const pt = svg.createSVGPoint();
    pt.x = hover.x;
    pt.y = hover.y;
    const screen = pt.matrixTransform(ctm);
    const wrapRect = wrap.getBoundingClientRect();
    const px = screen.x - wrapRect.left + wrap.scrollLeft;
    const py = screen.y - wrapRect.top + wrap.scrollTop;

    const tipW = tip.offsetWidth;
    const tipH = tip.offsetHeight;
    const gap = 12;
    const edge = 6;
    const cw = wrap.clientWidth;
    const ch = wrap.clientHeight;

    const placeRight = px + gap + tipW <= cw - edge;
    const placeAbove = py - gap - tipH >= edge;
    let left = placeRight ? px + gap : px - gap - tipW;
    let top = placeAbove ? py - gap - tipH : py + gap;
    left = Math.max(edge, Math.min(left, cw - tipW - edge));
    top = Math.max(edge, Math.min(top, ch - tipH - edge));
    setTipBox({ left, top });
  }, [hover, box]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !onZoom) return;
    const onWheel = (event: WheelEvent) => {
      const svg = el.querySelector("svg.lab-spark") as SVGSVGElement | null;
      if (!svg) return;
      event.preventDefault();
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const pt = svg.createSVGPoint();
      pt.x = event.clientX;
      pt.y = event.clientY;
      const local = pt.matrixTransform(ctm.inverse());
      const padLWheel = Math.round(Math.min(150, Math.max(110, box.w * 0.1)));
      const plotWWheel = Math.max(80, box.w - padLWheel - 10);
      let anchorT = (viewStart + viewEnd) / 2;
      if (local.x >= padLWheel && local.x <= padLWheel + plotWWheel) {
        const span = Math.max(1, viewEnd - viewStart);
        anchorT = viewStart + ((local.x - padLWheel) / plotWWheel) * span;
      }
      const factor = event.deltaY > 0 ? 1.15 : 1 / 1.15;
      onZoom(anchorT, factor);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [box.w, onZoom, viewEnd, viewStart]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const apply = (width: number, height: number) => {
      setBox({
        w: Math.max(520, Math.floor(width)),
        h: Math.max(180, Math.floor(height)),
      });
    };
    apply(el.clientWidth, el.clientHeight);
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (!cr || cr.width < 2 || cr.height < 2) return;
      apply(cr.width, cr.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const w = box.w;
  const padL = Math.round(Math.min(150, Math.max(110, w * 0.1)));
  const padR = 10;
  const padT = 10;
  const stacked = yScale === "stack";
  const nCont = continuous.length;
  /** Ниже этого полосы нечитаемы — лучше скролл, чем сплющивание. */
  const bandMin = 38;

  const timeRow = 22;
  let laneH = 16;
  let laneGap = 3;
  let actuatorBand =
    actuators.length > 0 ? actuators.length * (laneH + laneGap) + 10 : 0;

  let plotH: number;
  let svgH: number;
  let bandH = bandMin;

  if (nCont === 0) {
    plotH = 32;
    svgH = box.h;
    const laneArea = Math.max(
      actuators.length * 20,
      svgH - padT - plotH - timeRow - 8
    );
    if (actuators.length > 0) {
      laneGap = 3;
      laneH = Math.max(
        14,
        Math.min(34, (laneArea - 8) / actuators.length - laneGap)
      );
      actuatorBand = actuators.length * (laneH + laneGap) + 8;
    }
  } else if (stacked) {
    actuatorBand =
      actuators.length > 0 ? actuators.length * (laneH + laneGap) + 10 : 0;
    const chrome = padT + timeRow + actuatorBand;
    const availPlot = Math.max(bandMin, box.h - chrome);
    bandH = Math.max(bandMin, Math.floor(availPlot / nCont));
    // Не раздувать полосы слишком высоко при малом числе рядов
    bandH = Math.min(bandH, 56);
    // Если в окно не влезает с bandMin — фиксируем min и скроллим
    if (nCont * bandMin > availPlot) {
      bandH = bandMin;
    }
    plotH = nCont * bandH;
    svgH = padT + plotH + actuatorBand + timeRow;
    if (svgH < box.h) {
      const grow = Math.floor((box.h - svgH) / nCont);
      if (grow > 0) {
        bandH = Math.min(56, bandH + grow);
        plotH = nCont * bandH;
        svgH = padT + plotH + actuatorBand + timeRow;
      }
      // Добираем высоту контейнера без сплющивания полос
      svgH = Math.max(svgH, box.h);
    }
  } else {
    // auto / norm / fixed — уместить весь график в видимую область
    actuatorBand =
      actuators.length > 0 ? actuators.length * (laneH + laneGap) + 10 : 0;
    let chrome = padT + timeRow + actuatorBand;
    const minPlot = yScale === "norm" || yScale === "auto" ? 140 : 120;
    if (chrome + minPlot > box.h && actuators.length > 0) {
      const budget = Math.max(60, box.h - padT - timeRow - minPlot - 8);
      laneH = Math.max(
        10,
        Math.min(18, Math.floor(budget / actuators.length) - laneGap)
      );
      actuatorBand = actuators.length * (laneH + laneGap) + 8;
      chrome = padT + timeRow + actuatorBand;
    }
    svgH = box.h;
    plotH = Math.max(minPlot, svgH - chrome);
  }

  const h = svgH;
  const plotW = Math.max(80, w - padL - padR);

  let tMin = viewStart;
  let tMax = viewEnd;
  if (tMax <= tMin) tMax = tMin + 1_000;

  let yMin = 0;
  let yMax = 1;
  const normalize = yScale === "norm";
  if (yScale === "0-5") yMax = 5;
  else if (yScale === "0-100" || normalize) yMax = 100;
  else if (yScale === "0-120") yMax = 120;
  else if (!stacked) {
    const domain = seriesYDomain(
      continuous.flatMap((series) => series.points)
    );
    yMin = domain.min;
    yMax = domain.max;
  }

  const xOf = (t: number) => padL + ((t - tMin) / (tMax - tMin)) * plotW;
  const yOf = (v: number) =>
    padT + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;
  const tOf = (x: number) => tMin + ((x - padL) / plotW) * (tMax - tMin);

  function seriesYMap(series: ContinuousSeries, index: number) {
    if (stacked) {
      const top = padT + index * bandH + 5;
      const bottom = padT + (index + 1) * bandH - 5;
      const range = seriesYDomain(series.points);
      return (v: number) =>
        bottom -
        ((v - range.min) / (range.max - range.min || 1)) * (bottom - top);
    }
    if (!normalize) return yOf;
    const range = seriesYDomain(series.points);
    return (v: number) =>
      padT + plotH - ((v - range.min) / (range.max - range.min || 1)) * plotH;
  }

  function pathFor(
    points: Array<{ t: number; v: number | null }>,
    yMap: (v: number) => number
  ) {
    return seriesPathD(points, xOf, yMap);
  }

  const hasData =
    continuous.some((series) => seriesHasDrawablePoints(series.points)) ||
    actuators.some((series) => series.points.length > 0);
  const strokeW =
    nCont > 10 ? 1.4 : nCont > 5 ? 1.8 : 2.2;
  const bandHStack = stacked ? bandH : plotH;

  function onMove(event: ReactMouseEvent<SVGSVGElement>) {
    const svg = event.currentTarget;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const pt = svg.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const local = pt.matrixTransform(ctm.inverse());
    const sx = local.x;
    const sy = local.y;
    if (sx < padL || sx > padL + plotW) {
      setHover(null);
      return;
    }
    const t = tOf(sx);
    let best: HoverTip | null = null;
    let bestDist = Number.POSITIVE_INFINITY;

    // Сначала полосы клапанов — попадание по ряду, не «ближайшая кривая»
    actuators.forEach((series, index) => {
      const top = padT + plotH + 6 + index * (laneH + laneGap);
      const midY = top + laneH / 2;
      const dist = Math.abs(midY - sy);
      if (dist > laneH * 0.55) return;
      if (dist >= bestDist) return;
      const v = sampleAt(series.points, t, "step");
      if (v == null) return;
      const edges = findBooleanSegmentEdges(series.points, t);
      const tip = edges
        ? formatBooleanSegmentTooltip(edges)
        : { state: v >= 0.5 ? "ON" : "OFF", detail: undefined };
      bestDist = dist;
      best = {
        x: sx,
        y: midY,
        label: series.label,
        value: tip.state,
        detail: tip.detail,
        color: series.color,
      };
    });

    if (best == null) {
      const contLimit = Math.max(14, bandHStack * 0.4);
      continuous.forEach((series, index) => {
        const v = sampleAt(series.points, t, "linear");
        if (!isFiniteSeriesValue(v)) return;
        const yMap = seriesYMap(series, index);
        const y = yMap(v);
        const dist = Math.abs(y - sy);
        if (dist > contLimit || dist >= bestDist) return;
        bestDist = dist;
        best = {
          x: sx,
          y,
          label: series.label,
          value: `${v.toFixed(3)}${series.unit ? ` ${series.unit}` : ""}`,
          color: series.color,
        };
      });
    }

    setHover(best);
  }

  return (
    <div
      ref={wrapRef}
      className="lab-chart-plot-inner"
      style={{ height: Math.max(box.h, h) }}
    >
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width="100%"
        height={h}
        preserveAspectRatio="xMidYMin meet"
        className="lab-spark lab-spark-lg lab-spark-interactive"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        onClick={(event) => {
          const svg = event.currentTarget;
          const ctm = svg.getScreenCTM();
          if (!ctm) return;
          const pt = svg.createSVGPoint();
          pt.x = event.clientX;
          pt.y = event.clientY;
          const local = pt.matrixTransform(ctm.inverse());
          if (local.x >= padL && local.x <= padL + plotW) onMark(tOf(local.x));
        }}
      >
        <defs>
          <clipPath id={`lab-plot-clip-${clipId}`}>
            <rect x={padL} y={padT} width={plotW} height={plotH} />
          </clipPath>
        </defs>
        <rect
          x={padL}
          y={padT}
          width={plotW}
          height={plotH}
          fill="rgba(0,0,0,0.2)"
          rx={4}
        />
        {stacked
          ? continuous.map((series, index) => {
              const top = padT + index * bandH;
              const labelY = top + Math.min(14, bandH * 0.55);
              return (
                <g key={`band-${series.id}`}>
                  <line
                    x1={padL}
                    x2={padL + plotW}
                    y1={top}
                    y2={top}
                    stroke="rgba(255,255,255,0.1)"
                  />
                  <text
                    x={6}
                    y={labelY}
                    fill={series.color}
                    fontSize={bandH < 34 ? 9 : 10}
                  >
                    {compactSeriesLabel(series.label, series.code)}
                  </text>
                </g>
              );
            })
          : Array.from({ length: 5 }, (_, index) => {
              const y = padT + (plotH * index) / 4;
              return (
                <line
                  key={`hg-${index}`}
                  x1={padL}
                  x2={padL + plotW}
                  y1={y}
                  y2={y}
                  stroke="rgba(255,255,255,0.08)"
                />
              );
            })}
        {Array.from({ length: 9 }, (_, index) => {
          const x = padL + (plotW * index) / 8;
          return (
            <line
              key={`vg-${index}`}
              x1={x}
              x2={x}
              y1={padT}
              y2={padT + plotH}
              stroke="rgba(255,255,255,0.06)"
            />
          );
        })}
        {!stacked ? (
          <>
            <text x={6} y={padT + 10} fill="var(--text-muted)" fontSize="11">
              {normalize ? "100%" : yMax.toFixed(2)}
            </text>
            <text x={6} y={padT + plotH} fill="var(--text-muted)" fontSize="11">
              {normalize ? "0%" : yMin.toFixed(2)}
            </text>
          </>
        ) : null}
        {!hasData ? (
          <text
            x={w / 2}
            y={padT + plotH / 2}
            textAnchor="middle"
            fill="var(--text-muted)"
            fontSize="14"
          >
            Нет точек в выбранном окне
          </text>
        ) : null}
        <g clipPath={`url(#lab-plot-clip-${clipId})`}>
          {continuous.map((series, index) => (
            <path
              key={series.id}
              d={pathFor(series.points, seriesYMap(series, index))}
              fill="none"
              stroke={series.color}
              strokeWidth={strokeW}
              opacity={nCont > 12 ? 0.85 : 1}
            />
          ))}
        </g>
        {actuators.map((series, index) => {
          const top = padT + plotH + 6 + index * (laneH + laneGap);
          const yHi = top + 1;
          const yLo = top + laneH - 1;
          const fills: string[] = [];
          for (let i = 0; i < series.points.length - 1; i++) {
            const p0 = series.points[i]!;
            const p1 = series.points[i + 1]!;
            if (p0.v >= 0.5) {
              fills.push(
                `M${xOf(p0.t).toFixed(1)},${yLo} L${xOf(p0.t).toFixed(1)},${yHi} ` +
                  `L${xOf(p1.t).toFixed(1)},${yHi} L${xOf(p1.t).toFixed(1)},${yLo} Z`
              );
            }
          }
          return (
            <g key={series.id}>
              <text
                x={4}
                y={top + laneH - 3}
                fill="var(--text-muted)"
                fontSize="10"
              >
                {laneLabel(series.label)}
              </text>
              <rect
                x={padL}
                y={top}
                width={plotW}
                height={laneH}
                fill="rgba(255,255,255,0.04)"
                rx={2}
              />
              {fills.map((d, fillIndex) => (
                <path
                  key={fillIndex}
                  d={d}
                  fill={series.color}
                  fillOpacity={0.55}
                  stroke="none"
                />
              ))}
            </g>
          );
        })}
        {markerT != null && markerT >= tMin && markerT <= tMax ? (
          <line
            className="lab-chart-marker"
            x1={xOf(markerT)}
            x2={xOf(markerT)}
            y1={padT}
            y2={h - 20}
            stroke="var(--accent)"
            strokeWidth="1.5"
            strokeDasharray="4 3"
          />
        ) : null}
        {hover ? (
          <>
            <line
              x1={hover.x}
              x2={hover.x}
              y1={padT}
              y2={h - 20}
              stroke={hover.color}
              strokeWidth="1"
              strokeOpacity={0.45}
            />
            <circle
              cx={hover.x}
              cy={hover.y}
              r={4}
              fill={hover.color}
              stroke="#0f1419"
              strokeWidth="1.5"
            />
          </>
        ) : null}
        <text x={padL} y={h - 6} fill="var(--text-muted)" fontSize="10">
          {new Date(tMin).toLocaleTimeString()}
        </text>
        <text
          x={w - padR}
          y={h - 6}
          textAnchor="end"
          fill="var(--text-muted)"
          fontSize="10"
        >
          {new Date(tMax).toLocaleTimeString()}
        </text>
      </svg>
      {hover ? (
        <div
          ref={tipRef}
          className="lab-chart-hover-tip"
          style={{
            left: tipBox?.left ?? 0,
            top: tipBox?.top ?? 0,
            borderColor: hover.color,
            opacity: tipBox ? 1 : 0,
          }}
        >
          <strong style={{ color: hover.color }}>{hover.label}</strong>
          <span>{hover.value}</span>
          {hover.detail ? (
            <span className="lab-chart-hover-tip-detail">{hover.detail}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
