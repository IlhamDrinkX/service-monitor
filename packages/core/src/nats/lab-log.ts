/**
 * Журнал лабораторных событий Modules Lab (клапаны / датчики / насос).
 */

export type LabEventKind =
  | "valve"
  | "pump"
  | "heater"
  | "sensor"
  | "command"
  | "system"
  | "flush"
  | "foam";

export type LabEvent = {
  at: string;
  kind: LabEventKind;
  module: string;
  hwid: string;
  name: string;
  value: string | number | boolean | null;
  detail?: string;
};

export function createLabEvent(
  partial: Omit<LabEvent, "at"> & { at?: string }
): LabEvent {
  return {
    at: partial.at ?? new Date().toISOString(),
    kind: partial.kind,
    module: partial.module,
    hwid: partial.hwid,
    name: partial.name,
    value: partial.value,
    detail: partial.detail,
  };
}

/**
 * Ring-buffer cap for Modules Lab event log / chart IPC sync.
 *
 * Was 30_000 (~15–30 min): ~17 critical channels @ ~1.2s heartbeat ≈ 14 evt/s
 * → 30k ≈ 30 min. Target ≥12h: 12×3600×14 ≈ 605k; margin for delta bursts /
 * tracked temps / actuators → 750_000 (~15h at that rate).
 *
 * With dual poll 800/800 (~25–35 evt/s) the old chart IPC cap of 30k filled in
 * ~15 min — see LAB_EVENTS_CHART_SYNC_MAX / mergeLabChartSyncEvents.
 *
 * Memory: ~200–450 MB per in-memory copy of a full buffer (React state; plus
 * chart-window sync when open). Export CSV and clear log if RAM is tight.
 * Override via trimLabEvents(..., customMax) if needed.
 */
export const LAB_EVENTS_MAX = 750_000;

/**
 * IPC payload cap for the chart window (≠ ring buffer).
 *
 * Dual-poll complex-wide (~25–35 evt/s): 60k ≈ 30–40 min of multi-channel
 * telemetry per sync slice. Chart window merges slices locally up to
 * LAB_EVENTS_CHART_WINDOW_MAX so live writing continues past one sync window
 * without cloning the full 12h ring across Electron IPC.
 */
export const LAB_EVENTS_CHART_SYNC_MAX = 60_000;

/**
 * Local ring in the chart window after merging successive IPC sync slices.
 * ~250k ≈ 2h @ ~35 evt/s (or ~5h @ ~14 evt/s) without pulling LAB_EVENTS_MAX.
 */
export const LAB_EVENTS_CHART_WINDOW_MAX = 250_000;

/** Prefer recent actuators when trimming for chart sync (sparse vs sensors). */
export const LAB_EVENTS_SYNC_ACTUATOR_RESERVE = 8_000;

/** Keep the newest `max` events (ring buffer). */
export function trimLabEvents<T>(
  events: readonly T[],
  max: number = LAB_EVENTS_MAX
): T[] {
  if (max <= 0) return [];
  return events.length > max ? events.slice(-max) : [...events];
}

function isActuatorLabEvent(e: LabEvent): boolean {
  return e.kind === "valve" || e.kind === "pump" || e.kind === "heater";
}

/**
 * Chart IPC sync trim: keep recent valve/pump/heater events, fill the rest
 * with non-actuators, then re-sort by time so overlays stay usable.
 * Defaults to LAB_EVENTS_CHART_SYNC_MAX (not the 12h ring) so the window
 * stays responsive with live sensor curves.
 *
 * Scans only a tail when the ring is huge so sync stays O(syncMax), not O(12h).
 */
export function trimLabEventsForChartSync(
  events: readonly LabEvent[],
  max: number = LAB_EVENTS_CHART_SYNC_MAX,
  actuatorReserve: number = LAB_EVENTS_SYNC_ACTUATOR_RESERVE
): LabEvent[] {
  if (max <= 0) return [];
  const reserve = Math.max(0, Math.min(actuatorReserve, max));
  // Tail large enough to fill sensor budget + actuator reserve (actuators sparse).
  const scanFrom =
    events.length > max * 3 ? Math.max(0, events.length - max * 3) : 0;
  const scan = scanFrom > 0 ? events.slice(scanFrom) : events;
  const actuators = scan.filter(isActuatorLabEvent);
  const rest = scan.filter((e) => !isActuatorLabEvent(e));
  const keepAct = actuators.slice(-reserve);
  const keepRest = rest.slice(-(max - keepAct.length));
  return [...keepAct, ...keepRest].sort(
    (a, b) => Date.parse(a.at) - Date.parse(b.at)
  );
}

/**
 * Merge a sliding IPC sync slice into the chart window's local ring.
 * Appends events strictly newer than the previous newest timestamp so live
 * writing continues after the sync cap (~15–40 min) without re-sending 12h.
 */
export function mergeLabChartSyncEvents(
  prev: readonly LabEvent[],
  incoming: readonly LabEvent[],
  max: number = LAB_EVENTS_CHART_WINDOW_MAX
): LabEvent[] {
  if (incoming.length === 0) {
    // Empty sync = cleared log / empty payload — drop local accumulation.
    return [];
  }
  if (prev.length === 0) {
    return trimLabEvents([...incoming], max);
  }
  // Modules «Очистить лог» while chart stays open: main ring is tiny again.
  if (prev.length > 1_000 && incoming.length <= 8) {
    return trimLabEvents([...incoming], max);
  }
  const prevLastAt = Date.parse(prev[prev.length - 1]!.at);
  if (!Number.isFinite(prevLastAt)) {
    return trimLabEvents([...incoming], max);
  }
  const newer = incoming.filter((e) => {
    const t = Date.parse(e.at);
    return Number.isFinite(t) && t > prevLastAt;
  });
  if (newer.length === 0) {
    return trimLabEvents(prev as LabEvent[], max);
  }
  return trimLabEvents([...prev, ...newer], max);
}

/** Newest finite `Date.parse(e.at)` without `Math.max(...arr)` (stack-safe for 250k). */
export function maxLabEventAtMs(
  events: ReadonlyArray<{ at: string }>
): number | null {
  let max = Number.NEGATIVE_INFINITY;
  for (const e of events) {
    const t = Date.parse(e.at);
    if (Number.isFinite(t) && t > max) max = t;
  }
  return Number.isFinite(max) ? max : null;
}

/** `milk.input` — ключ ряда для комплексных графиков. */
export function seriesKey(module: string, name: string): string {
  return `${module}.${name}`;
}

export function parseSeriesKey(key: string): { module: string; name: string } {
  const i = key.indexOf(".");
  if (i <= 0) return { module: "", name: key };
  return { module: key.slice(0, i), name: key.slice(i + 1) };
}

function eventMatchesSeries(
  e: LabEvent,
  key: string,
  kind?: LabEventKind
): boolean {
  if (kind && e.kind !== kind) return false;
  if (e.name === key) return true;
  const { module, name } = parseSeriesKey(key);
  if (!module) return e.name === name;
  return e.module === module && e.name === name;
}

export function formatLabTerminalLine(e: LabEvent): string {
  const t = e.at.slice(11, 23);
  const val =
    e.value === null || e.value === undefined ? "—" : String(e.value);
  const extra = e.detail ? ` · ${e.detail}` : "";
  return `[${t}] ${e.module}/${e.kind} ${e.name}=${val}${extra}`;
}

export function labEventsToCsv(events: LabEvent[]): string {
  const header = "at,kind,module,hwid,name,value,detail";
  const rows = events.map((e) =>
    [
      e.at,
      e.kind,
      e.module,
      e.hwid,
      csvEscape(e.name),
      csvEscape(e.value === null || e.value === undefined ? "" : String(e.value)),
      csvEscape(e.detail ?? ""),
    ].join(",")
  );
  return [header, ...rows].join("\n");
}

function csvEscape(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Точка ряда: `v: null` = разрыв (потеря связи / stale), линия не рисуется. */
export type SeriesPoint = { t: number; v: number | null };

/**
 * Короткий hold последней величины до until (редкий heartbeat).
 * Дольше — разрыв, без «плоской» полки last-known при NATS/DX loss.
 * Согласовано с STALE_MS.actuators (~8s).
 */
export const SENSOR_SERIES_HOLD_MS = 8_000;

/** DX UI (:8000) токи; остальное — NATS/status. */
export function isDxSensorLocalName(localName: string): boolean {
  return localName === "pumpCurrent" || localName === "pumpCurrentL";
}

export function isFiniteSeriesValue(
  v: number | null | undefined
): v is number {
  return v != null && Number.isFinite(v);
}

/** Y-domain from finite samples only (all-null → fallback). */
export function seriesYDomain(
  points: ReadonlyArray<{ v: number | null | undefined }>,
  fallback: { min: number; max: number } = { min: 0, max: 1 }
): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    if (!isFiniteSeriesValue(p.v)) continue;
    if (p.v < min) min = p.v;
    if (p.v > max) max = p.v;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { ...fallback };
  }
  if (max === min) {
    min -= 1;
    max += 1;
  }
  const pad = (max - min) * 0.08;
  return { min: min - pad, max: max + pad };
}

/**
 * SVG path for a series: null/non-finite breaks the segment (new M after gap).
 * Does not coerce null → 0.
 */
export function seriesPathD(
  points: ReadonlyArray<SeriesPoint>,
  xOf: (t: number) => number,
  yOf: (v: number) => number
): string {
  let d = "";
  let drawing = false;
  for (const point of points) {
    if (!isFiniteSeriesValue(point.v)) {
      drawing = false;
      continue;
    }
    const cmd = drawing ? "L" : "M";
    d += `${cmd}${xOf(point.t).toFixed(1)},${yOf(point.v).toFixed(1)}`;
    drawing = true;
  }
  return d;
}

/** True if at least one drawable (finite) sample exists. */
export function seriesHasDrawablePoints(
  points: ReadonlyArray<{ v: number | null | undefined }>
): boolean {
  return points.some((p) => isFiniteSeriesValue(p.v));
}

/** Trim to `limit`, but never drop the last finite sample if the tail is all gaps. */
function sliceSeriesPreservingFinite(
  pts: SeriesPoint[],
  limit: number
): SeriesPoint[] {
  if (pts.length <= limit) return pts;
  const sliced = pts.slice(-limit);
  if (seriesHasDrawablePoints(sliced)) return sliced;
  let lastFinite = -1;
  for (let i = pts.length - 1; i >= 0; i--) {
    if (isFiniteSeriesValue(pts[i]!.v)) {
      lastFinite = i;
      break;
    }
  }
  if (lastFinite < 0) return sliced;
  const from = Math.max(0, lastFinite - Math.floor(limit / 2));
  return pts.slice(from, from + limit);
}

/**
 * Достроить конец ряда до until: короткий hold, иначе gap (null).
 * Не тянем last-known бесконечно — иначе при обрыве NATS кривая «залипает».
 */
export function extendSeriesEnd(
  pts: SeriesPoint[],
  until: number,
  holdMs = SENSOR_SERIES_HOLD_MS
): SeriesPoint[] {
  if (pts.length === 0) return pts;
  const last = pts[pts.length - 1]!;
  if (last.t >= until) return pts;
  if (last.v == null) {
    if (last.t < until) pts.push({ t: until, v: null });
    return pts;
  }
  const holdUntil = Math.min(until, last.t + holdMs);
  if (holdUntil > last.t) {
    pts.push({ t: holdUntil, v: last.v });
  }
  if (holdUntil < until) {
    // Gap after hold: one null at hold end (path break) + null at until.
    // Avoid duplicate finite+null only when hold point was not added (holdUntil===last.t).
    const gapStart = pts[pts.length - 1]!;
    if (gapStart.v != null || gapStart.t < holdUntil) {
      pts.push({ t: holdUntil, v: null });
    }
    pts.push({ t: until, v: null });
  }
  return pts;
}

/**
 * Точки датчика: key = `milk.input` или короткое `input`.
 * Учитывает значение до окна since (baseline) и короткий hold до untilMs.
 * `value: null` в событии → разрыв кривой (потеря телеметрии).
 */
export function sensorSeries(
  events: LabEvent[],
  sensorName: string,
  limit = 2000,
  sinceMs?: number | null,
  untilMs?: number | null,
  holdMs = SENSOR_SERIES_HOLD_MS
): SeriesPoint[] {
  const matching: SeriesPoint[] = [];
  for (const e of events) {
    if (!eventMatchesSeries(e, sensorName, "sensor")) continue;
    const t = Date.parse(e.at);
    if (!Number.isFinite(t)) continue;
    if (e.value === null || e.value === undefined) {
      matching.push({ t, v: null });
      continue;
    }
    const n = typeof e.value === "number" ? e.value : Number(e.value);
    if (!Number.isFinite(n)) continue;
    matching.push({ t, v: n });
  }
  if (matching.length === 0) return [];

  const since = sinceMs ?? null;
  const until = untilMs ?? null;
  let baseline: SeriesPoint | null = null;
  const inWindow: SeriesPoint[] = [];
  for (const p of matching) {
    if (since != null && p.t < since) {
      baseline = p;
      continue;
    }
    if (until != null && p.t > until) continue;
    inWindow.push(p);
  }

  const pts: SeriesPoint[] = [];
  if (baseline != null && since != null) {
    pts.push({ t: since, v: baseline.v });
  }
  let prevNull = pts.length > 0 && pts[pts.length - 1]!.v == null;
  for (const p of inWindow) {
    // Collapse consecutive null gap heartbeats — keep the first & allow path break.
    if (p.v == null) {
      if (prevNull) continue;
      prevNull = true;
      pts.push(p);
      continue;
    }
    prevNull = false;
    pts.push(p);
  }
  if (pts.length === 0) return [];

  if (until != null) {
    extendSeriesEnd(pts, until, holdMs);
  }
  return sliceSeriesPreservingFinite(pts, limit);
}

/** Окно времени для масштаба графика. */
export type ChartTimeScale = "1m" | "5m" | "15m" | "all";

export function chartSinceMs(
  scale: ChartTimeScale,
  now = Date.now()
): number | null {
  if (scale === "all") return null;
  const map: Record<Exclude<ChartTimeScale, "all">, number> = {
    "1m": 60_000,
    "5m": 300_000,
    "15m": 900_000,
  };
  return now - map[scale];
}

/**
 * Step-series для клапанов / насоса / ТЭНов.
 * `name` может быть `drain` или `milk.drain`.
 * Учитывает состояние до окна since (иначе «ON до зума» пропадает) и тянет
 * последнюю ступеньку до now (иначе одна точка невидима).
 */
export function booleanStepSeries(
  events: LabEvent[],
  kind: LabEventKind,
  name: string,
  sinceMs?: number | null,
  limit = 2000,
  nowMs = Date.now()
): Array<{ t: number; v: number }> {
  const matching: Array<{ t: number; v: number }> = [];
  for (const e of events) {
    if (!eventMatchesSeries(e, name, kind)) continue;
    let bit: number | null = null;
    if (e.value === true || e.value === 1 || e.value === "1") bit = 1;
    else if (e.value === false || e.value === 0 || e.value === "0") bit = 0;
    if (bit == null) continue;
    const t = Date.parse(e.at);
    if (!Number.isFinite(t)) continue;
    matching.push({ t, v: bit });
  }
  if (matching.length === 0) return [];

  const since = sinceMs ?? null;
  let baseline: { t: number; v: number } | null = null;
  const inWindow: Array<{ t: number; v: number }> = [];
  for (const p of matching) {
    if (since != null && p.t < since) {
      baseline = p;
      continue;
    }
    inWindow.push(p);
  }

  const raw: Array<{ t: number; v: number }> = [];
  if (baseline != null && since != null) {
    raw.push({ t: since, v: baseline.v });
  }
  for (const p of inWindow) raw.push(p);
  if (raw.length === 0) return [];

  const stepped: Array<{ t: number; v: number }> = [
    { t: raw[0]!.t, v: raw[0]!.v },
  ];
  for (let i = 1; i < raw.length; i++) {
    const prev = raw[i - 1]!;
    const cur = raw[i]!;
    if (prev.v !== cur.v) {
      stepped.push({ t: cur.t, v: prev.v });
    }
    stepped.push(cur);
  }
  const last = stepped[stepped.length - 1]!;
  if (nowMs > last.t) {
    stepped.push({ t: nowMs, v: last.v });
  }
  return stepped.slice(-limit);
}

/** Мощность насоса %; `module` опционально фильтрует. */
export function pumpPowerSeries(
  events: LabEvent[],
  sinceMs?: number | null,
  limit = 2000,
  module?: string | null,
  untilMs?: number | null,
  holdMs = SENSOR_SERIES_HOLD_MS
): SeriesPoint[] {
  const matching: SeriesPoint[] = [];
  const since = sinceMs ?? null;
  const until = untilMs ?? null;
  let baseline: SeriesPoint | null = null;
  for (const e of events) {
    if (e.kind !== "pump" || e.name !== "pump") continue;
    if (module && e.module !== module) continue;
    const t = Date.parse(e.at);
    if (!Number.isFinite(t)) continue;
    let power: number | null = null;
    if (e.value === false || e.value === 0) {
      power = 0;
    } else if (typeof e.value === "number" && Number.isFinite(e.value)) {
      power = e.value;
    } else if (typeof e.detail === "string") {
      const m = e.detail.match(/power%=(\d+(?:\.\d+)?)/i);
      if (m) power = Number(m[1]);
    }
    if (power == null || !Number.isFinite(power)) continue;
    if (since != null && t < since) {
      baseline = { t, v: power };
      continue;
    }
    if (until != null && t > until) continue;
    matching.push({ t, v: power });
  }
  const pts: SeriesPoint[] = [];
  if (baseline != null && since != null) {
    pts.push({ t: since, v: baseline.v });
  }
  for (const p of matching) pts.push(p);
  if (pts.length === 0) return [];
  const stepped: SeriesPoint[] = [{ t: pts[0]!.t, v: pts[0]!.v }];
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1]!;
    const cur = pts[i]!;
    stepped.push({ t: cur.t, v: prev.v });
    stepped.push(cur);
  }
  if (until != null) {
    extendSeriesEnd(stepped, until, holdMs);
  }
  return sliceSeriesPreservingFinite(stepped, limit);
}

export type ChartSeriesMeta = {
  label: string;
  code: string;
  unit: string;
  module?: string;
};

function localSeriesMeta(localName: string): ChartSeriesMeta {
  const TEMP: Record<string, ChartSeriesMeta> = {
    input: { label: "Input", code: "input", unit: "°C" },
    heater1_out: { label: "Heater 1 out", code: "heater1_out", unit: "°C" },
    heater2_out: { label: "Heater 2 out", code: "heater2_out", unit: "°C" },
    heater1_overheat: {
      label: "Heater 1 overheat",
      code: "heater1_overheat",
      unit: "°C",
    },
    heater2_overheat: {
      label: "Heater 2 overheat",
      code: "heater2_overheat",
      unit: "°C",
    },
  };
  if (TEMP[localName]) return TEMP[localName]!;
  if (localName === "waterPressure") {
    return { label: "Давление воды", code: "water_pressure", unit: "bar" };
  }
  if (localName === "waterTotalPulses") {
    return { label: "Total pulses", code: "total_pulses", unit: "ticks" };
  }
  if (localName === "pumpPower") {
    return { label: "Мощность насоса", code: "pump.power", unit: "%" };
  }
  if (localName === "pumpCurrent") {
    return { label: "Насос R_IS", code: "pump_R_IS", unit: "V" };
  }
  if (localName === "pumpCurrentL") {
    return { label: "Насос L_IS", code: "pump_L_IS", unit: "V" };
  }
  if (localName === "heater1_pwm") {
    return { label: "Тэн 1 ШИМ", code: "heater1.pwm", unit: "%" };
  }
  if (localName === "heater2_pwm") {
    return { label: "Тэн 2 ШИМ", code: "heater2.pwm", unit: "%" };
  }
  return { label: localName, code: localName, unit: "" };
}

/** Метаданные ряда; `name` может быть `milk.input`. */
export function chartSeriesMeta(name: string): ChartSeriesMeta {
  const { module, name: local } = parseSeriesKey(name);
  const base = localSeriesMeta(local || name);
  if (!module) return base;
  return {
    ...base,
    module,
    label: `${module} · ${base.label}`,
    code: `${module}.${base.code}`,
  };
}

export type LabSnapshotRow = {
  key: string;
  kind: LabEventKind;
  module: string;
  name: string;
  label: string;
  code: string;
  unit: string;
  value: string | number | boolean | null;
  at: string | null;
};

/**
 * Срез состояния комплекса в момент tMs (последние значения ≤ t).
 */
export function snapshotAt(
  events: LabEvent[],
  tMs: number
): LabSnapshotRow[] {
  const best = new Map<
    string,
    { e: LabEvent; key: string; kind: LabEventKind }
  >();

  for (const e of events) {
    const t = Date.parse(e.at);
    if (!Number.isFinite(t) || t > tMs) continue;

    if (e.kind === "sensor") {
      const key = seriesKey(e.module, e.name);
      const prev = best.get(`sensor:${key}`);
      if (!prev || Date.parse(prev.e.at) <= t) {
        best.set(`sensor:${key}`, { e, key, kind: "sensor" });
      }
      continue;
    }

    if (e.kind === "valve" || e.kind === "heater") {
      if (
        e.value !== true &&
        e.value !== false &&
        e.value !== 0 &&
        e.value !== 1
      ) {
        continue;
      }
      const key = seriesKey(e.module, e.name);
      const mapKey = `${e.kind}:${key}`;
      const prev = best.get(mapKey);
      if (!prev || Date.parse(prev.e.at) <= t) {
        best.set(mapKey, {
          e: {
            ...e,
            value: e.value === true || e.value === 1,
          },
          key,
          kind: e.kind,
        });
      }
      continue;
    }

    if (e.kind === "pump" && e.name === "pump") {
      const key = seriesKey(e.module, "pump");
      const prev = best.get(`pump:${key}`);
      if (!prev || Date.parse(prev.e.at) <= t) {
        best.set(`pump:${key}`, { e, key, kind: "pump" });
      }
    }
  }

  const rows: LabSnapshotRow[] = [];
  for (const { e, key, kind } of best.values()) {
    const meta = chartSeriesMeta(
      kind === "sensor" ? key : seriesKey(e.module, e.name)
    );
    let value: string | number | boolean | null = e.value;
    if (kind === "pump") {
      if (e.value === true || e.value === false) {
        value = e.value;
      }
      if (typeof e.detail === "string") {
        const m = e.detail.match(/power%=(\d+(?:\.\d+)?)/i);
        if (m && e.value === true) {
          value = `ON · ${m[1]}%`;
        } else if (e.value === false) {
          value = "OFF";
        }
      } else if (e.value === false) {
        value = "OFF";
      } else if (e.value === true) {
        value = "ON";
      }
    }
    rows.push({
      key,
      kind,
      module: e.module,
      name: e.name,
      label: meta.label,
      code: meta.code,
      unit: kind === "sensor" ? meta.unit : kind === "pump" ? "" : "0/1",
      value,
      at: e.at,
    });
  }

  rows.sort((a, b) => {
    if (a.module !== b.module) return a.module.localeCompare(b.module);
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return a.name.localeCompare(b.name);
  });
  return rows;
}

/** Каталог датчиков комплекса для трекинга / графиков. */
export function complexSensorCatalog(): string[] {
  const keys: string[] = [];
  for (const mod of ["milk", "coffee"] as const) {
    keys.push(
      seriesKey(mod, "heater1_overheat"),
      seriesKey(mod, "heater2_overheat"),
      seriesKey(mod, "input"),
      seriesKey(mod, "pumpCurrent"),
      seriesKey(mod, "heater1_out"),
      seriesKey(mod, "heater2_out"),
      seriesKey(mod, "pumpPower"),
      seriesKey(mod, "pumpCurrentL"),
      seriesKey(mod, "heater1_pwm"),
      seriesKey(mod, "heater2_pwm")
    );
  }
  keys.push(
    seriesKey("water", "input"),
    seriesKey("water", "waterPressure"),
    seriesKey("water", "waterTotalPulses"),
    seriesKey("water", "heater1_out"),
    seriesKey("water", "heater2_out"),
    seriesKey("water", "heater1_pwm"),
    seriesKey("water", "heater2_pwm"),
    seriesKey("water", "pumpCurrent"),
    seriesKey("water", "pumpCurrentL"),
    seriesKey("water", "pumpPower")
  );
  return keys;
}
