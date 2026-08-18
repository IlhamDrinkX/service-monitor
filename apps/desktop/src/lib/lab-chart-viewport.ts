/**
 * Viewport helpers for complex lab chart (overview scrubber + wheel zoom +
 * boolean valve segment edges for hover tooltips).
 */

export const LAB_CHART_MIN_WINDOW_MS = 10_000;
/** Soft ceiling when data span is huge (e.g. 72h import). */
export const LAB_CHART_MAX_WINDOW_MS = 72 * 60 * 60 * 1000;

export const LAB_CHART_PRESET_MS = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
} as const;

export type LabChartPresetScale = keyof typeof LAB_CHART_PRESET_MS;

export function clampChartWindowMs(
  windowMs: number,
  opts: { dataSpanMs: number; minMs?: number; maxMs?: number }
): number {
  const minMs = opts.minMs ?? LAB_CHART_MIN_WINDOW_MS;
  const spanCap = Math.max(minMs, opts.dataSpanMs);
  const hardMax = opts.maxMs ?? LAB_CHART_MAX_WINDOW_MS;
  const maxMs = Math.max(minMs, Math.min(spanCap, hardMax));
  if (!Number.isFinite(windowMs)) return maxMs;
  return Math.min(Math.max(windowMs, minMs), maxMs);
}

/**
 * Cursor-anchored zoom: keep `anchorT` at the same fractional position inside
 * the visible window while changing duration. Pan is measured from «сейчас»
 * (`clockNow - viewEnd`), matching LabChartPanel.
 */
export function zoomChartViewport(args: {
  windowMs: number;
  panOffsetMs: number;
  clockNow: number;
  dataMinT: number;
  anchorT: number;
  factor: number;
  minWindowMs?: number;
  maxWindowMs?: number;
}): { windowMs: number; panOffsetMs: number } {
  const {
    clockNow,
    dataMinT,
    factor,
    minWindowMs,
    maxWindowMs,
  } = args;
  const dataSpanMs = Math.max(0, clockNow - dataMinT);
  const nextWindow = clampChartWindowMs(args.windowMs * factor, {
    dataSpanMs,
    minMs: minWindowMs,
    maxMs: maxWindowMs,
  });

  const prevWindow = Math.max(1, args.windowMs);
  const viewEnd = clockNow - Math.max(0, args.panOffsetMs);
  const viewStart = viewEnd - prevWindow;
  const frac = Math.min(
    1,
    Math.max(0, (args.anchorT - viewStart) / prevWindow)
  );

  let newViewEnd = args.anchorT + (1 - frac) * nextWindow;
  let newViewStart = newViewEnd - nextWindow;

  if (newViewStart < dataMinT) {
    newViewStart = dataMinT;
    newViewEnd = newViewStart + nextWindow;
  }
  if (newViewEnd > clockNow) {
    newViewEnd = clockNow;
    newViewStart = newViewEnd - nextWindow;
    if (newViewStart < dataMinT) newViewStart = dataMinT;
  }

  const panOffsetMs = Math.max(0, clockNow - newViewEnd);
  return { windowMs: nextWindow, panOffsetMs };
}

/** Map overview click/drag X (0..1 along full history) → panOffsetMs. */
export function panOffsetFromOverviewFraction(args: {
  fraction: number;
  windowMs: number;
  clockNow: number;
  dataMinT: number;
  /** `seek` centers the window on the fraction; `rightEdge` matches old range slider. */
  mode?: "seek" | "rightEdge";
}): number {
  const { windowMs, clockNow, dataMinT } = args;
  const maxPan = Math.max(0, clockNow - dataMinT - windowMs);
  if (maxPan <= 0) return 0;
  const f = Math.min(1, Math.max(0, args.fraction));
  if (args.mode === "rightEdge") {
    return Math.round((1 - f) * maxPan);
  }
  const span = Math.max(windowMs, clockNow - dataMinT);
  const centerT = dataMinT + f * span;
  const viewEnd = centerT + windowMs / 2;
  return Math.min(maxPan, Math.max(0, Math.round(clockNow - viewEnd)));
}

/** Pan by moving the visible window's left edge to an absolute time. */
export function panOffsetForViewStart(args: {
  viewStartMs: number;
  windowMs: number;
  clockNow: number;
  dataMinT: number;
}): number {
  const maxPan = Math.max(
    0,
    args.clockNow - args.dataMinT - args.windowMs
  );
  if (maxPan <= 0) return 0;
  const viewEnd = args.viewStartMs + args.windowMs;
  return Math.min(maxPan, Math.max(0, Math.round(args.clockNow - viewEnd)));
}

/**
 * For a step boolean series at `atMs`, find the contiguous segment edges
 * (value flipped to current → flips away).
 */
export function findBooleanSegmentEdges(
  points: ReadonlyArray<{ t: number; v: number }>,
  atMs: number
): { on: boolean; startMs: number; endMs: number } | null {
  if (points.length === 0) return null;

  let value = points[0]!.v;
  let idx = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    if (p.t <= atMs) {
      value = p.v;
      idx = i;
    } else break;
  }

  let startMs = points[0]!.t;
  for (let i = idx; i >= 0; i--) {
    if (points[i]!.v !== value) {
      startMs = points[i + 1]!.t;
      break;
    }
    startMs = points[i]!.t;
  }

  let endMs = points[points.length - 1]!.t;
  for (let i = idx + 1; i < points.length; i++) {
    if (points[i]!.v !== value) {
      endMs = points[i]!.t;
      break;
    }
  }

  return { on: value >= 0.5, startMs, endMs };
}

export function formatChartLocalTime(
  ms: number,
  locale = "ru-RU"
): string {
  return new Date(ms).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** RU tooltip lines for valve/pump boolean segment under cursor. */
export function formatBooleanSegmentTooltip(
  edges: { on: boolean; startMs: number; endMs: number },
  locale = "ru-RU"
): { state: string; detail: string } {
  const a = formatChartLocalTime(edges.startMs, locale);
  const b = formatChartLocalTime(edges.endMs, locale);
  if (edges.on) {
    return {
      state: "ON",
      detail: `открыт ${a} → закрыт ${b}`,
    };
  }
  return {
    state: "OFF",
    detail: `закрыт ${a} → открыт ${b}`,
  };
}

export function matchPresetScale(
  windowMs: number | null
): LabChartPresetScale | "all" | "custom" {
  if (windowMs == null) return "all";
  for (const key of Object.keys(LAB_CHART_PRESET_MS) as LabChartPresetScale[]) {
    if (LAB_CHART_PRESET_MS[key] === windowMs) return key;
  }
  return "custom";
}

export function formatWindowDurationLabel(windowMs: number): string {
  if (windowMs < 60_000) return `${Math.round(windowMs / 1000)} с`;
  if (windowMs < 3_600_000) {
    const m = windowMs / 60_000;
    return Number.isInteger(m) ? `${m} мин` : `${m.toFixed(1)} мин`;
  }
  const h = windowMs / 3_600_000;
  return Number.isInteger(h) ? `${h} ч` : `${h.toFixed(1)} ч`;
}
