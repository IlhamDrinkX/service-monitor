/**
 * Профиль прогрева ТЭНов (Modules Lab #12).
 */

import type { TempSensorKey } from "./module-devices.js";
import { HEATER_IDS } from "./module-devices.js";

export const HEATER_WARMUP_DEFAULTS = {
  targetC: 50,
  maxOutC: 70,
  staggerMs: 1500,
  timeoutMs: 90_000,
  overheatAbortC: 85,
  pollMs: 700,
  reachEpsilonC: 1,
  order: [...HEATER_IDS] as readonly string[],
} as const;

export function warmupSensorKey(heaterId: string): TempSensorKey | null {
  if (heaterId === "heater1") return "heater1_out";
  if (heaterId === "heater2") return "heater2_out";
  return null;
}

export function warmupOverheatKey(heaterId: string): TempSensorKey | null {
  if (heaterId === "heater1") return "heater1_overheat";
  if (heaterId === "heater2") return "heater2_overheat";
  return null;
}
