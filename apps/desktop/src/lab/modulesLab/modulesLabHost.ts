import {
  DRINKX_HOSTS,
  defaultHwid,
  type DrinkxHost,
  type NatsMusterEntry,
} from "@service-monitor/core";

export function resolveHwid(
  target: DrinkxHost,
  modules: NatsMusterEntry[]
): string {
  const match = modules.find(
    (m) =>
      m.hwid === defaultHwid(target) ||
      m.role === target ||
      (m.hwid ?? "").includes(target)
  );
  return match?.hwid || defaultHwid(target);
}

/** Если текущий модуль не в muster — берём первый онлайн (coffee → water → milk). */
export function pickHostFromMuster(
  modules: NatsMusterEntry[],
  current: DrinkxHost
): DrinkxHost {
  const online = new Set<DrinkxHost>();
  for (const m of modules) {
    for (const h of DRINKX_HOSTS) {
      if (
        m.role === h ||
        m.hwid === defaultHwid(h) ||
        (m.hwid ?? "").toLowerCase().includes(h)
      ) {
        online.add(h);
      }
    }
  }
  if (online.size === 0 || online.has(current)) return current;
  for (const h of ["coffee", "water", "milk"] as DrinkxHost[]) {
    if (online.has(h)) return h;
  }
  return current;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
