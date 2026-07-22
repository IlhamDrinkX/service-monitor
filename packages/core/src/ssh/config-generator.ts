/**
 * Генерация фрагментов ~/.ssh/config для комплекса.
 * Эталон LocalForward: модули на :8000, complexos/router на :80.
 *
 * Важно: блок ERP jump (Host erp.fibbee.com / User tun) добавляется
 * только если его ещё нет в файле. Новый комплекс — только Host <port>.
 */

import {
  COMPLEX_SSH_USER,
  DEFAULT_LAN_MAP,
  ERP_JUMP_HOST,
  ERP_JUMP_USER,
} from "../domain/lan-map.js";
import type { ComplexProfile } from "../domain/types.js";

export interface SshConfigGenerateOptions {
  profile: ComplexProfile;
  /** Абсолютный путь к IdentityFile. */
  identityFile: string;
  /**
   * Для snippet: включить jump-блок.
   * По умолчанию false — только Host комплекса.
   * При merge jump добавляется автоматически, только если его ещё нет.
   */
  includeJumpHost?: boolean;
}

/** Есть ли в config рабочий шлюз erp.fibbee.com. */
export function hasErpJumpHost(config: string): boolean {
  const normalized = config.replace(/\r\n/g, "\n");
  return /^Host\s+erp\.fibbee\.com\b/m.test(normalized);
}

/** Блок jump-хоста — логин всегда tun. Пишется один раз на машину. */
export function renderJumpHostBlock(): string {
  return [
    "# === Подключение к ERP (шлюз) ===",
    `Host ${ERP_JUMP_HOST}`,
    `    User ${ERP_JUMP_USER}`,
    "",
  ].join("\n");
}

/**
 * Host-блок одного комплекса с пробросами портов.
 * Порядок: complexos → router → milk → coffee → water.
 */
export function renderComplexHostBlock(
  options: SshConfigGenerateOptions
): string {
  const { profile, identityFile } = options;
  const title =
    profile.seriesLabel != null
      ? `# === Комплекс №${profile.seriesLabel} (порт ${profile.sshPort}) ===`
      : `# === ${profile.name} (порт ${profile.sshPort}) ===`;

  const forwards = DEFAULT_LAN_MAP.map(
    (m) =>
      `    LocalForward 127.0.0.1:${m.localPort} ${m.ip}:${m.remotePort}`
  );

  return [
    title,
    `Host ${profile.sshPort}`,
    "    StrictHostKeyChecking no",
    `    IdentityFile ${identityFile}`,
    "    UserKnownHostsFile /dev/null",
    `    User ${COMPLEX_SSH_USER}`,
    "    HostName localhost",
    `    Port ${profile.sshPort}`,
    `    ProxyJump ${ERP_JUMP_HOST}`,
    ...forwards,
    "",
  ].join("\n");
}

/**
 * Snippet для копирования.
 * По умолчанию — только блок комплекса (без повторного jump).
 */
export function renderSshSnippet(options: SshConfigGenerateOptions): string {
  const parts: string[] = [];
  if (options.includeJumpHost === true) {
    parts.push(renderJumpHostBlock());
  }
  parts.push(renderComplexHostBlock(options));
  return parts.join("\n");
}

export interface MergeSshConfigResult {
  config: string;
  /** Был ли добавлен jump-блок в этот раз. */
  jumpHostAdded: boolean;
  /** Jump уже был в файле до merge. */
  hadJumpHost: boolean;
}

/**
 * Вставляет или заменяет Host-блок комплекса.
 * Jump erp.fibbee.com добавляется только если его ещё нет.
 */
export function mergeSshConfig(
  existing: string,
  options: SshConfigGenerateOptions
): MergeSshConfigResult {
  const block = renderComplexHostBlock(options).trimEnd() + "\n";
  const normalized = existing.replace(/\r\n/g, "\n");
  const port = options.profile.sshPort;
  const hadJumpHost = hasErpJumpHost(normalized);
  let jumpHostAdded = false;

  // Режем файл на куски по строкам `Host …` (с возможным комментарием выше).
  const hostStart = new RegExp(`^Host\\s+${port}\\b`, "m");
  if (hostStart.test(normalized)) {
    const lines = normalized.split("\n");
    const start = lines.findIndex((l) =>
      new RegExp(`^Host\\s+${port}\\b`).test(l)
    );
    let from = start;
    if (from > 0 && lines[from - 1].trim().startsWith("# ===")) {
      from -= 1;
    }
    let to = start + 1;
    while (to < lines.length && !/^Host\s+/.test(lines[to])) {
      to += 1;
    }
    let next = [
      ...lines.slice(0, from),
      ...block.trimEnd().split("\n"),
      ...lines.slice(to),
    ].join("\n");

    if (!hadJumpHost) {
      next = `${renderJumpHostBlock()}\n${next.trimStart()}`;
      jumpHostAdded = true;
    }

    return {
      config: next.endsWith("\n") ? next : `${next}\n`,
      jumpHostAdded,
      hadJumpHost,
    };
  }

  let next = normalized.trimEnd();
  if (!hadJumpHost) {
    // Первый раз: шлюз + комплекс. Повторно — только комплекс.
    next = next
      ? `${next}\n\n${renderJumpHostBlock()}`.trimStart()
      : renderJumpHostBlock().trimEnd();
    jumpHostAdded = true;
  }

  const config = `${next}\n\n${block}`.trimStart() + "\n";
  return { config, jumpHostAdded, hadJumpHost };
}

export type ServiceUrlSet = {
  dashboard: string;
  kiosk: string;
  router: string;
  /** Графики milk */
  milkCharts: string;
  /** Графики coffee */
  coffeeCharts: string;
  /** Графики water */
  waterCharts: string;
  milk: string;
  coffee: string;
  water: string;
};

/** URL через SSH LocalForward (127.0.0.1:808x). */
export function localServiceUrls(): ServiceUrlSet {
  return {
    dashboard: "http://127.0.0.1:8080/dashboard.html",
    kiosk: "http://127.0.0.1:8080/ordering/?kioskid=kiosk2",
    router: "http://127.0.0.1:8081/",
    milkCharts: "http://127.0.0.1:8082/",
    coffeeCharts: "http://127.0.0.1:8083/",
    waterCharts: "http://127.0.0.1:8084/",
    milk: "http://127.0.0.1:8082/",
    coffee: "http://127.0.0.1:8083/",
    water: "http://127.0.0.1:8084/",
  };
}

/** URL напрямую в LAN (одна Wi‑Fi сеть с комплексом). */
export function lanServiceUrls(): ServiceUrlSet {
  return {
    dashboard: "http://192.168.1.43/dashboard.html",
    kiosk: "http://192.168.1.43/ordering/?kioskid=kiosk2",
    router: "http://192.168.1.1/",
    milkCharts: "http://192.168.1.44:8000/",
    coffeeCharts: "http://192.168.1.45:8000/",
    waterCharts: "http://192.168.1.46:8000/",
    milk: "http://192.168.1.44:8000/",
    coffee: "http://192.168.1.45:8000/",
    water: "http://192.168.1.46:8000/",
  };
}

/** URL по режиму сессии. */
export function serviceUrlsForMode(
  mode: "remote" | "local" | null | undefined
): ServiceUrlSet {
  return mode === "local" ? lanServiceUrls() : localServiceUrls();
}
