/**
 * Lab telemetry snapshot: timed values for stale UI + single poller ownership.
 * Pure apply/merge helpers feed LabTelemetryController (desktop).
 */

import { parseComplexStatusTuple } from "./complex-status.js";
import {
  DRINKX_HOSTS,
  extractOpenValveNumbers,
  extractTempMap,
  extractWaterPressure,
  extractWaterTotalPulses,
  mergeOpenValveNumbers,
  type DrinkxHost,
  type TempSensorKey,
} from "./module-devices.js";

export type TelemetrySource = "nats" | "dx" | "cmd";

export type TimedValue<T> = {
  value: T;
  updatedAt: number;
  source: TelemetrySource;
};

export const STALE_MS = {
  /** Actuators (pump power / heater PWM). Secondary tick ~800ms. */
  actuators: 8_000,
  temps: 10_000,
  dx: 10_000,
} as const;

/** Active Lab host: valves/pump/heaters + status every tick. */
export const LAB_ACTIVE_POLL_MS = 800;
/**
 * Non-active tracked hosts (complex-wide charts): status + valves + heaters + pumps.
 * Matched to active 800ms — modest load vs ~1.1s; still well above unsafe ≤400ms
 * (tick overlap / cm-drv). DX currents stay ~1s.
 */
export const LAB_OTHER_STATUS_MS = 800;

/**
 * Dual poll plan (always-on complex telemetry, not Big-Wash-only):
 * - Active (tracked): full every tick — valves + pump + heaters + status
 * - Other tracked: on interval — status + valves + heaters + pumps
 * Whole module dropped when `isTracked` is false (default track = all three).
 */
export function planLabNatsPoll(opts: {
  active: DrinkxHost;
  now: number;
  lastOtherStatusAt: number;
  otherStatusMs?: number;
  isTracked: (host: DrinkxHost) => boolean;
}): {
  /** Active host: valves + pump + heaters every tick. */
  fullHosts: DrinkxHost[];
  /** Status/temps: active always + others on interval. */
  statusHosts: DrinkxHost[];
  /** Valves + heaters: active always + others on interval. */
  actuatorHosts: DrinkxHost[];
  /** Pumps power%: active always + others on interval (milk/coffee/water). */
  pumpHosts: DrinkxHost[];
  didOtherStatus: boolean;
} {
  const otherMs = opts.otherStatusMs ?? LAB_OTHER_STATUS_MS;
  const fullHosts: DrinkxHost[] = [];
  if (opts.isTracked(opts.active)) fullHosts.push(opts.active);

  const didOtherStatus = opts.now - opts.lastOtherStatusAt >= otherMs;
  const statusHosts = [...fullHosts];
  const actuatorHosts = [...fullHosts];
  const pumpHosts = [...fullHosts];
  if (didOtherStatus) {
    for (const h of DRINKX_HOSTS) {
      if (h === opts.active) continue;
      if (!opts.isTracked(h)) continue;
      statusHosts.push(h);
      actuatorHosts.push(h);
      pumpHosts.push(h);
    }
  }
  return { fullHosts, statusHosts, actuatorHosts, pumpHosts, didOtherStatus };
}

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

/** Per-host reachability: NATS (pump/status) vs DX HTTP (:8000 R_IS). */
export type LabHostHealth = {
  /** pumps.status / heaters / temps for this host */
  natsOk: boolean | null;
  /** DX UI HTTP → pump_R_IS present */
  dxOk: boolean | null;
  updatedAt: number;
};

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
  pumpRis: Partial<Record<"milk" | "coffee" | "water", TimedValue<number>>>;
  pumpLis: Partial<Record<"milk" | "coffee" | "water", TimedValue<number>>>;
  heaters: Partial<Record<DrinkxHost, LabHostHeaters>>;
  heaterPwm: Partial<Record<DrinkxHost, LabHostPwm>>;
  /** Active-host valve baseId → enabled */
  valves: Partial<Record<string, TimedValue<boolean>>>;
  /**
   * Открытые клапаны молочного холодильника (номера 1…6).
   * Источник: status milkValves/coffeeValves/valves + bus complexos.valves.switched.
   */
  milkSystemOpen: TimedValue<number[]> | null;
  /** Per milk/coffee/water: NATS vs DX split (типичный DHCP/.33 кейс). */
  hostHealth: Partial<Record<DrinkxHost, LabHostHealth>>;
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
    milkSystemOpen: null,
    hostHealth: {},
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

/**
 * Apply coffeemachine.status replies (facade `{hwid:dx}` or module tuples)
 * into complexTemps / water / milkSystemOpen.
 *
 * Explicit `milkValves: []` → milkSystemOpen=[] (fridge all closed, not unknown).
 */
export function applyLabStatusReplies(
  snap: LabSnapshot,
  replies: unknown[],
  at: number,
  opts?: { milkSystemHoldUntil?: number; now?: number }
): LabSnapshot {
  const tuple = parseComplexStatusTuple(replies);
  const complexTemps: LabSnapshot["complexTemps"] = {
    ...snap.complexTemps,
  };
  let waterPressure = snap.waterPressure;
  let waterPulses = snap.waterPulses;
  const openLists: number[][] = [];
  let valveFieldSeen = false;

  const pumpRis = { ...snap.pumpRis };
  for (const host of DRINKX_HOSTS) {
    const h = tuple.hosts[host];
    if (!h || h.sensorCount === 0) continue;
    complexTemps[host] = { ...complexTemps[host], ...h.temps };
    if (host === "water") {
      if (h.waterPressure != null) {
        waterPressure = timed(h.waterPressure, "nats", at);
      }
      if (h.waterPulses != null) {
        waterPulses = timed(h.waterPulses, "nats", at);
      }
    }
    // pump_R_IS из status (deep-search) — fallback, пока DX UI не дал свежий ток
    if (
      (host === "milk" || host === "coffee") &&
      h.pumpCurrent != null
    ) {
      const prev = snap.pumpRis[host];
      const dxFresh =
        prev?.source === "dx" && at - prev.updatedAt < STALE_MS.dx;
      if (!dxFresh) {
        pumpRis[host] = timed(h.pumpCurrent, "nats", at);
      }
    }
  }

  for (const raw of replies) {
    const open = extractOpenValveNumbers(raw);
    if (open !== null) {
      valveFieldSeen = true;
      openLists.push(open);
    }
    // Facade: milkValves + coffeeValves may both be present in one payload
    if (raw && typeof raw === "object") {
      const r = raw as Record<string, unknown>;
      const result =
        r.result && typeof r.result === "object"
          ? (r.result as Record<string, unknown>)
          : r;
      for (const key of ["milkValves", "coffeeValves", "waterValves"] as const) {
        const v = result[key];
        if (Array.isArray(v)) {
          valveFieldSeen = true;
          openLists.push(
            v.map((x) => Number(x)).filter((n) => Number.isFinite(n))
          );
        }
      }
    }
  }

  if (
    Object.keys(complexTemps).every((k) => !complexTemps[k as DrinkxHost])
  ) {
    for (const raw of replies) {
      for (const host of DRINKX_HOSTS) {
        const map = extractTempMap(raw, host);
        if (Object.keys(map).length === 0) continue;
        complexTemps[host] = { ...complexTemps[host], ...map };
      }
      const p = extractWaterPressure(raw);
      if (p != null) waterPressure = timed(p, "nats", at);
      const pulses = extractWaterTotalPulses(raw);
      if (pulses != null) waterPulses = timed(pulses, "nats", at);
    }
  }

  // DrinkX getStatus often omits valves → leave previous. Explicit [] = all closed.
  let milkSystemOpen = snap.milkSystemOpen;
  const holdUntil = opts?.milkSystemHoldUntil ?? 0;
  const now = opts?.now ?? Date.now();
  if (now < holdUntil) {
    // keep bus/cmd
  } else if (valveFieldSeen) {
    milkSystemOpen = timed(mergeOpenValveNumbers(...openLists), "nats", at);
  }

  return {
    ...snap,
    complexTemps,
    tempsUpdatedAt: at,
    waterPressure,
    waterPulses,
    milkSystemOpen,
    pumpRis,
  };
}

export type HostOkMap = Partial<Record<DrinkxHost, boolean>>;

/**
 * Per-host NATS reachability from pump/heater replies and/or temps in status.
 * dxOk is preserved from previous (DX tick owns it).
 */
export function computeNatsHostHealth(
  prev: LabSnapshot["hostHealth"],
  input: {
    pumpOk: HostOkMap;
    heaterOk: HostOkMap;
    complexTemps: LabSnapshot["complexTemps"];
    at: number;
  }
): LabSnapshot["hostHealth"] {
  const hostHealth: LabSnapshot["hostHealth"] = { ...prev };
  for (const mod of DRINKX_HOSTS) {
    const temps = input.complexTemps[mod];
    const hasTemps = !!temps && Object.keys(temps).length > 0;
    const natsReach =
      input.pumpOk[mod] === true ||
      input.heaterOk[mod] === true ||
      hasTemps;
    const natsFail =
      input.pumpOk[mod] === false &&
      input.heaterOk[mod] !== true &&
      !hasTemps;
    const prevH = hostHealth[mod];
    const natsOk: boolean | null = natsReach
      ? true
      : natsFail
        ? false
        : (prevH?.natsOk ?? null);
    hostHealth[mod] = {
      natsOk,
      dxOk: prevH?.dxOk ?? null,
      updatedAt: input.at,
    };
  }
  return hostHealth;
}

/** DX UI :8000 module currents (R_IS / L_IS) + optional heater PWM. */
export type DxPumpCurrentsPayload = {
  ok?: boolean;
  milk: {
    pump_R_IS: number | null;
    pump_L_IS: number | null;
    heater1_pwm?: number | null;
    heater2_pwm?: number | null;
    error?: string;
    via?: string;
  };
  coffee: {
    pump_R_IS: number | null;
    pump_L_IS: number | null;
    heater1_pwm?: number | null;
    heater2_pwm?: number | null;
    error?: string;
    via?: string;
  };
  water?: {
    pump_R_IS: number | null;
    pump_L_IS: number | null;
    heater1_pwm?: number | null;
    heater2_pwm?: number | null;
    error?: string;
    via?: string;
  };
};

/**
 * Merge DX UI currents into snapshot + update hostHealth.dxOk per milk/coffee/water.
 * natsOk is preserved from previous (NATS tick owns it).
 */
export function applyDxPumpCurrents(
  snap: LabSnapshot,
  dx: DxPumpCurrentsPayload,
  at: number
): LabSnapshot {
  const pumpRis = { ...snap.pumpRis };
  const pumpLis = { ...snap.pumpLis };
  const heaterPwm = { ...snap.heaterPwm };

  for (const mod of ["milk", "coffee", "water"] as const) {
    const s = dx[mod];
    if (!s) continue;
    if (s.pump_R_IS != null) pumpRis[mod] = timed(s.pump_R_IS, "dx", at);
    if (s.pump_L_IS != null) pumpLis[mod] = timed(s.pump_L_IS, "dx", at);

    if (mod === "water") continue;
    const h = snap.heaters[mod];
    const nextHost = { ...heaterPwm[mod] };
    if (h?.heater1?.value === true && s.heater1_pwm != null) {
      nextHost.heater1 = timed(s.heater1_pwm, "dx", at);
    }
    if (h?.heater2?.value === true && s.heater2_pwm != null) {
      nextHost.heater2 = timed(s.heater2_pwm, "dx", at);
    }
    heaterPwm[mod] = nextHost;
  }

  const via = (m: "milk" | "coffee" | "water") =>
    dx[m]?.via ? `/${dx[m]!.via}` : "";
  const errs = [
    dx.milk?.error ? `milk: ${dx.milk.error}` : null,
    dx.coffee?.error ? `coffee: ${dx.coffee.error}` : null,
    dx.water?.error ? `water: ${dx.water.error}` : null,
  ].filter(Boolean);
  const has =
    dx.milk?.pump_R_IS != null ||
    dx.coffee?.pump_R_IS != null ||
    dx.water?.pump_R_IS != null;
  const dxUiStatus = has
    ? `DX UI ток · milk R=${dx.milk?.pump_R_IS?.toFixed(3) ?? "—"} L=${dx.milk?.pump_L_IS?.toFixed(3) ?? "—"}${via("milk")} · coffee R=${dx.coffee?.pump_R_IS?.toFixed(3) ?? "—"} L=${dx.coffee?.pump_L_IS?.toFixed(3) ?? "—"}${via("coffee")} · water R=${dx.water?.pump_R_IS?.toFixed(3) ?? "—"}${via("water")}`
    : errs.length
      ? `DX UI пусто: ${errs.join("; ")} · эталон milk=.44 coffee=.45 water=.46 (не .33)`
      : "DX UI: нет pump_R_IS · проверьте IP milk=.44 coffee=.45 water=.46 (не .33)";

  const hostHealth: LabSnapshot["hostHealth"] = { ...snap.hostHealth };
  for (const mod of ["milk", "coffee", "water"] as const) {
    const s = dx[mod];
    const prev = hostHealth[mod];
    let dxOk: boolean | null = prev?.dxOk ?? null;
    if (s?.pump_R_IS != null || s?.pump_L_IS != null) {
      dxOk = true;
    } else if (s?.error) {
      dxOk = false;
    }
    hostHealth[mod] = {
      natsOk: prev?.natsOk ?? null,
      dxOk,
      updatedAt: at,
    };
  }

  return {
    ...snap,
    pumpRis,
    pumpLis,
    heaterPwm,
    hostHealth,
    dxUiStatus,
    lastTickAt: has ? Math.max(snap.lastTickAt, at) : snap.lastTickAt,
  };
}
