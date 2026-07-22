/**
 * Эталонные адреса и LocalForward для DrinkX.
 * Источник: согласованный SSH config полевого инженера.
 */

import type { ModuleRole, NetworkDevice } from "./types.js";

/** Jump-хост ERP. Логин всегда tun. */
export const ERP_JUMP_HOST = "erp.fibbee.com";
export const ERP_JUMP_USER = "tun";

/** Пользователь SSH на комплексе / модулях. */
export const COMPLEX_SSH_USER = "pi";

/**
 * Типовой пароль модулей (полевые Pi). Ключ ERP на milk/coffee/water
 * часто не стоит — для drinkx.json используем пароль.
 */
export const MODULE_SSH_PASSWORD = "pi";

/**
 * LocalForward SSH на модули (Remote-сессия).
 * Как HTTP 8082–8084, только порт 22 → чтобы не делать nested ssh с complexos.
 */
export const MODULE_SSH_FORWARDS: ReadonlyArray<{
  role: "milk" | "coffee" | "water";
  ip: string;
  localPort: number;
}> = [
  { role: "milk", ip: "192.168.1.44", localPort: 22044 },
  { role: "coffee", ip: "192.168.1.45", localPort: 22045 },
  { role: "water", ip: "192.168.1.46", localPort: 22046 },
];

export function moduleSshLocalPort(
  role: "milk" | "coffee" | "water"
): number {
  const entry = MODULE_SSH_FORWARDS.find((e) => e.role === role);
  if (!entry) throw new Error(`unknown module role ${role}`);
  return entry.localPort;
}

/**
 * Карта эталонных IP внутри комплекса.
 * complexos:80 → дашборд/киоск; модули слушают :8000; роутер :80.
 */
export const DEFAULT_LAN_MAP: ReadonlyArray<{
  role: ModuleRole;
  hostname: string;
  ip: string;
  remotePort: number;
  localPort: number;
}> = [
  {
    role: "complexos",
    hostname: "complexos.local",
    ip: "192.168.1.43",
    remotePort: 80,
    localPort: 8080,
  },
  {
    role: "router",
    hostname: "router",
    ip: "192.168.1.1",
    remotePort: 80,
    localPort: 8081,
  },
  {
    role: "milk",
    hostname: "milk.local",
    ip: "192.168.1.44",
    remotePort: 8000,
    localPort: 8082,
  },
  {
    role: "coffee",
    hostname: "coffee.local",
    ip: "192.168.1.45",
    remotePort: 8000,
    localPort: 8083,
  },
  {
    role: "water",
    hostname: "water.local",
    ip: "192.168.1.46",
    remotePort: 8000,
    localPort: 8084,
  },
];

/** Эталонный список устройств до live-discovery. */
export function defaultNetworkDevices(): NetworkDevice[] {
  return DEFAULT_LAN_MAP.map((entry) => ({
    hostname: entry.hostname,
    ip: entry.ip,
    role: entry.role,
    online: false,
  }));
}

/**
 * Порт SSH jump по номеру серии DrinkX.
 * Пример: 4.15 → 22415 (префикс 22 + серия без точки).
 */
export function sshPortFromSeries(major: number, minor: number): number {
  if (!Number.isInteger(major) || !Number.isInteger(minor)) {
    throw new Error("series parts must be integers");
  }
  if (major < 1 || minor < 0 || minor > 99) {
    throw new Error("series out of supported range");
  }
  return 22000 + major * 100 + minor;
}
