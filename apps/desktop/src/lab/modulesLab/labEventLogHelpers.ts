/**
 * Pure helpers for Lab event log / sensor sampling / chart props.
 */

import {
  complexSensorCatalog,
  DRINKX_HOSTS,
  HEATER_IDS,
  MILK_SYSTEM_VALVE_IDS,
  MODULE_VALVES,
  parseSeriesKey,
  seriesKey,
  type DrinkxHost,
  type LabEvent,
  type LabSnapshot,
} from "@service-monitor/core";
import type { EnabledMap } from "./modulesLabTypes";

export function isCriticalLabSensor(name: string): boolean {
  return (
    name === "pumpCurrent" ||
    name === "pumpCurrentL" ||
    name === "pumpPower" ||
    name === "heater1_pwm" ||
    name === "heater2_pwm" ||
    name === "waterPressure" ||
    name === "waterTotalPulses"
  );
}

export function labSensorHeartbeatMs(
  name: string,
  critical: boolean,
  override?: number
): number {
  if (override != null) return override;
  if (!critical) return 5_000;
  return name === "waterTotalPulses" || name === "waterPressure" ? 1_500 : 1_200;
}

export function labSensorDelta(name: string, minDelta: number): number {
  if (name === "pumpCurrent" || name === "pumpCurrentL") {
    return Math.min(minDelta, 0.005);
  }
  if (name === "waterTotalPulses") return Math.min(minDelta, 1);
  return minDelta;
}

export function labSensorDigits(name: string, override?: number): number {
  if (override != null) return override;
  return name === "pumpCurrent" || name === "pumpCurrentL" ? 3 : 2;
}

/** Decide whether a sensor sample should be appended to the lab log. */
export function shouldPushLabSensorSample(opts: {
  name: string;
  value: number | null;
  minDelta?: number;
  force?: boolean;
  heartbeatMs?: number;
  tracked: boolean;
  /** Previous numeric sample; NaN sentinel = already in gap. */
  prevValue: number | undefined;
  prevAt: number | undefined;
  now?: number;
}): boolean {
  const now = opts.now ?? Date.now();
  // Gap (null): push once when leaving a finite value, then heartbeat while offline.
  if (opts.value == null) {
    if (opts.force) return true;
    const alreadyGapped =
      opts.prevValue != null && Number.isNaN(opts.prevValue);
    const gapHeartbeat = opts.heartbeatMs ?? 2_000;
    if (!alreadyGapped && opts.prevValue != null && Number.isFinite(opts.prevValue)) {
      return true;
    }
    if (alreadyGapped) {
      return now - (opts.prevAt ?? 0) > gapHeartbeat;
    }
    // Never had a sample — no gap marker needed.
    return false;
  }

  const critical = isCriticalLabSensor(opts.name);
  if (!opts.force && !critical && !opts.tracked) return false;
  const heartbeat = labSensorHeartbeatMs(opts.name, critical, opts.heartbeatMs);
  const delta = labSensorDelta(opts.name, opts.minDelta ?? 0.15);
  const prev = opts.prevValue;
  const prevFinite = prev != null && Number.isFinite(prev) ? prev : undefined;
  return (
    prevFinite == null ||
    Math.abs(prevFinite - opts.value) >= delta ||
    now - (opts.prevAt ?? 0) > heartbeat
  );
}

export function availableChartSensorsFromEvents(labEvents: LabEvent[]): string[] {
  const catalog = complexSensorCatalog();
  const fromEvents = new Set<string>();
  for (const e of labEvents) {
    if (e.kind === "sensor") fromEvents.add(seriesKey(e.module, e.name));
  }
  return [...new Set([...catalog, ...fromEvents])];
}

export function chartSensorNamesFromEvents(labEvents: LabEvent[]): string[] {
  const names = new Set<string>();
  for (const e of labEvents) {
    if (e.kind === "sensor") names.add(seriesKey(e.module, e.name));
  }
  for (const k of complexSensorCatalog()) names.add(k);
  const catalog = complexSensorCatalog();
  return [
    ...catalog.filter((k) => names.has(k)),
    ...[...names].filter((k) => !catalog.includes(k)),
  ];
}

export function buildLiveActuators(opts: {
  host: DrinkxHost;
  labSnap: LabSnapshot;
  valves: EnabledMap;
  milkValves: EnabledMap;
  pumpOn: boolean | null;
  labEvents: LabEvent[];
}): {
  valves: Record<string, boolean>;
  pumps: Partial<Record<DrinkxHost, boolean>>;
} {
  const valvesLive: Record<string, boolean> = {};
  for (const [key, tv] of Object.entries(opts.labSnap.valves)) {
    if (!tv) continue;
    const parsed = parseSeriesKey(key);
    if (parsed.module) {
      valvesLive[key] = tv.value === true;
    } else {
      valvesLive[seriesKey(opts.host, key)] = tv.value === true;
    }
  }
  for (const [id, on] of Object.entries(opts.valves)) {
    if (on == null) continue;
    valvesLive[seriesKey(opts.host, id)] = on === true;
  }
  for (let n = 1; n <= 6; n++) {
    const v = opts.milkValves[String(n)];
    if (v == null) continue;
    valvesLive[seriesKey("milk", `msValve${n}`)] = v === true;
  }
  for (const e of opts.labEvents) {
    if (e.kind !== "valve") continue;
    if (e.value !== true && e.value !== false) continue;
    valvesLive[seriesKey(e.module, e.name)] = e.value;
  }
  const pumpsLive: Partial<Record<DrinkxHost, boolean>> = {};
  for (const mod of DRINKX_HOSTS) {
    const tv = opts.labSnap.pumpOn[mod];
    if (tv) pumpsLive[mod] = tv.value;
  }
  if (opts.pumpOn != null) pumpsLive[opts.host] = opts.pumpOn;
  return { valves: valvesLive, pumps: pumpsLive };
}

export function chartValveIdsByModule(): Record<DrinkxHost, string[]> {
  return {
    milk: [...MODULE_VALVES.milk, ...MILK_SYSTEM_VALVE_IDS],
    coffee: MODULE_VALVES.coffee,
    water: MODULE_VALVES.water,
  };
}

export function chartHeaterIds(): string[] {
  return [...HEATER_IDS];
}
