/**
 * Lab telemetry snapshot: timed values for stale UI + single poller ownership.
 */

import type { DrinkxHost, TempSensorKey } from "./module-devices.js";

export type TelemetrySource = "nats" | "dx" | "cmd";

export type TimedValue<T> = {
  value: T;
  updatedAt: number;
  source: TelemetrySource;
};

export const STALE_MS = {
  /** Actuators (pump power / heater PWM). Tick may take ~2s. */
  actuators: 8_000,
  temps: 10_000,
  dx: 10_000,
} as const;

/**
 * Жёлтый stale только если опрос реально замер (не mid-tick и не pause на команду).
 */
export function isTelemetryStale(
  snap: {
    lastTickAt: number;
    pollInFlight?: boolean;
    pollPaused?: boolean;
  },
  ms: number,
  now = Date.now()
): boolean {
  if (snap.pollPaused || snap.pollInFlight) return false;
  if (!snap.lastTickAt) return false;
  return now - snap.lastTickAt > ms;
}

export function timed<T>(
  value: T,
  source: TelemetrySource,
  at = Date.now()
): TimedValue<T> {
  return { value, updatedAt: at, source };
}

export function isStale(
  tv: TimedValue<unknown> | null | undefined,
  ms: number,
  now = Date.now()
): boolean {
  if (!tv) return true;
  return now - tv.updatedAt > ms;
}

export type LabHostHeaters = Partial<
  Record<"heater1" | "heater2", TimedValue<boolean>>
>;
export type LabHostPwm = Partial<
  Record<"heater1" | "heater2", TimedValue<number>>
>;

export type LabSnapshot = {
  lastTickAt: number;
  /** Идёт сбор tick — не красить UI в stale. */
  pollInFlight: boolean;
  pollPaused: boolean;
  tick: number;
  errors: string[];
  /** Temps by host from coffeemachine.status */
  complexTemps: Partial<
    Record<DrinkxHost, Partial<Record<TempSensorKey, number>>>
  >;
  tempsUpdatedAt: number;
  waterPressure: TimedValue<number> | null;
  waterPulses: TimedValue<number> | null;
  pumpOn: Partial<Record<DrinkxHost, TimedValue<boolean>>>;
  pumpPower: Partial<Record<DrinkxHost, TimedValue<number>>>;
  pumpRis: Partial<Record<"milk" | "coffee", TimedValue<number>>>;
  pumpLis: Partial<Record<"milk" | "coffee", TimedValue<number>>>;
  heaters: Partial<Record<DrinkxHost, LabHostHeaters>>;
  heaterPwm: Partial<Record<DrinkxHost, LabHostPwm>>;
  /** Active-host valve baseId → enabled */
  valves: Partial<Record<string, TimedValue<boolean>>>;
  dxUiStatus: string;
};

export function emptyLabSnapshot(): LabSnapshot {
  return {
    lastTickAt: 0,
    pollInFlight: false,
    pollPaused: false,
    tick: 0,
    errors: [],
    complexTemps: {},
    tempsUpdatedAt: 0,
    waterPressure: null,
    waterPulses: null,
    pumpOn: {},
    pumpPower: {},
    pumpRis: {},
    pumpLis: {},
    heaters: {},
    heaterPwm: {},
    valves: {},
    dxUiStatus: "",
  };
}

/** Merge timed value; keep previous if new is null and keepPrevious. */
export function setTimed<T>(
  prev: TimedValue<T> | undefined,
  next: T | null | undefined,
  source: TelemetrySource,
  opts?: { keepPrevious?: boolean; at?: number }
): TimedValue<T> | undefined {
  if (next == null) {
    if (opts?.keepPrevious) return prev;
    return undefined;
  }
  return timed(next, source, opts?.at);
}
