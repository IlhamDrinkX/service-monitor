/**
 * ComplexOS lab onboard logger — paths, unit text, status/health parsers.
 * Pure logic for SM install/control (Phase 2). No Node fs / SSH here.
 */

import { MODULE_VALVES, type DrinkxHost } from "./module-devices.js";
import {
  createLabEvent,
  LAB_EVENTS_CHART_SYNC_MAX,
  LAB_EVENTS_CHART_WINDOW_MAX,
  parseSeriesKey,
  trimLabEvents,
  type LabEvent,
  type LabEventKind,
} from "./lab-log.js";

/**
 * Cap for «Импорт лога» of a full onboard ring (.jsonl). Matches chart IPC
 * sync size so a 30–40 MB ring does not freeze the renderer / blow IPC.
 */
export const LAB_LOGGER_IMPORT_EVENTS_MAX = LAB_EVENTS_CHART_SYNC_MAX;

export const LAB_LOGGER_VERSION = "0.2.0";

/**
 * SM realtime consumer poll via SSH `curl` to localhost :8765.
 * Default 1.5s; min 1s — SSH roundtrip + curl is heavier than in-process
 * NATS dual-poll (~800ms on laptop). Going below ~1s piles up overlapping
 * SSH sessions and does not improve chart smoothness meaningfully.
 */
export const LAB_LOGGER_POLL_INTERVAL_MS_DEFAULT = 1500;
export const LAB_LOGGER_POLL_INTERVAL_MS_MIN = 1000;
export const LAB_LOGGER_POLL_INTERVAL_MS_MAX = 10_000;

export function clampLabLoggerPollIntervalMs(ms: number): number {
  if (!Number.isFinite(ms)) return LAB_LOGGER_POLL_INTERVAL_MS_DEFAULT;
  const n = Math.round(ms);
  if (n < LAB_LOGGER_POLL_INTERVAL_MS_MIN) return LAB_LOGGER_POLL_INTERVAL_MS_MIN;
  if (n > LAB_LOGGER_POLL_INTERVAL_MS_MAX) return LAB_LOGGER_POLL_INTERVAL_MS_MAX;
  return n;
}

/**
 * Canonical install root on complexos.
 * Always `/home/pi/sm-lab-logger` (SSH user `pi`) — do not use bare `$HOME`
 * in status vs install (they must stay identical).
 */
export const LAB_LOGGER_REMOTE_ROOT = "/home/pi/sm-lab-logger";

export const LAB_LOGGER_UNIT_NAME = "sm-lab-logger";

/** systemd --user unit path (absolute; same home as LAB_LOGGER_REMOTE_ROOT). */
export const LAB_LOGGER_USER_UNIT_PATH =
  "/home/pi/.config/systemd/user/sm-lab-logger.service";

/** Display / docs: short unit path under pi home. */
export const LAB_LOGGER_USER_UNIT_REL =
  "~/.config/systemd/user/sm-lab-logger.service";

export const LAB_LOGGER_HTTP_PORT = 8765;

export const LAB_LOGGER_RING_REL = "data/lab-events.jsonl";

/** @deprecated Host ping is tools/complexos-host-ping — kept for old status parsers. */
export const LAB_LOGGER_AVAILABILITY_REL = "data/host-availability.jsonl";

export const LAB_LOGGER_CONFIG_REL = "config.json";

/** Relative paths packaged from tools/complexos-lab-logger. */
export const LAB_LOGGER_PACKAGE_FILES: readonly string[] = [
  "main.py",
  "sm_lab_logger/__init__.py",
  "sm_lab_logger/config.py",
  "sm_lab_logger/schema.py",
  "sm_lab_logger/ring.py",
  "sm_lab_logger/topology.py",
  "sm_lab_logger/delta.py",
  "sm_lab_logger/lock.py",
  "sm_lab_logger/watchdog.py",
  "sm_lab_logger/devices.py",
  "sm_lab_logger/dx_ui.py",
  "sm_lab_logger/mini_nats.py",
  "sm_lab_logger/poller.py",
  "sm_lab_logger/runner.py",
  "sm_lab_logger/http_api.py",
  "requirements.txt",
] as const;

export type LabLoggerConfigJson = {
  retain_hours: number;
  interval_ms: number;
  heartbeat_sec: number;
  http_port: number;
  data_dir: string;
  profile: string;
  fake_source?: boolean;
  expected?: Record<string, string>;
};

/** Telemetry backend reported by onboard `/lab/health`. */
export type LabLoggerSourceKind = "fake" | "nats" | "idle" | "unknown";

export type LabLoggerHealth = {
  ok: boolean;
  lastSampleAgeMs: number | null;
  lockHeld: boolean;
  topologyWarnings: string[];
  diskBytes: number;
  /** @deprecated Always 0 — host ping is a sibling tool. */
  availabilityDiskBytes: number;
  ticks: number;
  watchdogBackoff: boolean;
  dxAllowed: boolean;
  intervalMs: number | null;
  /** fake | nats | idle — from onboard health (Phase 1.6+). */
  source: LabLoggerSourceKind;
  raw: Record<string, unknown>;
};

export type LabLoggerUnitState = "active" | "inactive" | "failed" | "unknown";

export type LabLoggerStatus = {
  installed: boolean;
  /** Canonical remote install root (always set by parser). */
  remotePath: string;
  unitActive: LabLoggerUnitState;
  unitEnabled: boolean | null;
  processRunning: boolean;
  retainHours: number | null;
  /** From remote config.json when present. */
  fakeSource: boolean | null;
  health: LabLoggerHealth | null;
  healthError: string | null;
  pythonHint: string | null;
  lines: string[];
};

const STATUS_BEGIN = "###LAB_LOGGER###";
const STATUS_END = "###END###";

/** seriesLabel like "4.15" / "4.8" → true; "3.05" / null → false. */
export function isSeries4ForLabLogger(
  seriesLabel: string | null | undefined
): boolean {
  if (seriesLabel == null) return false;
  const m = String(seriesLabel).trim().match(/^(\d+)/);
  if (!m) return false;
  return Number(m[1]) >= 4;
}

/**
 * Lab Logger controls: Remote requires series 4.x; Local LAN DrinkX sessions
 * do not collect seriesLabel on connect — allow when Local + connected.
 */
export function isLabLoggerSessionAllowed(session: {
  connected?: boolean | null;
  mode?: string | null;
  seriesLabel?: string | null;
}): boolean {
  if (session.connected !== true) return false;
  if (session.mode === "local") return true;
  return isSeries4ForLabLogger(session.seriesLabel);
}

/** Default complexos LAN IP (DrinkX map). */
export const LAB_LOGGER_COMPLEXOS_LAN_IP = "192.168.1.43";

export type LabLoggerSshTarget =
  | { mode: "local"; host: string; port: number }
  | { mode: "remote"; sshPort: number };

/**
 * SSH target for lab-logger install/status/curl/download.
 * Local: direct pi@192.168.1.43:22 (no jump). Remote: OpenSSH via jump + series port.
 */
export function resolveLabLoggerSshTarget(
  session: {
    connected?: boolean | null;
    mode?: string | null;
    sshPort?: number | null;
  },
  complexosLanIp: string = LAB_LOGGER_COMPLEXOS_LAN_IP
): LabLoggerSshTarget {
  if (session.connected !== true) {
    throw new Error("Нужна активная сессия (вкладка Сессия)");
  }
  if (session.mode === "local") {
    return { mode: "local", host: complexosLanIp, port: 22 };
  }
  if (session.mode === "remote") {
    const sshPort = session.sshPort;
    if (sshPort == null || !Number.isFinite(sshPort)) {
      throw new Error("Remote-сессия без sshPort");
    }
    return { mode: "remote", sshPort: Number(sshPort) };
  }
  throw new Error("Сессия без режима local/remote");
}

export function buildLabLoggerConfigJson(
  opts: Partial<LabLoggerConfigJson> = {}
): string {
  const cfg: LabLoggerConfigJson = {
    retain_hours: opts.retain_hours ?? 24,
    interval_ms: opts.interval_ms ?? 200,
    heartbeat_sec: opts.heartbeat_sec ?? 2,
    http_port: opts.http_port ?? LAB_LOGGER_HTTP_PORT,
    data_dir: opts.data_dir ?? `${LAB_LOGGER_REMOTE_ROOT}/data`,
    profile: opts.profile ?? "4.x",
    // Prefer real NATS (Phase 1.6); FakeSource only via explicit --fake-source.
    fake_source: opts.fake_source ?? false,
    expected: opts.expected ?? {
      milk: "192.168.1.44",
      coffee: "192.168.1.45",
      water: "192.168.1.46",
      complexos: "192.168.1.43",
    },
  };
  if (cfg.retain_hours <= 0) {
    throw new Error("retain_hours must be > 0");
  }
  if (cfg.interval_ms < 50) {
    throw new Error("interval_ms must be >= 50");
  }
  return `${JSON.stringify(cfg, null, 2)}\n`;
}

export function parseLabLoggerConfigJson(
  text: string
): Partial<LabLoggerConfigJson> | null {
  try {
    const raw = JSON.parse(text) as unknown;
    if (raw == null || typeof raw !== "object") return null;
    const o = raw as Record<string, unknown>;
    const out: Partial<LabLoggerConfigJson> = {};
    if (typeof o.retain_hours === "number") out.retain_hours = o.retain_hours;
    if (typeof o.interval_ms === "number") out.interval_ms = o.interval_ms;
    if (typeof o.heartbeat_sec === "number") out.heartbeat_sec = o.heartbeat_sec;
    if (typeof o.http_port === "number") out.http_port = o.http_port;
    if (typeof o.data_dir === "string") out.data_dir = o.data_dir;
    if (typeof o.profile === "string") out.profile = o.profile;
    if (typeof o.fake_source === "boolean") out.fake_source = o.fake_source;
    return out;
  } catch {
    return null;
  }
}

/** systemd --user unit body (Nice=10, Restart=on-failure). */
export function buildLabLoggerSystemdUserUnit(opts?: {
  root?: string;
  httpPort?: number;
  python?: string;
  /** When true, append --fake-source (local demo only). Default: real NATS. */
  fakeSource?: boolean;
}): string {
  const root = opts?.root ?? LAB_LOGGER_REMOTE_ROOT;
  const port = opts?.httpPort ?? LAB_LOGGER_HTTP_PORT;
  const python = opts?.python ?? "/usr/bin/python3";
  const config = `${root}/config.json`;
  const fake = opts?.fakeSource === true ? " --fake-source" : "";
  return `[Unit]
Description=Service Monitor Lab onboard logger
After=network.target

[Service]
Type=simple
WorkingDirectory=${root}
ExecStart=${python} ${root}/main.py --config ${config} --http-port ${port}${fake}
Restart=on-failure
RestartSec=5
Nice=10

[Install]
WantedBy=default.target
`;
}

/**
 * Env prefix so `systemctl --user` works over non-interactive SSH
 * (XDG_RUNTIME_DIR often unset without a login session).
 */
export function buildLabLoggerUserSystemdPrefix(): string {
  return [
    `export XDG_RUNTIME_DIR="\${XDG_RUNTIME_DIR:-/run/user/\$(id -u)}"`,
    `export DBUS_SESSION_BUS_ADDRESS="\${DBUS_SESSION_BUS_ADDRESS:-unix:path=\${XDG_RUNTIME_DIR}/bus}"`,
  ].join("; ");
}

/**
 * Soft-accept status probe (markers even if some cmds fail).
 * Uses user systemd + curl localhost health.
 *
 * installed = main.py + package dir, or unit file on disk.
 * proc = python cmdline containing root/main.py only (avoids pgrep matching this probe).
 */
export function buildLabLoggerStatusProbeCmd(opts?: {
  root?: string;
  httpPort?: number;
}): string {
  const root = opts?.root ?? LAB_LOGGER_REMOTE_ROOT;
  const port = opts?.httpPort ?? LAB_LOGGER_HTTP_PORT;
  const unit = LAB_LOGGER_UNIT_NAME;
  const unitPath = LAB_LOGGER_USER_UNIT_PATH;
  const config = `${root}/${LAB_LOGGER_CONFIG_REL}`;
  const mainPy = `${root}/main.py`;
  return [
    buildLabLoggerUserSystemdPrefix(),
    `echo '${STATUS_BEGIN}'`,
    `echo 'path=${root}'`,
    `if [ -f '${mainPy}' ] && [ -d '${root}/sm_lab_logger' ]; then echo 'installed=yes'; elif [ -f '${mainPy}' ] || [ -f '${unitPath}' ]; then echo 'installed=yes'; else echo 'installed=no'; fi`,
    `echo -n 'unit_active='; systemctl --user is-active ${unit} 2>/dev/null || echo unknown`,
    `echo -n 'unit_enabled='; systemctl --user is-enabled ${unit} 2>/dev/null || echo unknown`,
    // Only python* process args — probe shell cmdline contains paths but is not python.
    `echo -n 'proc='; (ps -C python3 -o args= 2>/dev/null; ps -C python -o args= 2>/dev/null) | grep -F '${mainPy}' | head -n 2 | tr '\\n' '|' || true; echo`,
    `echo -n 'python='; (command -v python3 || true); echo`,
    `echo '###HEALTH###'`,
    // stdout only; stderr discarded so banners don't poison JSON extraction
    `curl -sS --max-time 2 http://127.0.0.1:${port}/lab/health 2>/dev/null || echo '{}'`,
    `echo`,
    `echo '###CONFIG###'`,
    `if [ -f '${config}' ]; then cat '${config}'; else echo '{}'; fi`,
    `echo`,
    `echo '${STATUS_END}'`,
  ].join("; ");
}

export function buildLabLoggerHealthCurlCmd(opts?: {
  httpPort?: number;
}): string {
  const port = opts?.httpPort ?? LAB_LOGGER_HTTP_PORT;
  // -sS: silent body, errors on stderr (caller should keep stderr separate)
  return `curl -sS --max-time 3 http://127.0.0.1:${port}/lab/health`;
}

/** Remote path for stdin-uploaded install bundle (JSON with base64 file map). */
export const LAB_LOGGER_REMOTE_BUNDLE_PATH = "/tmp/sm-lab-bundle.json";

/**
 * Unpack already-uploaded bundle at LAB_LOGGER_REMOTE_BUNDLE_PATH.
 * Does not embed package bytes in the SSH argv (avoids Windows ENAMETOOLONG).
 *
 * IMPORTANT: the remote Python must use a real multi-line script via exec(...).
 * A `;`-joined `for ...:` body is a SyntaxError and previously caused false
 * UNPACK_OK with zero files written.
 */
export function buildLabLoggerRemoteUnpackCmd(opts?: {
  bundlePath?: string;
  root?: string;
  unitPath?: string;
}): string {
  const bundle = opts?.bundlePath ?? LAB_LOGGER_REMOTE_BUNDLE_PATH;
  const root = opts?.root ?? LAB_LOGGER_REMOTE_ROOT;
  const unit = opts?.unitPath ?? LAB_LOGGER_USER_UNIT_PATH;
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
    "    dest = unit if rel == 'sm-lab-logger.service' else (root / rel)",
    "    dest.parent.mkdir(parents=True, exist_ok=True)",
    "    dest.write_bytes(base64.b64decode(b))",
    "    print('wrote', dest)",
    "    n += 1",
    "if not (root / 'main.py').is_file() or not (root / 'sm_lab_logger').is_dir():",
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
    // No pip step: the agent's NatsSource uses a stdlib-only mini NATS client
    // (sm_lab_logger/mini_nats.py) — no `nats-py` / internet dependency.
    // complexos hosts typically have no route to PyPI, so the previous soft
    // `pip install --user nats-py` silently failed there, `import nats`
    // raised ImportError, and the agent fell back to an idle no-op loop
    // (source=idle, empty ring) — the exact field symptom this removal fixes.
    `( ${buildLabLoggerUserSystemdPrefix()}; systemctl --user daemon-reload 2>/dev/null || true )`,
    `test -f '${root}/main.py'`,
    `test -f '${unit}'`,
    `( rm -f ${JSON.stringify(bundle)} 2>/dev/null || true )`,
    `echo UNPACK_OK`,
  ].join(" && ");
}

export function buildLabLoggerSnapshotCurlCmd(opts?: {
  httpPort?: number;
}): string {
  const port = opts?.httpPort ?? LAB_LOGGER_HTTP_PORT;
  return `curl -sS --max-time 5 http://127.0.0.1:${port}/lab/snapshot`;
}

export function buildLabLoggerEventsCurlCmd(opts?: {
  httpPort?: number;
  fromTs?: number;
}): string {
  const port = opts?.httpPort ?? LAB_LOGGER_HTTP_PORT;
  const from = opts?.fromTs ?? 0;
  return `curl -sS --max-time 8 "http://127.0.0.1:${port}/lab/events?from=${from}"`;
}

/** Start once (no enable). Soft if unit/bus missing. */
export function buildLabLoggerStartCmd(): string {
  return [
    buildLabLoggerUserSystemdPrefix(),
    `systemctl --user daemon-reload || true`,
    `systemctl --user start ${LAB_LOGGER_UNIT_NAME} 2>/dev/null || true`,
    `echo OK`,
  ].join("; ");
}

export function buildLabLoggerEnableAutostartCmd(): string {
  return [
    buildLabLoggerUserSystemdPrefix(),
    // linger: user units survive logout / headless SSH
    `loginctl enable-linger "$(id -un)" 2>/dev/null || true`,
    `systemctl --user daemon-reload || true`,
    `systemctl --user enable ${LAB_LOGGER_UNIT_NAME} 2>/dev/null || true`,
    `systemctl --user start ${LAB_LOGGER_UNIT_NAME} 2>/dev/null || true`,
    `echo OK`,
  ].join("; ");
}

export function buildLabLoggerDisableAutostartCmd(opts?: {
  stop?: boolean;
}): string {
  const stop = opts?.stop !== false;
  const parts = [
    buildLabLoggerUserSystemdPrefix(),
    stop
      ? `systemctl --user stop ${LAB_LOGGER_UNIT_NAME} 2>/dev/null || true`
      : "true",
    `systemctl --user disable ${LAB_LOGGER_UNIT_NAME} 2>/dev/null || true`,
    `echo OK`,
  ];
  return parts.join("; ");
}

export function buildLabLoggerRestartCmd(): string {
  return [
    buildLabLoggerUserSystemdPrefix(),
    `systemctl --user restart ${LAB_LOGGER_UNIT_NAME} 2>/dev/null || true`,
    `echo OK`,
  ].join("; ");
}

/**
 * Soft uninstall: stop/disable unit, remove unit file, daemon-reload,
 * wipe entire install tree (code + data + lock). Missing paths = OK.
 *
 * `wipeData` defaults to true (always wipe). Pass false only for tests of
 * legacy partial remove — field UI always wipes everything.
 *
 * Also reverts the two side effects install/autostart leave outside
 * `root`/the unit file, so uninstall is not just "code gone, host state
 * changed forever":
 * - `loginctl disable-linger` — install/autostart-on calls `enable-linger`
 *   so the user unit survives headless SSH; leaving linger on after
 *   uninstall is a silent host-level residue (soft: best-effort, some other
 *   unrelated user unit could in theory depend on linger on a shared pi
 *   account, hence `|| true` and never treated as a failure).
 * - `pip uninstall nats-py` — install soft-installs `nats-py --user` for the
 *   real NATS adapter; remove it too so `~/.local/lib/pythonX/site-packages`
 *   does not keep growing across install/uninstall cycles.
 */
export function buildLabLoggerUninstallCmd(opts?: {
  root?: string;
  wipeData?: boolean;
}): string {
  const root = opts?.root ?? LAB_LOGGER_REMOTE_ROOT;
  const wipe = opts?.wipeData !== false;
  const unitPath = LAB_LOGGER_USER_UNIT_PATH;
  return [
    buildLabLoggerUserSystemdPrefix(),
    // Missing unit → soft success (stderr suppressed)
    `systemctl --user stop ${LAB_LOGGER_UNIT_NAME} 2>/dev/null || true`,
    `systemctl --user disable ${LAB_LOGGER_UNIT_NAME} 2>/dev/null || true`,
    `rm -f '${unitPath}' 2>/dev/null || true`,
    `systemctl --user daemon-reload 2>/dev/null || true`,
    `pkill -f '${root}/main.py' 2>/dev/null || true`,
    `loginctl disable-linger "$(id -un)" 2>/dev/null || true`,
    `(python3 -m pip uninstall -y nats-py 2>/dev/null || true)`,
    wipe
      ? `rm -rf '${root}' 2>/dev/null || true`
      : `rm -rf '${root}/main.py' '${root}/sm_lab_logger' '${root}/config.json' 2>/dev/null || true`,
    `echo OK`,
  ].join("; ");
}

/** Default download basename: `sm-lab-logger-ring-<compact>.jsonl` (no multi-dot stamp). */
export function labLoggerRingDownloadFilename(now = new Date()): string {
  const y = now.getUTCFullYear();
  const mo = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const h = String(now.getUTCHours()).padStart(2, "0");
  const mi = String(now.getUTCMinutes()).padStart(2, "0");
  const s = String(now.getUTCSeconds()).padStart(2, "0");
  // Compact stamp avoids Windows Save dialog treating mid-name dots as extension.
  return `sm-lab-logger-ring-${y}${mo}${d}-${h}${mi}${s}.jsonl`;
}

/**
 * Ensure save path ends with `.jsonl` (or `.json` only when preferredExt is json).
 * Fixes Windows dialogs that append `.txt`, strip unknown extensions, or double-ext.
 */
export function ensureLabLoggerRingSavePath(
  filePath: string,
  preferredExt: "jsonl" | "json" = "jsonl"
): string {
  let path = String(filePath ?? "").trim().replace(/[/\\]+$/, "");
  if (!path) {
    return preferredExt === "json"
      ? labLoggerRingDownloadFilename().replace(/\.jsonl$/i, ".json")
      : labLoggerRingDownloadFilename();
  }

  // Strip trailing .txt (Windows "Text Document" fallback), repeatedly.
  while (/\.txt$/i.test(path)) {
    path = path.replace(/\.txt$/i, "");
  }

  const lower = path.toLowerCase();
  const wantDot = `.${preferredExt}`;

  if (preferredExt === "jsonl") {
    // Collapse accidental doubles: name.jsonl.jsonl / name.json.jsonl
    if (/\.jsonl(\.jsonl)+$/i.test(path)) {
      return path.replace(/(\.jsonl)+$/i, ".jsonl");
    }
    if (lower.endsWith(".jsonl")) return path;
    if (lower.endsWith(".json")) {
      return `${path.slice(0, -5)}.jsonl`;
    }
    return `${path}.jsonl`;
  }

  // preferredExt === "json"
  if (/\.json(\.json)+$/i.test(path) && !lower.endsWith(".jsonl")) {
    return path.replace(/(\.json)+$/i, ".json");
  }
  if (lower.endsWith(".jsonl")) {
    return `${path.slice(0, -6)}.json`;
  }
  if (lower.endsWith(".json")) return path;
  return `${path}${wantDot}`;
}

/**
 * Parse SSH stdout from the ring download probe (`wc -c` + ###RING### + body).
 * Empty / missing ring → error (do not treat as a successful 0-byte save).
 * Kept for single-shot / legacy callers; full ring download uses chunked helpers below.
 */
export function parseLabLoggerRingDownloadStdout(
  stdout: string
):
  | { ok: true; body: string; expectedBytes: number; actualBytes: number }
  | { ok: false; error: string } {
  const marker = "###RING###";
  const idx = stdout.indexOf(marker);
  if (idx < 0) {
    return { ok: false, error: "Не удалось прочитать ring" };
  }
  const expectedBytes = Number.parseInt(stdout.slice(0, idx).trim(), 10);
  const body = stdout.slice(idx + marker.length).replace(/^\r?\n/, "");
  const actualBytes = new TextEncoder().encode(body).length;

  if (
    Number.isFinite(expectedBytes) &&
    expectedBytes > 0 &&
    actualBytes < expectedBytes
  ) {
    return {
      ok: false,
      error:
        `Скачивание оборвалось: получено ${actualBytes} из ${expectedBytes} байт ` +
        `(соединение разорвалось на середине передачи). Повторите «Скачать полный ring» — файл не сохранён.`,
    };
  }

  if (!body.trim()) {
    return {
      ok: false,
      error:
        "Ring пуст (0 байт). Retention сама по себе не объясняет пустой файл, если комплекс " +
        "писал события за окно retain_hours — проверьте статус: source=idle / proc / health age / disk=0. " +
        "Файл не сохранён.",
    };
  }

  return {
    ok: true,
    body,
    expectedBytes: Number.isFinite(expectedBytes) ? expectedBytes : actualBytes,
    actualBytes,
  };
}

/** Wire chunk size for full ring pull over SSH/ProxyJump (~2 MiB). */
export const LAB_LOGGER_RING_CHUNK_BYTES = 2 * 1024 * 1024;

/** Retries per failed chunk before aborting the whole download. */
export const LAB_LOGGER_RING_CHUNK_RETRIES = 3;

/** Soft markers for chunked ring transfer (base64 payload). */
export const LAB_LOGGER_RING_CHUNK_MARKER = "###CHUNK###";
export const LAB_LOGGER_RING_CHUNK_END = "###END###";

export type LabLoggerRingChunkRange = { offset: number; length: number };

/** Split a byte length into contiguous chunk ranges (last may be shorter). */
export function labLoggerRingChunkRanges(
  totalBytes: number,
  chunkBytes: number = LAB_LOGGER_RING_CHUNK_BYTES
): LabLoggerRingChunkRange[] {
  if (
    !Number.isFinite(totalBytes) ||
    totalBytes <= 0 ||
    !Number.isFinite(chunkBytes) ||
    chunkBytes <= 0
  ) {
    return [];
  }
  const total = Math.floor(totalBytes);
  const size = Math.floor(chunkBytes);
  const ranges: LabLoggerRingChunkRange[] = [];
  for (let offset = 0; offset < total; offset += size) {
    ranges.push({ offset, length: Math.min(size, total - offset) });
  }
  return ranges;
}

/** Remote `wc -c` of the ring file (0 if missing). */
export function buildLabLoggerRingStatCmd(remotePath: string): string {
  const q = remotePath.replace(/'/g, `'\\''`);
  return `if [ -f '${q}' ]; then wc -c < '${q}'; else echo 0; fi`;
}

/**
 * Seek+read one byte range via python3, emit length + base64 (SSH-safe).
 * Avoids single-shot `cat` of a 30–70 MB ring over a flaky ProxyJump.
 */
export function buildLabLoggerRingChunkCmd(
  remotePath: string,
  offset: number,
  length: number
): string {
  const off = Math.max(0, Math.floor(offset));
  const ln = Math.max(0, Math.floor(length));
  const py = [
    "import base64,sys",
    `p=${JSON.stringify(remotePath)};o=${off};n=${ln}`,
    'f=open(p,"rb");f.seek(o);d=f.read(n);f.close()',
    `sys.stdout.write(str(len(d))+"\\n${LAB_LOGGER_RING_CHUNK_MARKER}\\n")`,
    'sys.stdout.write(base64.b64encode(d).decode("ascii")+"\\n")',
    `sys.stdout.write("${LAB_LOGGER_RING_CHUNK_END}\\n")`,
  ].join(";");
  return `python3 -c ${JSON.stringify(py)}`;
}

export function parseLabLoggerRingStatStdout(stdout: string): number {
  const n = Number.parseInt(String(stdout ?? "").trim().split(/\s+/)[0] ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Parse one chunk response: `<len>\n###CHUNK###\n<base64>\n###END###`.
 * Returns base64 (caller decodes) so this stays Buffer-free for browser builds.
 */
export function parseLabLoggerRingChunkStdout(
  stdout: string,
  expectedLength: number
):
  | { ok: true; byteLength: number; base64: string }
  | { ok: false; error: string } {
  const marker = LAB_LOGGER_RING_CHUNK_MARKER;
  const end = LAB_LOGGER_RING_CHUNK_END;
  const idx = stdout.indexOf(marker);
  if (idx < 0) {
    return { ok: false, error: "Не удалось прочитать фрагмент ring (нет маркера)" };
  }
  const reported = Number.parseInt(stdout.slice(0, idx).trim(), 10);
  const after = stdout.slice(idx + marker.length).replace(/^\r?\n/, "");
  const endIdx = after.indexOf(end);
  const b64raw = (endIdx >= 0 ? after.slice(0, endIdx) : after).trim();
  const b64 = b64raw.replace(/\s+/g, "");
  if (!b64 && expectedLength > 0) {
    return { ok: false, error: "Пустой фрагмент ring" };
  }
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  const decodedLen =
    b64.length === 0 ? 0 : Math.floor((b64.length * 3) / 4) - pad;

  if (Number.isFinite(reported) && reported !== decodedLen) {
    return {
      ok: false,
      error: `Фрагмент оборвался: len=${reported}, base64≈${decodedLen}`,
    };
  }

  if (expectedLength > 0 && decodedLen !== expectedLength) {
    return {
      ok: false,
      error: `Фрагмент короче/длиннее ожидаемого: ${decodedLen} из ${expectedLength}`,
    };
  }

  return { ok: true, byteLength: decodedLen, base64: b64 };
}

/**
 * Final size gate for a chunked ring pull.
 * Ring may grow while downloading: accept local === sizeAtStart (snapshot) or
 * local === sizeAtEnd (caught up). Never accept a truncated file.
 */
export function assertLabLoggerRingDownloadSize(input: {
  localBytes: number;
  sizeAtStart: number;
  sizeAtEnd: number;
}): { ok: true } | { ok: false; error: string } {
  const local = Math.max(0, Math.floor(input.localBytes));
  const start = Math.max(0, Math.floor(input.sizeAtStart));
  const end = Math.max(0, Math.floor(input.sizeAtEnd));
  const minOk = start;
  const maxOk = Math.max(start, end);

  if (minOk <= 0) {
    return {
      ok: false,
      error:
        "Ring пуст (0 байт). Retention сама по себе не объясняет пустой файл, если комплекс " +
        "писал события за окно retain_hours — проверьте статус: source=idle / proc / health age / disk=0. " +
        "Файл не сохранён.",
    };
  }

  if (local < minOk) {
    return {
      ok: false,
      error:
        `Скачивание оборвалось: получено ${local} из ${minOk} байт ` +
        `(соединение разорвалось на середине передачи). Повторите «Скачать полный ring» — файл не сохранён.`,
    };
  }

  // Snapshot at click time, or full catch-up after re-stat — both OK.
  // Do not fail solely because the live ring grew past sizeAtStart.
  if (local === start || local === end) {
    return { ok: true };
  }

  if (local > maxOk) {
    return {
      ok: false,
      error:
        `Размер локального файла (${local}) больше remote (${maxOk}). Файл не сохранён.`,
    };
  }

  return {
    ok: false,
    error:
      `Скачивание неполное: локально ${local} байт, remote был ${start}…${end}. ` +
      `Повторите «Скачать полный ring» — файл не сохранён.`,
  };
}

/**
 * Strip OpenSSH client noise (PQ KEX, known_hosts) from user-facing errors.
 * Shared by lab-logger SSH and Remote session connect — both surface stderr
 * and must not treat banners as failure text.
 */
export function stripSshNoise(text: string): string {
  if (!text) return "";
  const cleaned = text
    .split(/\r?\n/)
    .filter((raw) => {
      const line = raw.trim();
      if (!line) return false;
      if (/post-quantum|pq.key|hybrid.key.exchange/i.test(line)) return false;
      if (/known_hosts/i.test(line)) return false;
      if (/Permanently added/i.test(line)) return false;
      if (/^Warning:.*host key/i.test(line)) return false;
      if (/Warning: Permanently added/i.test(line)) return false;
      if (/#.*authenticity of host/i.test(line)) return false;
      // OpenSSH "store now, decrypt later" PQ advisory (seen verbatim in the
      // field, wrapped in "** ... **" markers, sometimes split across two
      // lines): "This session may be vulnerable to ...", "The server may
      // need to be upgraded.", "See https://openssh.com/pq.html".
      if (/session may be vulnerable/i.test(line)) return false;
      if (/store now,?\s*decrypt later/i.test(line)) return false;
      if (/server may need to be upgraded/i.test(line)) return false;
      if (/openssh\.com\/pq\.html/i.test(line)) return false;
      if (/^\*+\s*$/.test(line)) return false;
      return true;
    })
    .join("\n")
    .trim();
  return cleaned;
}

/** @deprecated Prefer {@link stripSshNoise} — same filter. */
export const stripLabLoggerSshNoise = stripSshNoise;

const SSH_CONNECT_FALLBACK_RU =
  "Не удалось поднять SSH-туннель (таймаут / ошибка)";

/**
 * User-facing Remote-connect failure: drop OpenSSH noise, soft-map common
 * failures to RU. Empty after strip → generic tunnel message (not raw banners).
 */
export function formatSshConnectFailureMessage(
  stderr: string,
  fallback: string = SSH_CONNECT_FALLBACK_RU
): string {
  const cleaned = stripSshNoise(stderr);
  if (!cleaned) return fallback;
  if (/permission denied|authentication (failed|refused)|publickey/i.test(cleaned)) {
    return "SSH: отказ в доступе (ключ или auth). Проверьте id_ed25519 и доступ на ERP/комплекс.";
  }
  if (/connection refused/i.test(cleaned)) {
    return "SSH: соединение отклонено. Проверьте серию (порт) и что комплекс онлайн на ERP.";
  }
  if (/connection timed? ?out|operation timed out|timed out while/i.test(cleaned)) {
    return "SSH: таймаут подключения. Проверьте VPN/ERP и серию комплекса.";
  }
  if (/could not resolve|name or service not known|no such host/i.test(cleaned)) {
    return "SSH: не удалось разрешить хост ERP. Проверьте сеть и DNS.";
  }
  if (/network is unreachable|no route to host/i.test(cleaned)) {
    return "SSH: сеть недоступна. Проверьте VPN/маршрут до ERP.";
  }
  if (/channel.?open|administratively prohibited|remote port forwarding failed/i.test(cleaned)) {
    return "SSH: не удалось открыть туннель (forward). Закройте другой SSH на эту серию и повторите.";
  }
  return cleaned.length > 280 ? `${cleaned.slice(0, 280)}…` : cleaned;
}

/** True when remote message is only "unit missing" (soft uninstall). */
export function isLabLoggerMissingUnitError(text: string): boolean {
  const t = stripSshNoise(text).toLowerCase();
  if (!t) return false;
  return (
    /unit file does not exist/.test(t) ||
    /not found|could not be found/.test(t) ||
    /no such file/.test(t)
  );
}

/**
 * Extract first balanced `{...}` JSON object from mixed SSH/curl output
 * (banners, warnings, trailing junk). Returns null if none found.
 */
export function extractFirstJsonObject(text: string): string | null {
  if (!text) return null;
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i]!;
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (c === "\\") {
        escape = true;
        continue;
      }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export function parseLabLoggerHealthJson(text: string): LabLoggerHealth | null {
  try {
    const sliced = extractFirstJsonObject(text) ?? text.trim();
    const raw = JSON.parse(sliced) as unknown;
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
    const o = raw as Record<string, unknown>;
    if (Object.keys(o).length === 0) return null;
    const warnings = Array.isArray(o.topology_warnings)
      ? o.topology_warnings.map((w) => String(w))
      : [];
    const age = o.last_sample_age_ms;
    const sourceRaw = String(o.source ?? "").toLowerCase();
    let source: LabLoggerSourceKind = "unknown";
    if (sourceRaw === "fake" || sourceRaw === "nats" || sourceRaw === "idle") {
      source = sourceRaw;
    } else if (o.fake_source === true) {
      source = "fake";
    }
    return {
      ok: o.ok !== false,
      lastSampleAgeMs: typeof age === "number" ? age : null,
      lockHeld: Boolean(o.lock_held),
      topologyWarnings: warnings,
      diskBytes: typeof o.disk_bytes === "number" ? o.disk_bytes : 0,
      availabilityDiskBytes:
        typeof o.availability_disk_bytes === "number"
          ? o.availability_disk_bytes
          : 0,
      ticks: typeof o.ticks === "number" ? o.ticks : 0,
      watchdogBackoff: Boolean(o.watchdog_backoff),
      dxAllowed: o.dx_allowed !== false,
      intervalMs: typeof o.interval_ms === "number" ? o.interval_ms : null,
      source,
      raw: o,
    };
  } catch {
    return null;
  }
}

function parseUnitActive(s: string): LabLoggerUnitState {
  const v = s.trim().toLowerCase();
  if (v === "active") return "active";
  if (v === "inactive") return "inactive";
  if (v === "failed") return "failed";
  return "unknown";
}

/**
 * Parse stdout from buildLabLoggerStatusProbeCmd.
 * Soft-accept if STATUS_BEGIN marker present (exit≠0 OK for SSH wrappers).
 */
export function parseLabLoggerStatusOutput(stdout: string): LabLoggerStatus {
  const lines: string[] = [];
  let installed = false;
  let remotePath = LAB_LOGGER_REMOTE_ROOT;
  let unitActive: LabLoggerUnitState = "unknown";
  let unitEnabled: boolean | null = null;
  let processRunning = false;
  let retainHours: number | null = null;
  let fakeSource: boolean | null = null;
  let health: LabLoggerHealth | null = null;
  let healthError: string | null = null;
  let pythonHint: string | null = null;

  const begin = stdout.indexOf(STATUS_BEGIN);
  const end = stdout.indexOf(STATUS_END);
  const body =
    begin >= 0
      ? stdout.slice(
          begin + STATUS_BEGIN.length,
          end >= 0 ? end : undefined
        )
      : stdout;

  const healthMatch = body.match(
    /###HEALTH###\s*([\s\S]*?)(?=###CONFIG###|$)/
  );
  if (healthMatch) {
    const chunk = healthMatch[1].trim();
    const extracted = extractFirstJsonObject(chunk);
    if (!extracted || extracted === "{}") {
      healthError = "недоступен (не запущен?)";
    } else {
      health = parseLabLoggerHealthJson(extracted);
      if (!health) healthError = "ошибка JSON health";
    }
  }

  const configMatch = body.match(/###CONFIG###\s*([\s\S]*?)(?=$)/);
  if (configMatch) {
    const cfg = parseLabLoggerConfigJson(configMatch[1].trim());
    if (cfg?.retain_hours != null) retainHours = cfg.retain_hours;
    if (cfg?.fake_source != null) fakeSource = cfg.fake_source;
  }

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("###")) continue;
    lines.push(line);
    if (line === "installed=yes") installed = true;
    if (line === "installed=no") installed = false;
    if (line.startsWith("path=")) {
      const p = line.slice("path=".length).trim();
      if (p) remotePath = p;
    }
    if (line.startsWith("unit_active=")) {
      unitActive = parseUnitActive(line.slice("unit_active=".length));
    }
    if (line.startsWith("unit_enabled=")) {
      const v = line.slice("unit_enabled=".length).trim().toLowerCase();
      if (v === "enabled" || v === "enabled-runtime") unitEnabled = true;
      else if (
        v === "disabled" ||
        v === "static" ||
        v === "disabled-runtime"
      )
        unitEnabled = false;
      else unitEnabled = null;
    }
    if (line.startsWith("proc=")) {
      const rest = line.slice("proc=".length).trim();
      processRunning = rest.length > 2 && !/^[\s|]*$/.test(rest);
    }
    if (line.startsWith("python=")) {
      const p = line.slice("python=".length).trim();
      pythonHint = p || null;
    }
  }

  return {
    installed,
    remotePath,
    unitActive,
    unitEnabled,
    processRunning,
    retainHours,
    fakeSource,
    health,
    healthError,
    pythonHint,
    lines,
  };
}

/** Status fields for stacked UI (avoids one ultra-long badge line). */
export function formatLabLoggerStatusParts(s: LabLoggerStatus): string[] {
  let installLabel: string;
  if (!s.installed) {
    installLabel = s.processRunning
      ? "не установлен (чужой/orphan proc)"
      : "не установлен";
  } else if (s.unitActive === "active" || s.processRunning) {
    installLabel = "установлен";
  } else {
    installLabel = "установлен (остановлен)";
  }
  const parts = [
    installLabel,
    `path=${s.remotePath || LAB_LOGGER_REMOTE_ROOT}`,
    `unit=${s.unitActive}`,
    s.unitEnabled === true
      ? "autostart=on"
      : s.unitEnabled === false
        ? "autostart=off"
        : "autostart=?",
    s.processRunning ? "proc=yes" : "proc=no",
  ];
  const source = resolveLabLoggerSourceKind(s);
  if (source === "fake") parts.push("source=FAKE");
  else if (source === "nats") parts.push("source=NATS");
  else if (source === "idle") parts.push("source=idle");
  if (s.retainHours != null) parts.push(`retain=${s.retainHours}h`);
  if (s.health?.ok) {
    const age =
      s.health.lastSampleAgeMs != null
        ? `${Math.round(s.health.lastSampleAgeMs)}ms`
        : "?";
    parts.push(`health=ok age=${age}`);
    const disk = s.health.diskBytes ?? 0;
    parts.push(`disk=${disk}b`);
    if (disk <= 0) {
      parts.push("ring=пуст (нет записей — NATS/source?)");
    } else if (
      s.health.lastSampleAgeMs != null &&
      s.health.lastSampleAgeMs > 60_000
    ) {
      parts.push("запись устарела (>60s)");
    }
  } else if (s.healthError) {
    parts.push(`health=${s.healthError}`);
  }
  return parts;
}

/** Resolve telemetry source for UI badge (health wins over config). */
export function resolveLabLoggerSourceKind(
  s: Pick<LabLoggerStatus, "fakeSource" | "health"> | null
): LabLoggerSourceKind {
  if (!s) return "unknown";
  if (s.health?.source && s.health.source !== "unknown") return s.health.source;
  if (s.fakeSource === true) return "fake";
  return "unknown";
}

/** Format status for UI log / compact text (RU). */
export function formatLabLoggerStatusLine(s: LabLoggerStatus): string {
  return formatLabLoggerStatusParts(s).join(" · ");
}

const LAB_EVENT_KINDS = new Set<string>([
  "valve",
  "pump",
  "heater",
  "sensor",
  "command",
  "system",
  "flush",
  "foam",
]);

/** Names that stay continuous sensors even when value is 0/1. */
const SENSORISH_NAMES = new Set([
  "pumpcurrent",
  "pumpcurrentl",
  "pumppower",
  "pressure",
  "pulses",
  "temp",
  "t1",
  "t2",
  "t3",
]);

/**
 * Onboard ring uses ms epoch (Python `time.time()*1000`).
 * If a producer wrote seconds (< 1e12), scale to ms for Date/ISO.
 */
export function normalizeOnboardTsMs(ts: number): number {
  if (!Number.isFinite(ts)) return Number.NaN;
  // 1e12 ms ≈ 2001-09; seconds since epoch today are ~1.7e9
  if (Math.abs(ts) < 1e12) return ts * 1000;
  return ts;
}

function coerceOnboardValue(
  v: unknown
): string | number | boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean" || typeof v === "number" || typeof v === "string") {
    return v;
  }
  return String(v);
}

/** Valve/pump/heater: 0/1 → boolean so booleanStepSeries can plot them. */
export function coerceOnboardActuatorValue(
  kind: LabEventKind,
  value: unknown
): string | number | boolean | null {
  const v = coerceOnboardValue(value);
  if (kind !== "valve" && kind !== "pump" && kind !== "heater") return v;
  if (typeof v === "boolean") return v;
  if (v === 1 || v === "1" || v === "true" || v === "on" || v === "ON") return true;
  if (v === 0 || v === "0" || v === "false" || v === "off" || v === "OFF") {
    return false;
  }
  return v;
}

function mapOnboardKind(kind: string): LabEventKind {
  if (LAB_EVENT_KINDS.has(kind)) return kind as LabEventKind;
  return "system";
}

function inferOnboardKind(
  name: string,
  value: unknown,
  kinds?: Record<string, string> | null,
  seriesFullKey?: string
): LabEventKind {
  if (kinds && seriesFullKey && kinds[seriesFullKey]) {
    return mapOnboardKind(kinds[seriesFullKey]!);
  }
  const low = name.toLowerCase();
  if (SENSORISH_NAMES.has(low) || low.endsWith("_pwm") || low.includes("temp")) {
    return "sensor";
  }
  if (low === "pump" || low === "pumpon") return "pump";
  if (low.startsWith("heater")) return "heater";
  if (typeof value === "boolean") return "valve";
  if (value === 0 || value === 1) return "valve";
  if (typeof value === "number") return "sensor";
  return "sensor";
}

/**
 * Convert one onboard HTTP/ring JSON record to SM LabEvent(s).
 * Snapshot heartbeats expand `values` (+ optional `kinds`) into points;
 * delta rows keep kind. Actuator 0/1 coerced to boolean; ts normalized to ms.
 */
export function convertOnboardRecordToLabEvents(
  raw: unknown,
  hwid = "onboard"
): LabEvent[] {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return [];
  const o = raw as Record<string, unknown>;
  const tsRaw = typeof o.ts === "number" ? o.ts : Number(o.ts);
  const ts = normalizeOnboardTsMs(tsRaw);
  if (!Number.isFinite(ts)) return [];
  const at = new Date(ts).toISOString();
  const kindRaw = String(o.kind ?? "");

  if (kindRaw === "snapshot" || (o.values != null && o.module == null)) {
    const values = o.values;
    if (values == null || typeof values !== "object" || Array.isArray(values)) {
      return [];
    }
    const kindsRaw = o.kinds;
    const kinds =
      kindsRaw != null &&
      typeof kindsRaw === "object" &&
      !Array.isArray(kindsRaw)
        ? (kindsRaw as Record<string, string>)
        : null;
    const out: LabEvent[] = [];
    for (const [key, val] of Object.entries(values as Record<string, unknown>)) {
      const { module, name } = parseSeriesKey(key);
      if (!module || !name) continue;
      const kind = inferOnboardKind(name, val, kinds, key);
      out.push(
        createLabEvent({
          at,
          kind,
          module,
          hwid,
          name,
          value: coerceOnboardActuatorValue(kind, val),
          detail: "heartbeat",
        })
      );
    }
    return out;
  }

  const module = String(o.module ?? "");
  const name = String(o.name ?? "");
  if (!module || !name) return [];
  const kind = mapOnboardKind(kindRaw);
  return [
    createLabEvent({
      at,
      kind,
      module,
      hwid,
      name,
      value: coerceOnboardActuatorValue(kind, o.value),
    }),
  ];
}

/** Convert a batch of onboard `/lab/events` records. */
export function convertOnboardRecordsToLabEvents(
  records: readonly unknown[],
  hwid = "onboard"
): LabEvent[] {
  const out: LabEvent[] = [];
  for (const r of records) {
    out.push(...convertOnboardRecordToLabEvents(r, hwid));
  }
  return out;
}

/** Max `ts` from onboard records — for `/lab/events?from=` cursor (raw ring units). */
export function maxOnboardRecordTs(
  records: readonly unknown[]
): number | null {
  let max = Number.NEGATIVE_INFINITY;
  for (const raw of records) {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) continue;
    const ts = (raw as Record<string, unknown>).ts;
    const n = typeof ts === "number" ? ts : Number(ts);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return Number.isFinite(max) ? max : null;
}

/**
 * Next exclusive-ish `from` cursor after an inclusive `events_since` pull.
 * Ring uses `ts >= from`; bump by 1 ms to avoid re-fetching the last row.
 */
export function nextOnboardEventsFromTs(lastTs: number | null): number {
  if (lastTs == null || !Number.isFinite(lastTs)) return 0;
  return lastTs + 1;
}

/**
 * Merge onboard-converted events into a chart ring.
 *
 * The onboard SSH curl `/lab/events?from=<cursor>` pull is cursor-based
 * (`nextOnboardEventsFromTs`), so `incoming` is already just the delta since
 * the last poll — a small, or even empty, batch is the **normal steady
 * state** for a delta+heartbeat source (most poll ticks legitimately have
 * nothing new to report), not a "user cleared the log" signal the way it is
 * for the dense Modules IPC chart sync.
 *
 * This used to delegate to `mergeLabChartSyncEvents`, which has a heuristic
 * `if (prev.length > 1_000 && incoming.length <= 8) return trim(incoming)`
 * to detect "Modules «Очистить лог» while chart stays open". That heuristic
 * fires constantly on the onboard path once the local ring grows past 1000
 * events — nearly every quiet poll tick (nothing changed, not yet a
 * heartbeat) has `incoming.length <= 8`, so the entire accumulated history
 * was discarded and replaced by that tiny batch. Field symptom: chart curves
 * "disappear after a while" and keep reappearing/vanishing on a cycle. Fixed
 * by never treating a small batch as a clear signal here — only append +
 * trim, with the same "strictly newer than last known" de-dup guard so a
 * duplicate re-poll of the same cursor doesn't double events.
 */
export function mergeOnboardLabEvents(
  prev: readonly LabEvent[],
  incoming: readonly LabEvent[],
  max: number = LAB_EVENTS_CHART_WINDOW_MAX
): LabEvent[] {
  if (incoming.length === 0) {
    return trimLabEvents(prev as LabEvent[], max);
  }
  if (prev.length === 0) {
    return trimLabEvents([...incoming], max);
  }
  const prevLastAt = Date.parse(prev[prev.length - 1]!.at);
  if (!Number.isFinite(prevLastAt)) {
    return trimLabEvents([...incoming], max);
  }
  const newer = incoming.filter((e) => {
    const t = Date.parse(e.at);
    return Number.isFinite(t) && t > prevLastAt;
  });
  if (newer.length === 0) {
    return trimLabEvents(prev as LabEvent[], max);
  }
  return trimLabEvents([...prev, ...newer], max);
}

/**
 * Continuous sensor series keys (`module.name`) for LabChart allSensors.
 * Excludes valve/pump/heater actuators (those go to valvesMap / overlays).
 */
export function collectOnboardSeriesKeys(
  events: readonly LabEvent[]
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of events) {
    if (e.kind === "valve" || e.kind === "pump" || e.kind === "heater") {
      continue;
    }
    const key = `${e.module}.${e.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/** Flat `module.name` keys for valve overlays (auto-enable on chart). */
export function onboardValveOverlayKeys(
  events: readonly LabEvent[]
): string[] {
  const map = valvesMapFromOnboardEvents(events);
  const out: string[] = [];
  for (const h of HOSTS) {
    for (const id of map[h]) out.push(`${h}.${id}`);
  }
  return out;
}

const HOSTS: DrinkxHost[] = ["milk", "coffee", "water"];

/**
 * Valve ids per host from valve events (for LabChartPanel valvesMap).
 *
 * Ordered by the same canonical `MODULE_VALVES[host]` sequence Modules uses
 * (physical/functional order: input valves, drain, dump, dryside, air) —
 * not alphabetically. Alphabetical sort put `air` ("Пневмораспределитель
 * №6") before `drain`/`dump`/`drysideValve`, which is exactly backwards from
 * how the Modules tab lists the same valves; field report: onboard chart
 * order didn't match Modules at all.
 */
export function valvesMapFromOnboardEvents(
  events: readonly LabEvent[]
): Record<DrinkxHost, string[]> {
  const maps: Record<DrinkxHost, Set<string>> = {
    milk: new Set(),
    coffee: new Set(),
    water: new Set(),
  };
  for (const e of events) {
    if (e.kind !== "valve") continue;
    if (e.module !== "milk" && e.module !== "coffee" && e.module !== "water") {
      continue;
    }
    maps[e.module].add(e.name);
  }
  const out: Record<DrinkxHost, string[]> = { milk: [], coffee: [], water: [] };
  for (const h of HOSTS) {
    const seen = maps[h];
    const canonical = MODULE_VALVES[h] ?? [];
    const ordered = canonical.filter((id) => seen.has(id));
    // Any id not in the canonical list (unexpected/future valve) still
    // shows up, appended in first-seen order rather than silently dropped.
    for (const id of seen) {
      if (!ordered.includes(id)) ordered.push(id);
    }
    out[h] = ordered;
  }
  return out;
}

/** Hosts that have pump actuator events (overlays.pumpOn). */
export function onboardPumpOverlayHosts(
  events: readonly LabEvent[]
): DrinkxHost[] {
  const seen = new Set<DrinkxHost>();
  for (const e of events) {
    if (e.kind !== "pump") continue;
    if (e.module !== "milk" && e.module !== "coffee" && e.module !== "water") {
      continue;
    }
    seen.add(e.module);
  }
  return HOSTS.filter((h) => seen.has(h));
}

/**
 * Heater PWM series keys for overlays (`milk.heater1_pwm`) — same as
 * LabChartPanel heaterPwmKey / Modules series-4 charts.
 */
export function onboardHeaterPwmOverlayKeys(
  events: readonly LabEvent[]
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of events) {
    const low = e.name.toLowerCase();
    if (!low.endsWith("_pwm") || !low.startsWith("heater")) continue;
    if (e.module !== "milk" && e.module !== "coffee" && e.module !== "water") {
      continue;
    }
    const key = `${e.module}.${e.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/** Heater base ids seen in onboard stream (`heater1` / `heater2`). */
export function onboardHeaterIds(events: readonly LabEvent[]): string[] {
  const seen = new Set<string>();
  for (const e of events) {
    const m = /^(heater[12])(?:_pwm)?$/i.exec(e.name);
    if (!m) continue;
    seen.add(m[1]!.toLowerCase());
  }
  return ["heater1", "heater2"].filter((id) => seen.has(id));
}

/** True when status suggests logger HTTP is worth polling. */
export function isLabLoggerRealtimeReady(s: LabLoggerStatus | null): boolean {
  if (!s?.installed) return false;
  if (s.unitActive === "active") return true;
  if (s.processRunning) return true;
  if (s.health?.ok) return true;
  return false;
}

/**
 * Parse one JSON Lines ring row. Empty lines → skip; non-object JSON → invalid.
 */
export function parseOnboardRingJsonlLine(
  line: string
):
  | { ok: true; record: unknown }
  | { ok: false; empty: true }
  | { ok: false; invalid: true } {
  const t = line.trim();
  if (!t) return { ok: false, empty: true };
  if (!t.startsWith("{")) return { ok: false, invalid: true };
  try {
    const rec: unknown = JSON.parse(t);
    if (!rec || typeof rec !== "object" || Array.isArray(rec)) {
      return { ok: false, invalid: true };
    }
    return { ok: true, record: rec };
  } catch {
    return { ok: false, invalid: true };
  }
}

/**
 * Parse a whole onboard ring file as JSON Lines (one record per line).
 * Returns null if the text is not that format (e.g. single-JSON chart export).
 */
export function parseOnboardRingJsonlText(text: string): unknown[] | null {
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return null;
  const records: unknown[] = [];
  let sawContent = false;
  for (const line of lines) {
    const parsed = parseOnboardRingJsonlLine(line);
    if ("empty" in parsed && parsed.empty) continue;
    if (!parsed.ok) return null;
    sawContent = true;
    records.push(parsed.record);
  }
  return sawContent ? records : null;
}

/** Evenly sample `count` items across the full array (keeps span coverage). */
export function sampleEvenly<T>(items: readonly T[], count: number): T[] {
  if (count <= 0) return [];
  if (items.length <= count) return [...items];
  if (count === 1) return [items[items.length - 1]!];
  const last = items.length - 1;
  const out: T[] = [];
  let prev = -1;
  for (let i = 0; i < count; i++) {
    const idx = Math.round((i * last) / (count - 1));
    if (idx === prev) continue;
    prev = idx;
    out.push(items[idx]!);
  }
  return out;
}

/**
 * Cap imported ring events for chart UI/IPC without keeping only the newest
 * slice — sample evenly across the full time span so a 24h ring still shows
 * the whole day. Prefer keeping actuators (sparse overlays).
 */
export function downsampleLabEventsForImport(
  events: readonly LabEvent[],
  max: number = LAB_LOGGER_IMPORT_EVENTS_MAX
): LabEvent[] {
  if (max <= 0) return [];
  if (events.length <= max) return [...events];

  const actuators: LabEvent[] = [];
  const rest: LabEvent[] = [];
  for (const e of events) {
    if (e.kind === "valve" || e.kind === "pump" || e.kind === "heater") {
      actuators.push(e);
    } else {
      rest.push(e);
    }
  }

  const actuatorBudget = Math.min(actuators.length, Math.floor(max * 0.25));
  const keepAct =
    actuators.length <= actuatorBudget
      ? actuators
      : sampleEvenly(actuators, actuatorBudget);
  const restBudget = Math.max(0, max - keepAct.length);
  const keepRest =
    rest.length <= restBudget ? rest : sampleEvenly(rest, restBudget);

  return [...keepAct, ...keepRest].sort(
    (a, b) => Date.parse(a.at) - Date.parse(b.at)
  );
}

/**
 * Streaming accumulator for large `.jsonl` rings: convert line-by-line and
 * periodically downsample so peak RAM stays near the chart cap, not file size.
 */
export class OnboardRingImportAccumulator {
  private events: LabEvent[] = [];
  private records = 0;
  private eventsRaw = 0;
  private readonly max: number;
  private readonly hwid: string;

  constructor(
    max: number = LAB_LOGGER_IMPORT_EVENTS_MAX,
    hwid = "onboard-import"
  ) {
    this.max = Math.max(1, max);
    this.hwid = hwid;
  }

  /** @returns false if the line is not a valid ring record (hard fail). */
  pushLine(line: string): boolean {
    const parsed = parseOnboardRingJsonlLine(line);
    if ("empty" in parsed && parsed.empty) return true;
    if (!parsed.ok) return false;
    this.records += 1;
    const converted = convertOnboardRecordToLabEvents(parsed.record, this.hwid);
    this.eventsRaw += converted.length;
    this.events.push(...converted);
    // Soft cap while streaming — final downsample in finish().
    if (this.events.length > this.max * 2) {
      this.events = downsampleLabEventsForImport(this.events, this.max);
    }
    return true;
  }

  finish(): {
    events: LabEvent[];
    records: number;
    eventsBeforeCap: number;
    eventsAfterCap: number;
  } {
    const events = downsampleLabEventsForImport(this.events, this.max);
    return {
      events,
      records: this.records,
      eventsBeforeCap: this.eventsRaw,
      eventsAfterCap: events.length,
    };
  }
}
