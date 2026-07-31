/**
 * Смысловой порядок мини-графиков Modules Lab.
 *
 * milk/coffee:
 *   [overheat1] [overheat2] [input]      [pumpCurrent]
 *   [heater1]   [heater2]   [—]          [pumpPower]
 *
 * water:
 *   [input] [pressure] [pulses]
 */

import type { DrinkxHost } from "./module-devices.js";
import { parseSeriesKey } from "./lab-log.js";

const MILK_COFFEE_SLOTS: Array<string | null> = [
  "heater1_overheat",
  "heater2_overheat",
  "input",
  "pumpCurrent",
  "heater1_out",
  "heater2_out",
  null,
  "pumpPower",
];

const WATER_SLOTS: Array<string | null> = [
  "input",
  "waterPressure",
  "waterTotalPulses",
];

function localName(series: string): string {
  return parseSeriesKey(series).name;
}

/**
 * Раскладка ключей ряда для модуля: слоты сетки + «прочее» снизу.
 */
export function layoutModuleChartKeys(
  module: DrinkxHost,
  keys: string[]
): { slots: Array<string | null>; rest: string[] } {
  const forMod = keys.filter((k) => parseSeriesKey(k).module === module);
  const byLocal = new Map<string, string>();
  for (const k of forMod) {
    byLocal.set(localName(k), k);
  }

  const slotsDef =
    module === "water" ? WATER_SLOTS : MILK_COFFEE_SLOTS;
  const used = new Set<string>();
  const slots: Array<string | null> = slotsDef.map((slot) => {
    if (slot == null) return null;
    const key = byLocal.get(slot) ?? null;
    if (key) used.add(key);
    return key;
  });

  const rest = forMod.filter((k) => !used.has(k));
  return { slots, rest };
}

export function moduleChartColumns(module: DrinkxHost): number {
  return module === "water" ? 3 : 4;
}
