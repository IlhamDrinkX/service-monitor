import { milkSystemValveNumbers } from "@service-monitor/core";
import type { EnabledMap } from "../../lab/modulesLab/modulesLabTypes";

/** Open milk-system valve numbers after an optimistic toggle of one valve. */
export function milkValveOpenNumbers(
  milkValves: EnabledMap,
  toggledNumber: number,
  nextEnabled: boolean
): number[] {
  return milkSystemValveNumbers()
    .map((v) => v.valveNumber)
    .filter((n) =>
      n === toggledNumber ? nextEnabled : milkValves[String(n)] === true
    );
}
