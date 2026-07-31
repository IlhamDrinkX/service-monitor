/**
 * Кортеж status-ответов комплекса (milk / coffee / water).
 * Как facade-cm: один снимок или несколько reply от requestMany.
 */

import {
  DRINKX_HOSTS,
  extractPumpCurrent,
  extractTempMap,
  extractWaterPressure,
  extractWaterTotalPulses,
  type DrinkxHost,
  type TempSensorKey,
} from "./module-devices.js";

export type ComplexHostSnapshot = {
  host: DrinkxHost;
  temps: Partial<Record<TempSensorKey, number>>;
  waterPressure: number | null;
  waterPulses: number | null;
  pumpCurrent: number | null;
  sensorCount: number;
  source: "facade" | "module" | "unknown";
};

export type ComplexStatusTuple = {
  at: string;
  replies: number;
  hosts: Record<DrinkxHost, ComplexHostSnapshot>;
};

function unwrapPayload(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  if (r.result && typeof r.result === "object") {
    return r.result as Record<string, unknown>;
  }
  return r;
}

function collectSensorNames(raw: unknown): string[] {
  const payload = unwrapPayload(raw);
  const names: string[] = [];
  const pushFrom = (container: unknown) => {
    if (!Array.isArray(container)) return;
    for (const item of container) {
      if (item && typeof item === "object" && "name" in item) {
        names.push(String((item as { name: unknown }).name).toLowerCase());
      }
    }
  };
  pushFrom(payload.sensors);
  for (const h of DRINKX_HOSTS) {
    pushFrom(payload[`${h}Sensors`]);
  }
  return names;
}

/**
 * Хост по префиксу датчиков (milk_input / coffee_heater1_out / …).
 * В status-теле hwid обычно нет — только имена сенсоров.
 */
export function detectHostFromSensorNames(raw: unknown): DrinkxHost | null {
  const names = collectSensorNames(raw);
  if (names.length === 0) return null;
  const scores: Record<DrinkxHost, number> = {
    milk: 0,
    coffee: 0,
    water: 0,
  };
  for (const n of names) {
    for (const h of DRINKX_HOSTS) {
      if (n.startsWith(`${h}_`) || n.includes(`_${h}_`)) {
        scores[h] += 1;
      }
    }
  }
  let best: DrinkxHost | null = null;
  let bestScore = 0;
  for (const h of DRINKX_HOSTS) {
    if (scores[h] > bestScore) {
      best = h;
      bestScore = scores[h];
    }
  }
  return bestScore > 0 ? best : null;
}

function detectHostFromReply(raw: unknown): DrinkxHost | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const hwid = String(r.hwid ?? "").toLowerCase();
  const role = String(r.role ?? "").toLowerCase();
  for (const h of DRINKX_HOSTS) {
    if (role === h) return h;
    if (hwid === `dx.${h}` || hwid.endsWith(`.${h}`) || hwid.includes(h)) {
      return h;
    }
  }
  return detectHostFromSensorNames(raw);
}

function isFacadeAggregate(raw: unknown): boolean {
  const payload = unwrapPayload(raw);
  return (
    payload.milkSensors != null ||
    payload.coffeeSensors != null ||
    payload.waterSensors != null ||
    payload.format === "drinkx-1.0"
  );
}

function snapshotFromStatus(
  host: DrinkxHost,
  raw: unknown,
  source: ComplexHostSnapshot["source"]
): ComplexHostSnapshot {
  const temps = extractTempMap(raw, host);
  const waterPressure =
    host === "water" ? extractWaterPressure(raw, "water") : null;
  const waterPulses =
    host === "water" ? extractWaterTotalPulses(raw, "water") : null;
  const pumpCurrent =
    host === "milk" || host === "coffee" ? extractPumpCurrent(raw) : null;
  return {
    host,
    temps,
    waterPressure,
    waterPulses,
    pumpCurrent,
    sensorCount:
      Object.keys(temps).length +
      (waterPressure != null ? 1 : 0) +
      (waterPulses != null ? 1 : 0) +
      (pumpCurrent != null ? 1 : 0),
    source,
  };
}

function emptyHost(host: DrinkxHost): ComplexHostSnapshot {
  return {
    host,
    temps: {},
    waterPressure: null,
    waterPulses: null,
    pumpCurrent: null,
    sensorCount: 0,
    source: "unknown",
  };
}

/**
 * Разбирает 1..N ответов coffeemachine.status в снимок комплекса.
 */
export function parseComplexStatusTuple(
  replies: unknown[]
): ComplexStatusTuple {
  const hosts = {
    milk: emptyHost("milk"),
    coffee: emptyHost("coffee"),
    water: emptyHost("water"),
  } as Record<DrinkxHost, ComplexHostSnapshot>;

  for (const raw of replies) {
    if (isFacadeAggregate(raw)) {
      for (const h of DRINKX_HOSTS) {
        const snap = snapshotFromStatus(h, raw, "facade");
        if (snap.sensorCount >= hosts[h].sensorCount) {
          hosts[h] = snap;
        }
      }
      continue;
    }
    const host = detectHostFromReply(raw);
    if (!host) continue;
    const snap = snapshotFromStatus(host, raw, "module");
    if (snap.sensorCount >= hosts[host].sensorCount) {
      hosts[host] = snap;
    }
  }

  return {
    at: new Date().toISOString(),
    replies: replies.length,
    hosts,
  };
}

export function complexTupleSummary(tuple: ComplexStatusTuple): string {
  const parts = DRINKX_HOSTS.map(
    (h) => `${h}:${tuple.hosts[h].sensorCount}`
  );
  return `tuple replies=${tuple.replies} · ${parts.join(" ")}`;
}
