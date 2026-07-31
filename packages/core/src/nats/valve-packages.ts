/**
 * Пресеты пакетного теста клапанов (Modules Lab #11).
 */

import { MODULE_VALVES, type DrinkxHost } from "./module-devices.js";

export type ValveStep = {
  valveId: string;
  enabled: boolean;
  holdMs: number;
};

export type ValvePackageId =
  | "sequential_cycle"
  | "all_open_hold_close"
  | "inputs_only";

export type ValvePackage = {
  id: ValvePackageId;
  label: string;
  stepsFor: (host: DrinkxHost) => ValveStep[];
};

const INPUT_VALVES = new Set(["milkInput", "waterInput"]);

function cycleValve(valveId: string): ValveStep[] {
  return [
    { valveId, enabled: true, holdMs: 800 },
    { valveId, enabled: false, holdMs: 400 },
  ];
}

export const VALVE_PACKAGES: ValvePackage[] = [
  {
    id: "sequential_cycle",
    label: "По очереди open→close",
    stepsFor(host) {
      const steps: ValveStep[] = [];
      for (const valveId of MODULE_VALVES[host]) {
        steps.push(...cycleValve(valveId));
      }
      return steps;
    },
  },
  {
    id: "all_open_hold_close",
    label: "Все open → hold → close",
    stepsFor(host) {
      const valves = MODULE_VALVES[host];
      const steps: ValveStep[] = [];
      for (const valveId of valves) {
        steps.push({ valveId, enabled: true, holdMs: 0 });
      }
      if (steps.length > 0) {
        steps[steps.length - 1] = {
          ...steps[steps.length - 1]!,
          holdMs: 2000,
        };
      }
      for (const valveId of valves) {
        steps.push({ valveId, enabled: false, holdMs: 0 });
      }
      return steps;
    },
  },
  {
    id: "inputs_only",
    label: "Только вводы",
    stepsFor(host) {
      const steps: ValveStep[] = [];
      for (const valveId of MODULE_VALVES[host]) {
        if (!INPUT_VALVES.has(valveId)) continue;
        steps.push(...cycleValve(valveId));
      }
      return steps;
    },
  },
];

export function getValvePackage(id: ValvePackageId): ValvePackage | undefined {
  return VALVE_PACKAGES.find((p) => p.id === id);
}
