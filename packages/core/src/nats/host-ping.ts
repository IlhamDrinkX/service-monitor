/**
 * complexos host ping — paths, unit text, status parsers, tablet targets.
 * Sibling of lab-logger (not part of onboard NATS/DX telemetry).
 */

import {
  COMPLEX_SSH_USER,
  ERP_JUMP_HOST,
  ERP_JUMP_USER,
} from "../domain/lan-map.js";
import {
  formatSshConnectFailureMessage,
  isLabLoggerSessionAllowed,
  isSeries4ForLabLogger,
  LAB_LOGGER_COMPLEXOS_LAN_IP,
  resolveLabLoggerSshTarget,
  ensureLabLoggerRingSavePath,
  parseLabLoggerRingDownloadStdout,
  stripLabLoggerSshNoise,
  type LabLoggerSshTarget,
} from "./lab-logger.js";

export const HOST_PING_VERSION = "0.2.0";

export const HOST_PING_REMOTE_ROOT = "/home/pi/sm-host-ping";
export const HOST_PING_UNIT_NAME = "sm-host-ping";
export const HOST_PING_USER_UNIT_PATH =
  "/home/pi/.config/systemd/user/sm-host-ping.service";
export const HOST_PING_USER_UNIT_REL =
  "~/.config/systemd/user/sm-host-ping.service";
export const HOST_PING_RING_REL = "data/host-ping.jsonl";
export const HOST_PING_CONFIG_REL = "config.json";
export const HOST_PING_REMOTE_BUNDLE_PATH = "/tmp/sm-host-ping-bundle.json";
export const HOST_PING_COMPLEXOS_LAN_IP = LAB_LOGGER_COMPLEXOS_LAN_IP;

export const HOST_PING_PACKAGE_FILES: readonly string[] = [
  "main.py",
  "sm_host_ping/__init__.py",
  "sm_host_ping/schema.py",
  "sm_host_ping/ring.py",
  "sm_host_ping/ping.py",
  "sm_host_ping/resolve.py",
  "sm_host_ping/config.py",
  "sm_host_ping/install_meta.py",
] as const;

export type HostPingTabletTarget = {
  ip: string;
  mac: string;
};

export type HostPingConfigJson = {
  ping_interval_sec: number;
  retain_days: number;
  max_bytes: number;
  min_free_bytes: number;
  heartbeat_hours: number;
  snapshot_minutes: number;
  data_dir: string;
  expected: Record<string, string>;
  tablet: { ip?: string; mac?: string };
};

export type HostPingUnitState = "active" | "inactive" | "failed" | "unknown";

export type HostPingStatus = {
  installed: boolean;
  remotePath: string;
  unitActive: HostPingUnitState;
  unitEnabled: boolean | null;
  processRunning: boolean;
  ringBytes: number;
  tabletIp: string | null;
  tabletMac: string | null;
  pingIntervalSec: number | null;
  retainDays: number | null;
  lines: string[];
};

const STATUS_BEGIN = "###HOST_PING###";
const STATUS_END = "###END###";

export const isSeries4ForHostPing = isSeries4ForLabLogger;
export const isHostPingSessionAllowed = isLabLoggerSessionAllowed;
export const resolveHostPingSshTarget = resolveLabLoggerSshTarget;
export type HostPingSshTarget = LabLoggerSshTarget;
export const ensureHostPingRingSavePath = ensureLabLoggerRingSavePath;
export const parseHostPingRingDownloadStdout = parseLabLoggerRingDownloadStdout;
export const stripHostPingSshNoise = stripLabLoggerSshNoise;

/**
 * OpenSSH argv for Remote host-ping (ProxyJump via ERP).
 * Same shape as lab-logger / pos-host-probe — never bare 127.0.0.1:sshPort
 * (session only LocalForwards HTTP/NATS, not complex SSH on that port).
 */
export function buildHostPingRemoteOpenSshArgs(input: {
  sshPort: number;
  identityFile: string;
  command: string;
}): string[] {
  return [
    "-T",
    "-o",
    "BatchMode=yes",
    "-o",
    "ClearAllForwardings=yes",
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "UserKnownHostsFile=/dev/null",
    "-o",
    "ConnectTimeout=15",
    "-i",
    input.identityFile,
    "-J",
    `${ERP_JUMP_USER}@${ERP_JUMP_HOST}`,
    "-p",
    String(input.sshPort),
    `${COMPLEX_SSH_USER}@localhost`,
    input.command,
  ];
}

/**
 * User-facing SSH error for host-ping: keep session-gate RU, soft-map
 * connect failures (refused/timeout/auth) like Remote session connect.
 */
export function formatHostPingSshError(raw: string): string {
  const t = stripHostPingSshNoise(raw) || raw.trim();
  if (!t) return "SSH error";
  if (
    /Нужна активная сессия|Remote-сессия без|Сессия без режима/i.test(t)
  ) {
    return t;
  }
  return formatSshConnectFailureMessage(t);
}

/** True when at least IP or MAC is non-empty after trim. */
export function hasHostPingTabletTarget(t: {
  ip?: string | null;
  mac?: string | null;
}): boolean {
  return Boolean((t.ip ?? "").trim() || (t.mac ?? "").trim());
}

/**
 * Soft-validate MAC (aa:bb:… / aa-bb-… / 12 hex). Empty string → ok (optional).
 */
export function isPlausibleMac(mac: string): boolean {
  const s = mac.trim().toLowerCase().replace(/[.\-\s]/g, ":");
  if (!s) return true;
  if (/^[0-9a-f]{12}$/.test(s.replace(/:/g, ""))) return true;
  return /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(s);
}

/**
 * Canonical lowercase aa:bb:cc:dd:ee:ff. Empty → ""; invalid → null.
 */
export function normalizeHostPingMac(mac: string): string | null {
  const raw = mac.trim();
  if (!raw) return "";
  if (!isPlausibleMac(raw)) return null;
  const hex = raw.toLowerCase().replace(/[^0-9a-f]/g, "");
  if (hex.length !== 12) return null;
  return hex.match(/.{2}/g)!.join(":");
}

export function isPlausibleIpv4(ip: string): boolean {
  const s = ip.trim();
  if (!s) return true;
  const m = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  return m.slice(1).every((p) => {
    const n = Number(p);
    return n >= 0 && n <= 255;
  });
}

export type HostPingTabletResolveOk = {
  ok: true;
  ip: string;
  mac: string;
  /** Payload keys for install / setTablet IPC. */
  tabletIp?: string;
  tabletMac?: string;
};

export type HostPingTabletResolveErr = {
  ok: false;
  error: string;
  focus: "ip" | "mac" | "both";
};

/**
 * Validate + normalize tablet targets for UI / install (no window.prompt).
 * Both empty → error (do not silent-install).
 */
export function resolveHostPingTabletTargets(input: {
  ip?: string | null;
  mac?: string | null;
}): HostPingTabletResolveOk | HostPingTabletResolveErr {
  const ip = (input.ip ?? "").trim();
  const macRaw = (input.mac ?? "").trim();
  if (!ip && !macRaw) {
    return {
      ok: false,
      error: "Укажите IP или MAC планшета (оба поля пустые)",
      focus: "both",
    };
  }
  if (ip && !isPlausibleIpv4(ip)) {
    return { ok: false, error: `Некорректный IP: ${ip}`, focus: "ip" };
  }
  const macNorm = normalizeHostPingMac(macRaw);
  if (macNorm === null) {
    return { ok: false, error: `Некорректный MAC: ${macRaw}`, focus: "mac" };
  }
  return {
    ok: true,
    ip,
    mac: macNorm,
    tabletIp: ip || undefined,
    tabletMac: macNorm || undefined,
  };
}

export function buildHostPingConfigJson(opts?: {
  tabletIp?: string | null;
  tabletMac?: string | null;
  retainDays?: number;
  pingIntervalSec?: number;
  expected?: Record<string, string>;
}): string {
  const resolved = resolveHostPingTabletTargets({
    ip: opts?.tabletIp,
    mac: opts?.tabletMac,
  });
  if (!resolved.ok) {
    throw new Error(
      resolved.focus === "both"
        ? "Нужен IP или MAC планшета"
        : resolved.error
    );
  }
  const tip = resolved.ip;
  const tmac = resolved.mac;
  const retain = opts?.retainDays ?? 14;
  if (retain < 14) {
    throw new Error("retain_days must be >= 14");
  }
  const tablet: { ip?: string; mac?: string } = {};
  if (tip) tablet.ip = tip;
  if (tmac) tablet.mac = tmac;
  const cfg: HostPingConfigJson = {
    ping_interval_sec: opts?.pingIntervalSec ?? 30,
    retain_days: retain,
    max_bytes: 5 * 1024 * 1024,
    min_free_bytes: 50 * 1024 * 1024,
    heartbeat_hours: 0,
    snapshot_minutes: 5,
    data_dir: `${HOST_PING_REMOTE_ROOT}/data`,
    expected: opts?.expected ?? {
      complexos: "192.168.1.43",
      milk: "192.168.1.44",
      coffee: "192.168.1.45",
      water: "192.168.1.46",
      router: "192.168.1.1",
      erp: "erp.fibbee.com",
      fibbee: "91.206.15.66",
      dns: "8.8.8.8",
    },
    tablet,
  };
  return `${JSON.stringify(cfg, null, 2)}\n`;
}

export function parseHostPingConfigJson(
  text: string
): Partial<HostPingConfigJson> & {
  tabletIp?: string;
  tabletMac?: string;
} | null {
  try {
    const raw = JSON.parse(text) as unknown;
    if (raw == null || typeof raw !== "object") return null;
    const o = raw as Record<string, unknown>;
    const out: Partial<HostPingConfigJson> & {
      tabletIp?: string;
      tabletMac?: string;
    } = {};
    if (typeof o.ping_interval_sec === "number")
      out.ping_interval_sec = o.ping_interval_sec;
    if (typeof o.retain_days === "number") out.retain_days = o.retain_days;
    const tab = o.tablet;
    if (tab && typeof tab === "object" && !Array.isArray(tab)) {
      const t = tab as Record<string, unknown>;
      if (typeof t.ip === "string" && t.ip.trim()) out.tabletIp = t.ip.trim();
      if (typeof t.mac === "string" && t.mac.trim()) out.tabletMac = t.mac.trim();
    }
    if (typeof o.tablet_ip === "string" && o.tablet_ip.trim())
      out.tabletIp = o.tablet_ip.trim();
    if (typeof o.tablet_mac === "string" && o.tablet_mac.trim())
      out.tabletMac = o.tablet_mac.trim();
    return out;
  } catch {
    return null;
  }
}

export function buildHostPingSystemdUserUnit(opts?: {
  root?: string;
  python?: string;
}): string {
  const root = opts?.root ?? HOST_PING_REMOTE_ROOT;
  const python = opts?.python ?? "/usr/bin/python3";
  const config = `${root}/${HOST_PING_CONFIG_REL}`;
  return `[Unit]
Description=Service Monitor host ping (LAN reachability)
After=network.target

[Service]
Type=simple
WorkingDirectory=${root}
ExecStart=${python} ${root}/main.py --config ${config}
Restart=on-failure
RestartSec=5
Nice=10

[Install]
WantedBy=default.target
`;
}

export function buildHostPingUserSystemdPrefix(): string {
  return [
    `export XDG_RUNTIME_DIR="\${XDG_RUNTIME_DIR:-/run/user/\$(id -u)}"`,
    `export DBUS_SESSION_BUS_ADDRESS="\${DBUS_SESSION_BUS_ADDRESS:-unix:path=\${XDG_RUNTIME_DIR}/bus}"`,
  ].join("; ");
}

export function buildHostPingStatusProbeCmd(opts?: { root?: string }): string {
  const root = opts?.root ?? HOST_PING_REMOTE_ROOT;
  const unit = HOST_PING_UNIT_NAME;
  const unitPath = HOST_PING_USER_UNIT_PATH;
  const config = `${root}/${HOST_PING_CONFIG_REL}`;
  const mainPy = `${root}/main.py`;
  const ring = `${root}/${HOST_PING_RING_REL}`;
  return [
    buildHostPingUserSystemdPrefix(),
    `echo '${STATUS_BEGIN}'`,
    `echo 'path=${root}'`,
    `if [ -f '${mainPy}' ] && [ -d '${root}/sm_host_ping' ]; then echo 'installed=yes'; elif [ -f '${mainPy}' ] || [ -f '${unitPath}' ]; then echo 'installed=yes'; else echo 'installed=no'; fi`,
    `echo -n 'unit_active='; systemctl --user is-active ${unit} 2>/dev/null || echo unknown`,
    `echo -n 'unit_enabled='; systemctl --user is-enabled ${unit} 2>/dev/null || echo unknown`,
    `echo -n 'proc='; (ps -C python3 -o args= 2>/dev/null; ps -C python -o args= 2>/dev/null) | grep -F '${mainPy}' | head -n 2 | tr '\\n' '|' || true; echo`,
    `echo '###CONFIG###'`,
    `if [ -f '${config}' ]; then cat '${config}'; else echo '{}'; fi`,
    `echo`,
    `echo '###RING###'`,
    `if [ -f '${ring}' ]; then echo -n 'ring_bytes='; wc -c < '${ring}'; else echo 'ring_bytes=0'; fi`,
    `echo`,
    `echo '${STATUS_END}'`,
  ].join("; ");
}

export function buildHostPingRemoteUnpackCmd(opts?: {
  bundlePath?: string;
  root?: string;
  unitPath?: string;
}): string {
  const bundle = opts?.bundlePath ?? HOST_PING_REMOTE_BUNDLE_PATH;
  const root = opts?.root ?? HOST_PING_REMOTE_ROOT;
  const unit = opts?.unitPath ?? HOST_PING_USER_UNIT_PATH;
  const script = [
    "import json, base64, sys",
    "from pathlib import Path",
    `blob = json.loads(Path(${JSON.stringify(bundle)}).read_text(encoding="utf-8"))`,
    `root = Path(str(blob.get("root") or ${JSON.stringify(root)}))`,
    "root.mkdir(parents=True, exist_ok=True)",
    "(root / 'data').mkdir(parents=True, exist_ok=True)",
    `unit = Path(${JSON.stringify(unit)})`,
    "n = 0",
    "for rel, b in blob['files'].items():",
    "    dest = unit if rel == 'sm-host-ping.service' else (root / rel)",
    "    dest.parent.mkdir(parents=True, exist_ok=True)",
    "    dest.write_bytes(base64.b64decode(b))",
    "    print('wrote', dest)",
    "    n += 1",
    "if not (root / 'main.py').is_file() or not (root / 'sm_host_ping').is_dir():",
    "    raise SystemExit('unpack incomplete: package missing')",
    "if not unit.is_file():",
    "    raise SystemExit('unpack incomplete: unit missing')",
    "print('files', n)",
    "print('OK')",
  ].join("\n");
  const pyArg = `exec(${JSON.stringify(script)})`;
  return [
    `mkdir -p /tmp '${root}/data' '/home/pi/.config/systemd/user'`,
    `test -f ${JSON.stringify(bundle)}`,
    `python3 -c ${JSON.stringify(pyArg)}`,
    `( ${buildHostPingUserSystemdPrefix()}; systemctl --user daemon-reload 2>/dev/null || true )`,
    `test -f '${root}/main.py'`,
    `test -f '${unit}'`,
    `( rm -f ${JSON.stringify(bundle)} 2>/dev/null || true )`,
    `echo UNPACK_OK`,
  ].join(" && ");
}

export function buildHostPingStartCmd(): string {
  return [
    buildHostPingUserSystemdPrefix(),
    `systemctl --user daemon-reload || true`,
    `systemctl --user start ${HOST_PING_UNIT_NAME} 2>/dev/null || true`,
    `echo OK`,
  ].join("; ");
}

export function buildHostPingEnableAutostartCmd(): string {
  return [
    buildHostPingUserSystemdPrefix(),
    `loginctl enable-linger "$(id -un)" 2>/dev/null || true`,
    `systemctl --user daemon-reload || true`,
    `systemctl --user enable ${HOST_PING_UNIT_NAME} 2>/dev/null || true`,
    `systemctl --user start ${HOST_PING_UNIT_NAME} 2>/dev/null || true`,
    `echo OK`,
  ].join("; ");
}

export function buildHostPingDisableAutostartCmd(opts?: {
  stop?: boolean;
}): string {
  const stop = opts?.stop !== false;
  return [
    buildHostPingUserSystemdPrefix(),
    stop
      ? `systemctl --user stop ${HOST_PING_UNIT_NAME} 2>/dev/null || true`
      : "true",
    `systemctl --user disable ${HOST_PING_UNIT_NAME} 2>/dev/null || true`,
    `echo OK`,
  ].join("; ");
}

export function buildHostPingRestartCmd(): string {
  return [
    buildHostPingUserSystemdPrefix(),
    `systemctl --user restart ${HOST_PING_UNIT_NAME} 2>/dev/null || true`,
    `echo OK`,
  ].join("; ");
}

export function buildHostPingUninstallCmd(opts?: {
  root?: string;
  wipeData?: boolean;
}): string {
  const root = opts?.root ?? HOST_PING_REMOTE_ROOT;
  const wipe = opts?.wipeData !== false;
  const unitPath = HOST_PING_USER_UNIT_PATH;
  return [
    buildHostPingUserSystemdPrefix(),
    `systemctl --user stop ${HOST_PING_UNIT_NAME} 2>/dev/null || true`,
    `systemctl --user disable ${HOST_PING_UNIT_NAME} 2>/dev/null || true`,
    `rm -f '${unitPath}' 2>/dev/null || true`,
    `systemctl --user daemon-reload 2>/dev/null || true`,
    `pkill -f '${root}/main.py' 2>/dev/null || true`,
    wipe
      ? `rm -rf '${root}' 2>/dev/null || true`
      : `rm -rf '${root}/main.py' '${root}/sm_host_ping' '${root}/config.json' 2>/dev/null || true`,
    `echo OK`,
  ].join("; ");
}

export function buildHostPingTailCmd(opts?: {
  root?: string;
  lines?: number;
}): string {
  const root = opts?.root ?? HOST_PING_REMOTE_ROOT;
  const n = opts?.lines ?? 40;
  const ring = `${root}/${HOST_PING_RING_REL}`;
  return [
    `echo '###TAIL###'`,
    `if [ -f '${ring}' ]; then tail -n ${n} '${ring}'; else echo ''; fi`,
    `echo '###END_TAIL###'`,
  ].join("; ");
}

export function hostPingRingDownloadFilename(now = new Date()): string {
  const y = now.getUTCFullYear();
  const mo = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const h = String(now.getUTCHours()).padStart(2, "0");
  const mi = String(now.getUTCMinutes()).padStart(2, "0");
  const s = String(now.getUTCSeconds()).padStart(2, "0");
  return `sm-host-ping-${y}${mo}${d}-${h}${mi}${s}.jsonl`;
}

function parseUnitActive(s: string): HostPingUnitState {
  const v = s.trim().toLowerCase();
  if (v === "active") return "active";
  if (v === "inactive") return "inactive";
  if (v === "failed") return "failed";
  return "unknown";
}

export function parseHostPingStatusOutput(stdout: string): HostPingStatus {
  const lines: string[] = [];
  let installed = false;
  let remotePath = HOST_PING_REMOTE_ROOT;
  let unitActive: HostPingUnitState = "unknown";
  let unitEnabled: boolean | null = null;
  let processRunning = false;
  let ringBytes = 0;
  let tabletIp: string | null = null;
  let tabletMac: string | null = null;
  let pingIntervalSec: number | null = null;
  let retainDays: number | null = null;

  const begin = stdout.indexOf(STATUS_BEGIN);
  const end = stdout.indexOf(STATUS_END);
  const body =
    begin >= 0
      ? stdout.slice(begin + STATUS_BEGIN.length, end >= 0 ? end : undefined)
      : stdout;

  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("###")) continue;
    lines.push(line);
    if (line.startsWith("path=")) remotePath = line.slice(5).trim() || remotePath;
    if (line === "installed=yes") installed = true;
    if (line === "installed=no") installed = false;
    if (line.startsWith("unit_active="))
      unitActive = parseUnitActive(line.slice("unit_active=".length));
    if (line.startsWith("unit_enabled=")) {
      const v = line.slice("unit_enabled=".length).trim().toLowerCase();
      if (v === "enabled") unitEnabled = true;
      else if (v === "disabled" || v === "static") unitEnabled = false;
      else unitEnabled = null;
    }
    if (line.startsWith("proc=") && line.length > 5) processRunning = true;
    if (line.startsWith("ring_bytes=")) {
      const n = Number.parseInt(line.slice("ring_bytes=".length).trim(), 10);
      if (Number.isFinite(n)) ringBytes = n;
    }
  }

  const configMatch = body.match(/###CONFIG###\s*([\s\S]*?)(?=###RING###|$)/);
  if (configMatch) {
    const cfg = parseHostPingConfigJson(configMatch[1]);
    if (cfg) {
      tabletIp = cfg.tabletIp ?? null;
      tabletMac = cfg.tabletMac ?? null;
      pingIntervalSec =
        typeof cfg.ping_interval_sec === "number" ? cfg.ping_interval_sec : null;
      retainDays = typeof cfg.retain_days === "number" ? cfg.retain_days : null;
    }
  }

  return {
    installed,
    remotePath,
    unitActive,
    unitEnabled,
    processRunning,
    ringBytes,
    tabletIp,
    tabletMac,
    pingIntervalSec,
    retainDays,
    lines,
  };
}

export function formatHostPingStatusLine(s: HostPingStatus): string {
  const parts: string[] = [];
  parts.push(s.installed ? "установлен" : "не установлен");
  parts.push(s.remotePath);
  parts.push(`unit=${s.unitActive}`);
  if (s.unitEnabled != null) parts.push(s.unitEnabled ? "autostart=on" : "autostart=off");
  parts.push(s.processRunning ? "proc=yes" : "proc=no");
  parts.push(`ring=${s.ringBytes}b`);
  if (s.tabletIp) parts.push(`tablet_ip=${s.tabletIp}`);
  if (s.tabletMac) parts.push(`tablet_mac=${s.tabletMac}`);
  return parts.join(" · ");
}

export function isHostPingMissingUnitError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("not found") ||
    m.includes("could not be found") ||
    m.includes("unit file") ||
    m.includes("не найден")
  );
}

export function parseHostPingTailStdout(stdout: string): string {
  const begin = stdout.indexOf("###TAIL###");
  const end = stdout.indexOf("###END_TAIL###");
  if (begin < 0) return stdout.trim();
  return stdout
    .slice(begin + "###TAIL###".length, end >= 0 ? end : undefined)
    .replace(/^\r?\n/, "")
    .trimEnd();
}

/** Normalize reachable value to RU онлайн/оффлайн (legacy 0/1 ok). */
export function formatHostPingReachableValue(value: unknown): string {
  if (value === true || value === 1 || value === "1") return "онлайн";
  if (value === false || value === 0 || value === "0") return "оффлайн";
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    if (s === "онлайн" || s === "online" || s === "up" || s === "true")
      return "онлайн";
    if (s === "оффлайн" || s === "offline" || s === "down" || s === "false")
      return "оффлайн";
    return value.trim();
  }
  return String(value ?? "");
}

/**
 * Human local time from epoch ms, or reuse `at`/`time` if already present.
 * Shape: YYYY-MM-DDTHH:MM:SS
 */
export function formatHostPingLocalAt(
  tsMs: number,
  existing?: string | null
): string {
  const ex = (existing ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/.test(ex)) {
    return ex.replace(" ", "T").slice(0, 19);
  }
  if (!Number.isFinite(tsMs)) return "";
  const d = new Date(tsMs);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * Pretty-print one jsonl line for «Показать недавние смены» / download preview.
 * Keeps unknown lines as-is. Accepts legacy value 0|1 and new онлайн|оффлайн.
 */
export function formatHostPingLogLineForDisplay(raw: string): string {
  const line = raw.trim();
  if (!line) return "";
  try {
    const data = JSON.parse(line) as Record<string, unknown>;
    if (data && typeof data === "object" && data.kind === "snapshot") {
      const ts =
        typeof data.ts === "number"
          ? data.ts
          : Number.parseFloat(String(data.ts ?? ""));
      const at = formatHostPingLocalAt(
        ts,
        typeof data.at === "string"
          ? data.at
          : typeof data.time === "string"
            ? data.time
            : null
      );
      const values =
        data.values && typeof data.values === "object" && !Array.isArray(data.values)
          ? (data.values as Record<string, unknown>)
          : {};
      const parts = Object.entries(values).map(([k, v]) => {
        const role = k.replace(/\.reachable$/, "");
        return `${role}=${formatHostPingReachableValue(v)}`;
      });
      return `${at || "?"}  snapshot  ${parts.join(" ")}`.trim();
    }
    if (
      data &&
      typeof data === "object" &&
      (data.kind === "trace" || data.name === "traceroute")
    ) {
      const ts =
        typeof data.ts === "number"
          ? data.ts
          : Number.parseFloat(String(data.ts ?? ""));
      const at = formatHostPingLocalAt(
        ts,
        typeof data.at === "string"
          ? data.at
          : typeof data.time === "string"
            ? data.time
            : null
      );
      const module = String(data.module ?? "?");
      const rawVal = String(data.value ?? "").replace(/\s+/g, " ").trim();
      const short =
        rawVal.length > 180 ? `${rawVal.slice(0, 180)}…` : rawVal;
      return `${at || "?"}  ${module}  traceroute  ${short}`.trim();
    }
    if (
      data &&
      typeof data === "object" &&
      (data.kind === "host" || data.module != null)
    ) {
      const ts =
        typeof data.ts === "number"
          ? data.ts
          : Number.parseFloat(String(data.ts ?? ""));
      const at = formatHostPingLocalAt(
        ts,
        typeof data.at === "string"
          ? data.at
          : typeof data.time === "string"
            ? data.time
            : null
      );
      const module = String(data.module ?? "?");
      const status = formatHostPingReachableValue(data.value);
      return `${at || "?"}  ${module}  ${status}`;
    }
  } catch {
    /* keep raw */
  }
  return line;
}

/** Format multi-line jsonl (tail / file) for SM UI. */
export function formatHostPingLogTextForDisplay(text: string): string {
  return text
    .split(/\r?\n/)
    .map((ln) => formatHostPingLogLineForDisplay(ln))
    .filter((ln) => ln.length > 0)
    .join("\n");
}
