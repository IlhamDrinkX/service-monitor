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

/** Точки для простого графика: sensor events по имени. */
export function sensorSeries(
  events: LabEvent[],
  sensorName: string,
  limit = 120
): Array<{ t: number; v: number }> {
  const pts: Array<{ t: number; v: number }> = [];
  for (const e of events) {
    if (e.kind !== "sensor" || e.name !== sensorName) continue;
    const n = typeof e.value === "number" ? e.value : Number(e.value);
    if (!Number.isFinite(n)) continue;
    pts.push({ t: Date.parse(e.at), v: n });
  }
  return pts.slice(-limit);
}
