/**
 * Pure helpers for telemetry → UI mirrors / milk-system maps.
 */

import type { EnabledMap } from "./modulesLabTypes";

export function milkValvesMapFromOpen(
  open: Iterable<number>,
  prev: EnabledMap = {}
): EnabledMap {
  const set = open instanceof Set ? open : new Set(open);
  const next: EnabledMap = { ...prev };
  for (let n = 1; n <= 6; n++) {
    next[String(n)] = set.has(n);
  }
  return next;
}

export function milkValvesMapFromOpenList(open: number[]): EnabledMap {
  const next: EnabledMap = {};
  for (let n = 1; n <= 6; n++) next[String(n)] = open.includes(n);
  return next;
}
