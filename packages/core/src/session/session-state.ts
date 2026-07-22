/**
 * Общая сессия комплекса (вкладка Сессия → Модули / дашборд / графики).
 * Режимы: remote (SSH jump) | local (Wi‑Fi LAN 192.168.1.x).
 */

import type { ModuleRole, NetworkDevice } from "../domain/types.js";
import { DEFAULT_LAN_MAP } from "../domain/lan-map.js";

export type SessionMode = "remote" | "local";

export type SessionFailureReason =
  | "not_connected"
  | "process_dead"
  | "expired"
  | "connect_failed"
  | "lan_unreachable";

export interface ComplexSessionSnapshot {
  connected: boolean;
  /** remote = SSH jump; local = одна сеть с комплексом. */
  mode: SessionMode | null;
  /** Серия вида 4.15 (нужна для remote). */
  seriesLabel: string | null;
  sshPort: number | null;
  startedAt: string | null;
  lastAliveAt: string | null;
  /** NATS для module_test. */
  natsUrl: string | null;
  /** Отдельный probe NATS :4222 / :14222. */
  natsOnline: boolean;
  failureReason: SessionFailureReason | null;
  /** Короткий текст для UI. */
  message: string;
  /** Статус устройств после probe. */
  devices: NetworkDevice[];
}

export const SESSION_IDLE_TTL_MS = 90_000;

/** NATS через SSH LocalForward. */
export const NATS_TUNNEL_URL = "nats://127.0.0.1:14222";
/** @deprecated alias */
export const NATS_LOCAL_URL = NATS_TUNNEL_URL;

/** NATS напрямую в LAN (local mode) — слушает на complexos. */
export const NATS_LAN_URL = "nats://192.168.1.43:4222";

export const NATS_LAN_HOST = "192.168.1.43";
export const NATS_LAN_PORT = 4222;
export const NATS_TUNNEL_HOST = "127.0.0.1";
export const NATS_TUNNEL_PORT = 14222;

/**
 * Куда слать LocalForward NATS при Remote.
 * Цель резолвится НА complexos (удалённый конец ssh).
 * Как в module_test: complexos.local:4222 ≈ 127.0.0.1:4222 на самой Pi,
 * а не 192.168.1.43 (с complexos это может быть «мимо» bind NATS).
 */
export const NATS_REMOTE_FORWARD_TARGET = "127.0.0.1:4222";

/** Роли, обязательные для «в сети с модулями». */
export const REQUIRED_LAN_ROLES: readonly ModuleRole[] = [
  "complexos",
  "milk",
  "coffee",
  "water",
];

export interface HttpProbeSpec {
  role: ModuleRole;
  hostname: string;
  ip: string;
  /** HTTP URL — TCP «connect» недостаточно (ложные online). */
  url: string;
}

export function emptyDevices(): NetworkDevice[] {
  return DEFAULT_LAN_MAP.map((entry) => ({
    hostname: entry.hostname,
    ip: entry.ip,
    role: entry.role,
    online: false,
  }));
}

export function emptySession(
  reason: SessionFailureReason = "not_connected"
): ComplexSessionSnapshot {
  return {
    connected: false,
    mode: null,
    seriesLabel: null,
    sshPort: null,
    startedAt: null,
    lastAliveAt: null,
    natsUrl: null,
    natsOnline: false,
    failureReason: reason,
    message:
      reason === "not_connected"
        ? "Сессия не установлена"
        : reason === "process_dead"
          ? "SSH-процесс завершился"
          : reason === "expired"
            ? "Сессия протухла"
            : reason === "lan_unreachable"
              ? "Нет связи с комплексом в LAN"
              : "Ошибка подключения",
    devices: emptyDevices(),
  };
}

/**
 * LAN здоров: complexos + milk + coffee + water online (HTTP) и NATS online.
 * Роутер опционален.
 */
export function isLanModulesReachable(
  devices: NetworkDevice[],
  natsOnline = true
): boolean {
  if (!natsOnline) return false;
  const byRole = new Map(devices.map((d) => [d.role, d.online]));
  return REQUIRED_LAN_ROLES.every((role) => byRole.get(role) === true);
}

export function isSessionHealthy(
  snap: ComplexSessionSnapshot,
  nowMs: number = Date.now(),
  ttlMs: number = SESSION_IDLE_TTL_MS
): boolean {
  if (!snap.connected) return false;
  if (!snap.lastAliveAt) return false;
  const last = Date.parse(snap.lastAliveAt);
  if (Number.isNaN(last)) return false;
  if (nowMs - last > ttlMs) return false;
  if (snap.mode === "local") {
    return isLanModulesReachable(snap.devices, snap.natsOnline === true);
  }
  if (snap.mode === "remote") {
    // Remote: живой туннель + NATS forward
    return snap.natsOnline === true;
  }
  return true;
}

export function shouldWarnSession(
  snap: ComplexSessionSnapshot,
  nowMs?: number
): boolean {
  return !isSessionHealthy(snap, nowMs);
}

/** HTTP-цели для Local LAN. */
export function lanHttpProbeSpecs(): HttpProbeSpec[] {
  return DEFAULT_LAN_MAP.map((e) => ({
    role: e.role,
    hostname: e.hostname,
    ip: e.ip,
    url:
      e.remotePort === 80
        ? `http://${e.ip}/`
        : `http://${e.ip}:${e.remotePort}/`,
  }));
}

/** HTTP-цели через LocalForward (Remote). */
export function tunnelHttpProbeSpecs(): HttpProbeSpec[] {
  return DEFAULT_LAN_MAP.map((e) => ({
    role: e.role,
    hostname: e.hostname,
    ip: e.ip,
    url: `http://127.0.0.1:${e.localPort}/`,
  }));
}

export function devicesFromOnlineMap(
  specs: HttpProbeSpec[],
  onlineByRole: Partial<Record<ModuleRole, boolean>>
): NetworkDevice[] {
  return specs.map((s) => ({
    hostname: s.hostname,
    ip: s.ip,
    role: s.role,
    online: onlineByRole[s.role] === true,
  }));
}

/** Путь drinkx.json на модуле (KB / module_test). */
export const DRINKX_REMOTE_PATH = "/home/pi/.config/andromeda/drinkx.json";

export function moduleLanIp(role: "milk" | "coffee" | "water"): string {
  const entry = DEFAULT_LAN_MAP.find((e) => e.role === role);
  if (!entry) throw new Error(`unknown role ${role}`);
  return entry.ip;
}
