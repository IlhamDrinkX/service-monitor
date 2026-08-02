/**
 * Pure NATS / muster helpers for Modules Lab shell.
 */

import { defaultHwid, type DrinkxHost, type NatsMusterEntry } from "@service-monitor/core";

/** First muster entry matching host default / role / hwid substring. */
export function findMusterEntryForHost(
  modules: NatsMusterEntry[],
  host: DrinkxHost
): NatsMusterEntry | undefined {
  return modules.find(
    (m) =>
      m.hwid === defaultHwid(host) ||
      m.role === host ||
      (m.hwid ?? "").includes(host)
  );
}

/** Prefer explicit muster hwid match; otherwise undefined (caller may resolveHwid). */
export function matchMusterHwid(
  modules: NatsMusterEntry[],
  host: DrinkxHost
): string | undefined {
  return findMusterEntryForHost(modules, host)?.hwid;
}

/** Open valve numbers from complexos.valves.switched payload. */
export function parseValvesSwitchedNumbers(data: unknown): number[] {
  const rawValves = (data as { valves?: unknown } | null)?.valves;
  if (!Array.isArray(rawValves)) return [];
  return rawValves.map((x) => Number(x)).filter((n) => Number.isFinite(n));
}
