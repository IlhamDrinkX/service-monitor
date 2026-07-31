/**
 * Карта устройств DrinkX и хелперы статусов (как module_test).
 */

export type DrinkxHost = "milk" | "coffee" | "water";

export const DRINKX_HOSTS: DrinkxHost[] = ["milk", "coffee", "water"];

export const MODULE_VALVES: Record<DrinkxHost, string[]> = {
  water: ["milkInput", "drain", "dump"],
  milk: ["milkInput", "waterInput", "drain", "dump", "drysideValve", "air"],
  coffee: ["milkInput", "waterInput", "drain", "dump", "drysideValve", "air"],
};

export const ALL_KNOWN_VALVES = [
  "milkInput",
  "waterInput",
  "drain",
  "dump",
  "drysideValve",
  "air",
] as const;

export const VALVE_LABELS: Record<string, string> = {
  milkInput: "Клапан №1 (ввода)",
  waterInput: "Клапан №2 (ввода воды)",
  drain: "Клапан №4 (сливной)",
  dump: "Клапан №3 (байпас)",
  drysideValve: "Клапан №5 (воздушный)",
  air: "Пневмораспределитель №6",
  commonValve: "Сливной клапан (блок №6)",
};

export const HEATER_IDS = ["heater1", "heater2"] as const;
export const HEATER_LABELS: Record<string, string> = {
  heater1: "Нагреватель 1",
  heater2: "Нагреватель 2",
};
export const HEATER_TARGET_C = 45;
export const HEATER_AUTO_STOP_MS = 10_000;

export const TEMP_SENSOR_ORDER = [
  "input",
  "heater1_out",
  "heater2_out",
  "heater1_overheat",
  "heater2_overheat",
] as const;

export type TempSensorKey = (typeof TEMP_SENSOR_ORDER)[number];

export const TEMP_SENSOR_LABELS: Record<TempSensorKey, string> = {
  input: "Input",
  heater1_out: "Heater 1 out",
  heater2_out: "Heater 2 out",
  heater1_overheat: "Heater 1 overheat",
  heater2_overheat: "Heater 2 overheat",
};

export function defaultHwid(host: DrinkxHost): string {
  return `dx.${host}`;
}

export function valveTopicId(host: DrinkxHost, baseId: string): string {
  return `${host}-${baseId}`;
}

export function valveStatusSubject(host: DrinkxHost, baseId: string): string {
  return `valves.status.${valveTopicId(host, baseId)}`;
}

export function valveCommandSubject(
  host: DrinkxHost,
  baseId: string,
  enabled: boolean
): string {
  const id = valveTopicId(host, baseId);
  return enabled ? `valves.${id}!` : `valves.stop.${id}!`;
}

export function pumpStatusSubject(host: DrinkxHost): string {
  return `pumps.status.${host}`;
}

export function pumpCommandSubject(host: DrinkxHost): string {
  return `pumps.${host}!`;
}

export function pumpStopSubject(host: DrinkxHost): string {
  return `pumps.stop.${host}!`;
}

export type PumpDirection = "forward" | "reverse";

/** Payload для pumps.{host}! — reverse поддерживается с cm-drv direction/reverse. */
export function pumpCommandPayload(input: {
  durationMs: number;
  powerPercent: number;
  direction?: PumpDirection;
}): Record<string, unknown> {
  const direction = input.direction ?? "forward";
  return {
    duration: input.durationMs,
    power: pumpPowerToPwm(input.powerPercent),
    direction,
    reverse: direction === "reverse",
  };
}

export function heaterStatusSubject(host: DrinkxHost, heaterId: string): string {
  return `heaters.status.${host}-${heaterId}`;
}

export function heaterCommandSubject(host: DrinkxHost, heaterId: string): string {
  return `heaters.${host}-${heaterId}!`;
}

export function heaterStopSubject(host: DrinkxHost, heaterId: string): string {
  return `heaters.stop.${host}-${heaterId}!`;
}

/** UI power 0–100 → PWM 0–255. */
export function pumpPowerToPwm(powerPercent: number): number {
  const p = Math.max(0, Math.min(100, powerPercent));
  return Math.round(p * 2.55);
}

export function extractEnabledState(statusResponse: unknown): boolean | null {
  if (!statusResponse || typeof statusResponse !== "object") return null;
  const r = statusResponse as Record<string, unknown>;
  const result =
    r.result && typeof r.result === "object"
      ? (r.result as Record<string, unknown>)
      : null;

  const direct = r.enabled ?? result?.enabled;
  if (typeof direct === "boolean") return direct;

  const nested =
    result?.result && typeof result.result === "object"
      ? (result.result as Record<string, unknown>).enabled
      : undefined;
  if (typeof nested === "boolean") return nested;

  const status = r.status ?? result?.status;
  if (typeof status === "boolean") return status;
  if (typeof status === "number") return status !== 0;
  return null;
}

function normalizeSensorEntry(
  name: unknown,
  value: unknown,
  extra: Record<string, unknown> = {}
): { name: string; value: unknown; type?: string } {
  return {
    name: String(name ?? ""),
    value,
    type: typeof extra.type === "string" ? extra.type : undefined,
    ...extra,
  };
}

function extractSensorsFromContainer(
  container: unknown
): Array<{ name: string; value: unknown; type?: string }> {
  if (!container) return [];
  if (Array.isArray(container)) {
    return container.map((item) => {
      if (item && typeof item === "object") {
        const o = item as Record<string, unknown>;
        return normalizeSensorEntry(o.name, o.value, o);
      }
      return normalizeSensorEntry("", item);
    });
  }
  if (typeof container === "object") {
    return Object.entries(container as Record<string, unknown>).map(
      ([name, value]) => {
        if (value && typeof value === "object" && !Array.isArray(value)) {
          const o = value as Record<string, unknown>;
          return normalizeSensorEntry(o.name || name, o.value, o);
        }
        return normalizeSensorEntry(name, value);
      }
    );
  }
  return [];
}

export function extractStatusSensors(
  statusResponse: unknown,
  host?: DrinkxHost | null
): Array<{ name: string; value: unknown; type?: string }> {
  if (!statusResponse || typeof statusResponse !== "object") return [];
  const r = statusResponse as Record<string, unknown>;
  const result =
    r.result && typeof r.result === "object"
      ? (r.result as Record<string, unknown>)
      : null;
  const statusNest =
    r.status && typeof r.status === "object"
      ? (r.status as Record<string, unknown>)
      : null;
  const resultStatus =
    result?.status && typeof result.status === "object"
      ? (result.status as Record<string, unknown>)
      : null;
  const hostKey = host ? `${host}Sensors` : null;

  const candidates = [
    r.sensors,
    result?.sensors,
    hostKey ? r[hostKey] : null,
    hostKey && result ? result[hostKey] : null,
    r.thermometers,
    result?.thermometers,
    hostKey && statusNest ? statusNest[hostKey] : null,
    hostKey && resultStatus ? resultStatus[hostKey] : null,
  ];

  for (const c of candidates) {
    const sensors = extractSensorsFromContainer(c);
    if (sensors.length > 0) return sensors;
  }
  return [];
}

export function normalizeTempKey(name: string): TempSensorKey | null {
  const n = name.toLowerCase();
  for (const key of TEMP_SENSOR_ORDER) {
    if (n === key || n.endsWith(key) || n.endsWith(key.replace("_", ""))) {
      return key;
    }
  }
  if (n.includes("input") || n.endsWith("_in") || n === "in") return "input";
  if (n.includes("heater1") && n.includes("over")) return "heater1_overheat";
  if (n.includes("heater2") && n.includes("over")) return "heater2_overheat";
  if (n.includes("heater1") && n.includes("out")) return "heater1_out";
  if (n.includes("heater2") && n.includes("out")) return "heater2_out";
  return null;
}

export function extractTempMap(
  statusResponse: unknown,
  host?: DrinkxHost | null
): Partial<Record<TempSensorKey, number>> {
  const out: Partial<Record<TempSensorKey, number>> = {};
  for (const s of extractStatusSensors(statusResponse, host)) {
    if (s.type && s.type !== "temp") continue;
    const key = normalizeTempKey(s.name);
    const num = Number(s.value);
    if (key && Number.isFinite(num)) out[key] = num;
  }
  return out;
}

/** Счётчик тиков флоуметра (water). */
export function extractWaterTotalPulses(
  statusResponse: unknown,
  host: DrinkxHost = "water"
): number | null {
  const sensors = extractStatusSensors(statusResponse, host);
  for (const sensor of sensors) {
    const normalizedName = String(sensor?.name || "")
      .replace(/\s+/g, "")
      .replace(/[{}]/g, "")
      .toLowerCase();
    if (
      normalizedName.endsWith("total_pulses") ||
      normalizedName.endsWith("flowmeter_total_pulses") ||
      normalizedName.endsWith("water_total_pulses") ||
      normalizedName.endsWith("pulses")
    ) {
      const n = Number(sensor.value);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

/**
 * Давление воды (bar) из status sensors.
 * cm-drv: `{ name: `${dxRole}_water_pressure`, type: "pressure", value }`.
 */
export function extractWaterPressure(
  statusResponse: unknown,
  host: DrinkxHost = "water"
): number | null {
  const sensors = extractStatusSensors(statusResponse, host);
  for (const sensor of sensors) {
    const type = String(sensor?.type || "").toLowerCase();
    const normalizedName = String(sensor?.name || "")
      .replace(/\s+/g, "")
      .replace(/[{}]/g, "")
      .toLowerCase();
    const byType = type === "pressure";
    const byName =
      normalizedName.endsWith("water_pressure") ||
      normalizedName === "water_pressure" ||
      normalizedName.endsWith("_pressure") ||
      normalizedName === "pressure";
    if (!byType && !byName) continue;
    const n = Number(sensor.value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Ток насоса (pump_R_IS) — deep-search в status.
 * cm-drv getStatus обычно не кладёт R_IS в sensors; ищем ключи в дереве.
 */
export function extractPumpCurrent(statusResponse: unknown): number | null {
  if (statusResponse == null) return null;

  for (const sensor of extractStatusSensors(statusResponse)) {
    const normalizedName = String(sensor?.name || "")
      .replace(/\s+/g, "")
      .replace(/[{}]/g, "")
      .toLowerCase();
    if (
      normalizedName.endsWith("pump_r_is") ||
      normalizedName === "pump_r_is" ||
      normalizedName.endsWith("pump_current") ||
      normalizedName.includes("pump_r_is")
    ) {
      const n = Number(sensor.value);
      if (Number.isFinite(n)) return n;
    }
  }

  const found: number[] = [];
  const walk = (node: unknown, keyHint: string): void => {
    if (node == null) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, keyHint);
      return;
    }
    if (typeof node !== "object") return;
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      const lk = k.toLowerCase();
      if (
        lk === "pump_r_is" ||
        lk === "pumpr_is" ||
        lk.endsWith("_pump_r_is") ||
        lk === "pumpcurrent"
      ) {
        const n = Number(v);
        if (Number.isFinite(n)) found.push(n);
      } else if (v && typeof v === "object") {
        walk(v, lk);
      }
    }
  };
  walk(statusResponse, "");
  return found.length > 0 ? found[0]! : null;
}

export const FLOW_CALIBRATION_QTYS = [100, 200, 300, 400] as const;
export const FLOW_CALIBRATION_SWITCH_DELAY_MS = 4300;
export const FLOW_CALIBRATION_BREW_TIMEOUT_MS = 90_000;
export const FLOW_CALIBRATION_PULSES_POLL_MS = 200;

export function expectedTempKeys(host: DrinkxHost): TempSensorKey[] {
  if (host === "water") {
    return TEMP_SENSOR_ORDER.filter((k) => !k.includes("overheat"));
  }
  return [...TEMP_SENSOR_ORDER];
}

export function milkSystemValveNumbers(): Array<{
  index: number;
  valveNumber: number;
  label: string;
  isCommon: boolean;
}> {
  const items = [];
  for (let i = 0; i < 5; i++) {
    items.push({
      index: i,
      valveNumber: i + 1,
      label: `Молочный клапан ${i + 1}`,
      isCommon: false,
    });
  }
  items.push({
    index: 5,
    valveNumber: 6,
    label: VALVE_LABELS.commonValve,
    isCommon: true,
  });
  return items;
}
