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

/** Точки датчика: key = `milk.input` или короткое `input`. */
export function sensorSeries(
  events: LabEvent[],
  sensorName: string,
  limit = 120,
  sinceMs?: number | null
): Array<{ t: number; v: number }> {
  const pts: Array<{ t: number; v: number }> = [];
  const since = sinceMs ?? null;
  for (const e of events) {
    if (!eventMatchesSeries(e, sensorName, "sensor")) continue;
    const t = Date.parse(e.at);
    if (!Number.isFinite(t)) continue;
    if (since != null && t < since) continue;
    const n = typeof e.value === "number" ? e.value : Number(e.value);
    if (!Number.isFinite(n)) continue;
    pts.push({ t, v: n });
  }
  return pts.slice(-limit);
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
 */
export function booleanStepSeries(
  events: LabEvent[],
  kind: LabEventKind,
  name: string,
  sinceMs?: number | null,
  limit = 400
): Array<{ t: number; v: number }> {
  const raw: Array<{ t: number; v: number }> = [];
  const since = sinceMs ?? null;
  for (const e of events) {
    if (!eventMatchesSeries(e, name, kind)) continue;
    if (e.value !== true && e.value !== false) continue;
    const t = Date.parse(e.at);
    if (!Number.isFinite(t)) continue;
    if (since != null && t < since) continue;
    raw.push({ t, v: e.value ? 1 : 0 });
  }
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
  return stepped.slice(-limit);
}

/** Мощность насоса %; `module` опционально фильтрует. */
export function pumpPowerSeries(
  events: LabEvent[],
  sinceMs?: number | null,
  limit = 200,
  module?: string | null
): Array<{ t: number; v: number }> {
  const pts: Array<{ t: number; v: number }> = [];
  const since = sinceMs ?? null;
  for (const e of events) {
    if (e.kind !== "pump" || e.name !== "pump") continue;
    if (module && e.module !== module) continue;
    const t = Date.parse(e.at);
    if (!Number.isFinite(t)) continue;
    if (since != null && t < since) continue;
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
    pts.push({ t, v: power });
  }
  if (pts.length === 0) return [];
  const stepped: Array<{ t: number; v: number }> = [
    { t: pts[0]!.t, v: pts[0]!.v },
  ];
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1]!;
    const cur = pts[i]!;
    stepped.push({ t: cur.t, v: prev.v });
    stepped.push(cur);
  }
  return stepped.slice(-limit);
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
      if (e.value !== true && e.value !== false) continue;
      const key = seriesKey(e.module, e.name);
      const mapKey = `${e.kind}:${key}`;
      const prev = best.get(mapKey);
      if (!prev || Date.parse(prev.e.at) <= t) {
        best.set(mapKey, { e, key, kind: e.kind });
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
    seriesKey("water", "heater2_out")
  );
  return keys;
}
