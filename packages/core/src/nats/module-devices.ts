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
  msValve1: "Молочный клапан 1",
  msValve2: "Молочный клапан 2",
  msValve3: "Молочный клапан 3",
  msValve4: "Молочный клапан 4",
  msValve5: "Молочный клапан 5",
  msValve6: "Сливной клапан (блок №6)",
};

/** Логические id холодильных клапанов (complexos.valves.switched / status.*Valves). */
export const MILK_SYSTEM_VALVE_IDS = [
  "msValve1",
  "msValve2",
  "msValve3",
  "msValve4",
  "msValve5",
  "msValve6",
] as const;

export type MilkSystemValveId = (typeof MILK_SYSTEM_VALVE_IDS)[number];

export function milkSystemValveId(valveNumber: number): MilkSystemValveId | null {
  if (valveNumber < 1 || valveNumber > 6) return null;
  return `msValve${valveNumber}` as MilkSystemValveId;
}

export function milkSystemValveNumber(id: string): number | null {
  const m = /^msValve(\d+)$/.exec(id);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 6 ? n : null;
}

/**
 * Открытые клапаны холодильника/рецепта из coffeemachine.status.
 * Facade: milkValves / coffeeValves; real-cm: valves (number[]).
 */
export function extractOpenValveNumbers(statusResponse: unknown): number[] | null {
  if (!statusResponse || typeof statusResponse !== "object") return null;
  const r = statusResponse as Record<string, unknown>;
  const result =
    r.result && typeof r.result === "object"
      ? (r.result as Record<string, unknown>)
      : null;
  const src = result ?? r;
  const candidates = [
    src.milkValves,
    src.coffeeValves,
    src.waterValves,
    src.valves,
    result?.milkValves,
    result?.coffeeValves,
  ];
  for (const c of candidates) {
    if (!Array.isArray(c)) continue;
    const nums = c
      .map((x) => Number(x))
      .filter((n) => Number.isFinite(n) && n >= 0);
    return nums;
  }
  return null;
}

/**
 * Объединить списки открытых клапанов (milk+coffee facade / bus) → UI 1…6.
 *
 * Нумерация ERP (cm-drv valves-v2 + dump-devices milk-N):
 * - bus `complexos.valves.switched` / valves.read() — индексы после unOffset;
 *   milk-1 в osconfig = `[1]`, milk-2 = `[2]`, … (канал 0 часто не используется).
 * - UI «Молочный клапан N» = тот же номер N, что в milk-N.valves / debug-valves.
 *
 * Конвертим +1 **только** если в списке есть `0` (явный 0-based набор).
 * Старый эвристический `every <= 5 → +1` ломал отображение: bus `[1]` → UI «2»
 * (клик по 1 зажигал лампу 2; закрытие «2» слало [2] и не гасило канал 1).
 */
export function mergeOpenValveNumbers(
  ...lists: Array<number[] | null | undefined>
): number[] {
  const raw: number[] = [];
  for (const list of lists) {
    if (!list) continue;
    for (const n of list) {
      if (Number.isFinite(n) && n >= 0) raw.push(n);
    }
  }
  if (raw.length === 0) return [];
  const zeroBased = raw.some((n) => n === 0);
  const set = new Set<number>();
  for (const n of raw) {
    const ui = zeroBased ? n + 1 : n;
    if (ui >= 1 && ui <= 6) set.add(ui);
  }
  return [...set].sort((a, b) => a - b);
}

/** HW/NATS index для debug-valves / milk.valves — совпадает с UI номером (milk-N → N). */
export function milkSystemValveHwIndex(valveNumber: number): number | null {
  if (valveNumber < 1 || valveNumber > 6) return null;
  return valveNumber;
}

/** Ответ expose с { error: true } (facade debug-valves Not implemented и т.п.). */
export function natsReplyIsError(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const r = data as Record<string, unknown>;
  if (r.error === true) return true;
  if (r.success === false) return true;
  return false;
}

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

export type HeaterStatusSnap = {
  enabled: boolean | null;
  target: number | null;
  temperature: number | null;
  mode: string | null;
};

function unwrapStatusRecord(
  statusResponse: unknown
): Record<string, unknown> | null {
  if (!statusResponse || typeof statusResponse !== "object") return null;
  const r = statusResponse as Record<string, unknown>;
  const result =
    r.result && typeof r.result === "object"
      ? (r.result as Record<string, unknown>)
      : null;
  return result ?? r;
}

/**
 * Мощность насоса % из pumps.status.* ({ power: 0–100 } или PWM 0–255).
 * ERP: power = Math.round(speed/2.55); иногда speed/pwm во вложенном result.
 */
export function extractPumpPowerPercent(
  statusResponse: unknown
): number | null {
  if (!statusResponse || typeof statusResponse !== "object") return null;
  const r = unwrapStatusRecord(statusResponse);
  if (!r) return null;
  const raw = r.power ?? r.speed ?? r.pwm ?? r.Power ?? r.Speed;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  // cm-drv отдаёт уже % (speed/2.55); reverse → speed < 0 → power отрицательный.
  if (n > 100 && n <= 255) return Math.round((n / 255) * 100);
  if (n < -100 && n >= -255) return Math.round((Math.abs(n) / 255) * 100);
  // UI показывает величину %; направление — отдельно (reverse).
  if (n < 0) return Math.round(Math.min(100, Math.abs(n)));
  return Math.round(Math.min(100, n));
}

/** heaters.status.<host>-heaterN — enabled/target/temp (без output/PWM). */
export function extractHeaterStatus(
  statusResponse: unknown
): HeaterStatusSnap {
  const r = unwrapStatusRecord(statusResponse);
  if (!r) {
    return {
      enabled: null,
      target: null,
      temperature: null,
      mode: null,
    };
  }
  const enabled = extractEnabledState(statusResponse);
  const targetN = Number(r.target);
  const tempN = Number(r.temperature ?? r.lastMeasurement);
  const mode = typeof r.mode === "string" ? r.mode : null;
  return {
    enabled,
    target: Number.isFinite(targetN) ? targetN : null,
    temperature: Number.isFinite(tempN) ? tempN : null,
    mode,
  };
}

/**
 * Оценка ШИМ тэна % — fallback, когда DX UI graph недоступен.
 * ERP heaters.status НЕ отдаёт PID output.
 * Live output во время brew берём из DX UI (см. LabTelemetry applyDxCurrents);
 * после OFF не используем lastlog (залипает).
 * При OFF → 0; при ON без DX — как PidClassic.start: clamp(25…75, (target−temp)×1.5).
 */
export function estimateHeaterPwmPercent(
  enabled: boolean | null | undefined,
  target: number | null | undefined,
  temperature: number | null | undefined
): number | null {
  if (enabled === false) return 0;
  if (enabled !== true) return null;
  if (
    target == null ||
    temperature == null ||
    !Number.isFinite(target) ||
    !Number.isFinite(temperature)
  ) {
    return null;
  }
  const err = target - temperature;
  if (err <= 0) return 0;
  return Math.round(Math.min(75, Math.max(25, err * 1.5)));
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
  if (s.type && s.type !== "temp") continue; // skip *_heater*_power (type=power = temp duplicate, not PWM)
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
export function extractPumpCurrent(
  statusResponse: unknown,
  host?: DrinkxHost | null
): number | null {
  if (statusResponse == null) return null;

  const sensorLists =
    host != null
      ? [extractStatusSensors(statusResponse, host)]
      : [
          extractStatusSensors(statusResponse),
          extractStatusSensors(statusResponse, "milk"),
          extractStatusSensors(statusResponse, "coffee"),
          extractStatusSensors(statusResponse, "water"),
        ];

  for (const sensors of sensorLists) {
    for (const sensor of sensors) {
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
  id: MilkSystemValveId;
  label: string;
  isCommon: boolean;
}> {
  const items = [];
  for (let i = 0; i < 5; i++) {
    const valveNumber = i + 1;
    items.push({
      index: i,
      valveNumber,
      id: milkSystemValveId(valveNumber)!,
      label: VALVE_LABELS[`msValve${valveNumber}`] ?? `Молочный клапан ${valveNumber}`,
      isCommon: false,
    });
  }
  items.push({
    index: 5,
    valveNumber: 6,
    id: "msValve6" as MilkSystemValveId,
    label: VALVE_LABELS.msValve6,
    isCommon: true,
  });
  return items;
}
