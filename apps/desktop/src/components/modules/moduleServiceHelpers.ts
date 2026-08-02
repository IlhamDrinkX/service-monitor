import { MODULE_VALVES, type DrinkxHost } from "@service-monitor/core";

/** Valve opened during flush milk/water for the active host. */
export function flushOpenValve(
  host: DrinkxHost,
  kind: "milk" | "water"
): string {
  if (kind === "water") {
    return MODULE_VALVES[host].includes("waterInput")
      ? "waterInput"
      : "milkInput";
  }
  return "milkInput";
}

export function isFoamTempValid(temp: number): boolean {
  return temp >= 20 && temp <= 95;
}
