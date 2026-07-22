/**
 * Парсинг ARP / ip neigh (чистые функции для тестов и desktop).
 */

import { DEFAULT_LAN_MAP } from "../domain/lan-map.js";
import type { NetworkDevice } from "../domain/types.js";

/** Держим «другие» устройства дольше — heartbeat не должен их стирать. */
export const DISCOVERY_STICKY_TTL_MS = 30 * 60_000;

export type NeighborEntry = {
  ip: string;
  mac: string | null;
  /** DNS /hosts / mDNS, если удалось узнать. */
  hostname?: string | null;
};

export type StickyNeighbor = NeighborEntry & { lastSeenAt: number };

function normalizeMac(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const m = raw.trim().toLowerCase();
  if (!/^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/.test(m)) return null;
  if (m === "00:00:00:00:00:00" || m === "00-00-00-00-00-00") return null;
  return m.replace(/-/g, ":");
}

/** Имена из /etc/hosts, getent, avahi (строки вида `192.168.1.28 name`). */
export function parseNeighborHostnames(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of raw.split(/\r?\n/)) {
    if (/lladdr|REACHABLE|STALE|DELAY|FAILED|incomplete|PROBE/i.test(line)) {
      continue;
    }
    // /proc/net/arp: IP HW type Flags HW address …
    if (/^\s*192\.168\.1\.\d{1,3}\s+0x/i.test(line)) continue;

    const m = line.match(/^\s*(192\.168\.1\.\d{1,3})\s+(\S+)/);
    if (!m) continue;
    const ip = m[1];
    const last = Number(ip.split(".")[3]);
    if (last <= 0 || last >= 255) continue;
    let name = m[2].replace(/\.$/, "");
    if (!name || name === "*" || /^0x/i.test(name)) continue;
    if (normalizeMac(name)) continue;
    // Отбросить чисто числовые «флаги» arp
    if (/^\d+$/.test(name)) continue;
    map.set(ip, name);
  }
  return map;
}

export function parseNeighbors(raw: string): NeighborEntry[] {
  const byIp = new Map<string, NeighborEntry>();
  const hostnames = parseNeighborHostnames(raw);

  for (const line of raw.split(/\r?\n/)) {
    // FAILED / incomplete без lladdr — не устройство, а мусор ARP
    if (/\b(FAILED|INCOMPLETE)\b/i.test(line) && !/lladdr/i.test(line)) {
      continue;
    }
    const ipMatch = line.match(/\b(192\.168\.1\.\d{1,3})\b/);
    if (!ipMatch) continue;
    const ip = ipMatch[1];
    const last = Number(ip.split(".")[3]);
    if (last <= 0 || last >= 255) continue;

    let mac: string | null = null;
    const ll = line.match(/lladdr\s+([0-9A-Fa-f:.-]+)/i);
    if (ll) mac = normalizeMac(ll[1]);
    if (!mac) {
      const arp = line.match(
        /\b([0-9A-Fa-f]{2}[:-][0-9A-Fa-f]{2}[:-][0-9A-Fa-f]{2}[:-][0-9A-Fa-f]{2}[:-][0-9A-Fa-f]{2}[:-][0-9A-Fa-f]{2})\b/
      );
      if (arp) mac = normalizeMac(arp[1]);
    }
    // Только реальные L2-соседи complexos (с MAC). Без MAC не берём.
    if (!mac) continue;

    const prev = byIp.get(ip);
    if (!prev || (!prev.mac && mac)) {
      byIp.set(ip, {
        ip,
        mac,
        hostname: hostnames.get(ip) ?? prev?.hostname ?? null,
      });
    } else if (prev && !prev.hostname && hostnames.has(ip)) {
      byIp.set(ip, { ...prev, hostname: hostnames.get(ip) });
    }
  }

  for (const [ip, entry] of byIp) {
    if (!entry.hostname && hostnames.has(ip)) {
      byIp.set(ip, { ...entry, hostname: hostnames.get(ip)! });
    }
  }

  return [...byIp.values()].sort(
    (a, b) => Number(a.ip.split(".")[3]) - Number(b.ip.split(".")[3])
  );
}

export function updateStickyNeighbors(
  sticky: Map<string, StickyNeighbor>,
  neighbors: NeighborEntry[],
  nowMs: number = Date.now(),
  ttlMs: number = DISCOVERY_STICKY_TTL_MS
): Map<string, StickyNeighbor> {
  const knownMapIps = new Set(DEFAULT_LAN_MAP.map((e) => e.ip));

  for (const n of neighbors) {
    if (knownMapIps.has(n.ip)) continue;
    if (!n.mac) continue; // только устройства с MAC из neigh complexos
    const prev = sticky.get(n.ip);
    sticky.set(n.ip, {
      ip: n.ip,
      mac: n.mac || prev?.mac || null,
      hostname: n.hostname || prev?.hostname || null,
      lastSeenAt: nowMs,
    });
  }

  for (const [ip, entry] of sticky) {
    if (!entry.mac || nowMs - entry.lastSeenAt > ttlMs) sticky.delete(ip);
  }
  return sticky;
}

export function mergeDiscoveredDevices(
  probed: NetworkDevice[],
  sticky: Map<string, StickyNeighbor>,
  neighbors: NeighborEntry[],
  nowMs: number = Date.now()
): NetworkDevice[] {
  updateStickyNeighbors(sticky, neighbors, nowMs);
  const knownMapIps = new Set(DEFAULT_LAN_MAP.map((e) => e.ip));
  const seenNow = new Set(
    neighbors.filter((n) => !knownMapIps.has(n.ip)).map((n) => n.ip)
  );

  const extras: NetworkDevice[] = [...sticky.values()]
    .sort((a, b) => Number(a.ip.split(".")[3]) - Number(b.ip.split(".")[3]))
    .map((e) => ({
      hostname: e.hostname || e.mac || e.ip,
      ip: e.ip,
      role: "unknown" as const,
      online: seenNow.has(e.ip),
      mac: e.mac,
      lastSeenAt: new Date(e.lastSeenAt).toISOString(),
    }));

  return [...probed, ...extras];
}

/** Подмешать sticky «другие» к свежему HTTP-probe (без нового ARP). */
export function attachStickyExtras(
  probed: NetworkDevice[],
  sticky: Map<string, StickyNeighbor>,
  nowMs: number = Date.now()
): NetworkDevice[] {
  return mergeDiscoveredDevices(probed, sticky, [], nowMs);
}

/** Краткий diff ключей верхнего уровня JSON для UI Stage 4. */
export function summarizeJsonDiff(
  beforeText: string,
  afterText: string
): string[] {
  try {
    const a = JSON.parse(beforeText) as Record<string, unknown>;
    const b = JSON.parse(afterText) as Record<string, unknown>;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    const changes: string[] = [];
    for (const k of [...keys].sort()) {
      const sa = JSON.stringify(a[k]);
      const sb = JSON.stringify(b[k]);
      if (sa === sb) continue;
      if (a[k] === undefined) changes.push(`+ ${k}`);
      else if (b[k] === undefined) changes.push(`− ${k}`);
      else changes.push(`~ ${k}`);
    }
    return changes;
  } catch {
    return ["(невалидный JSON — diff недоступен)"];
  }
}
