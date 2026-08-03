/**
 * Lab onboard logger — SSH install/control on complexos (soft-fail).
 * Local: ssh2 → 192.168.1.43; Remote: OpenSSH jump like pos-host-probe.
 * File push: JSON bundle via SSH stdin → remote cat → python3 unpack
 * (never embed package bytes in Windows SSH argv — ENAMETOOLONG).
 */

import { spawn } from "child_process";
import { createHash } from "crypto";
import { existsSync } from "fs";
import { readFile, writeFile, mkdir } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { app, dialog } from "electron";
import { Client } from "ssh2";
import {
  COMPLEX_SSH_USER,
  DEFAULT_LAN_MAP,
  ERP_JUMP_HOST,
  LAB_LOGGER_PACKAGE_FILES,
  LAB_LOGGER_VERSION,
  LAB_LOGGER_REMOTE_BUNDLE_PATH,
  LAB_LOGGER_REMOTE_ROOT,
  LAB_LOGGER_RING_REL,
  MODULE_SSH_PASSWORD,
  buildLabLoggerConfigJson,
  buildLabLoggerDisableAutostartCmd,
  buildLabLoggerEnableAutostartCmd,
  buildLabLoggerEventsCurlCmd,
  buildLabLoggerRemoteUnpackCmd,
  buildLabLoggerRestartCmd,
  buildLabLoggerSnapshotCurlCmd,
  buildLabLoggerStartCmd,
  buildLabLoggerStatusProbeCmd,
  buildLabLoggerSystemdUserUnit,
  buildLabLoggerUninstallCmd,
  ensureLabLoggerRingSavePath,
  extractFirstJsonObject,
  isLabLoggerMissingUnitError,
  labLoggerRingDownloadFilename,
  parseLabLoggerHealthJson,
  parseLabLoggerStatusOutput,
  stripLabLoggerSshNoise,
  type LabLoggerHealth,
  type LabLoggerStatus,
} from "@service-monitor/core";
import { resolveSshBinary } from "./dozator-ssh";
import { sshSessionManager } from "./ssh-session-manager";

function identityPath(): string {
  return join(homedir(), ".ssh", "id_ed25519");
}

function sshErrMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const cleaned = stripLabLoggerSshNoise(raw);
  // Do not fall back to raw when strip removed only PQ/known_hosts noise
  // (that previously re-exposed the banner as [err] after uninstall).
  return cleaned || "SSH error";
}

function complexosLanIp(): string {
  const entry = DEFAULT_LAN_MAP.find((e) => e.role === "complexos");
  return entry?.ip ?? "192.168.1.43";
}

/** Resolve tools/complexos-lab-logger on disk (dev monorepo). */
export function resolveLabLoggerPackageRoot(): string | null {
  const candidates = [
    join(process.cwd(), "tools", "complexos-lab-logger"),
    join(process.cwd(), "..", "..", "tools", "complexos-lab-logger"),
    join(__dirname, "..", "..", "..", "..", "tools", "complexos-lab-logger"),
    join("C:", "myApp", "service-monitor", "tools", "complexos-lab-logger"),
  ];
  for (const c of candidates) {
    if (existsSync(join(c, "main.py"))) return c;
  }
  return null;
}

type ExecResult = { stdout: string; stderr: string; code: number | null };

function execSsh2(input: {
  host: string;
  port: number;
  command: string;
  timeoutMs: number;
  label: string;
  softMarker?: string;
  stdin?: Buffer;
}): Promise<ExecResult> {
  const { host, port, command, timeoutMs, label, softMarker, stdin } = input;
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const timer = setTimeout(() => {
      try {
        conn.end();
      } catch {
        // ignore
      }
      reject(new Error(`SSH timeout (${label})`));
    }, timeoutMs);

    conn
      .on("ready", () => {
        conn.exec(command, (err, stream) => {
          if (err) {
            clearTimeout(timer);
            conn.end();
            reject(err);
            return;
          }
          // Accumulate raw Buffer chunks and decode once at the end — a
          // multi-byte UTF-8 char (ring jsonl is `ensure_ascii=False`, RU
          // topology warnings) can be split across two TCP `data` events;
          // per-chunk `.toString()` would corrupt it at the boundary.
          const stdoutChunks: Buffer[] = [];
          const stderrChunks: Buffer[] = [];
          stream
            .on("close", (code: number | null) => {
              clearTimeout(timer);
              try {
                conn.end();
              } catch {
                // ignore
              }
              const stdout = Buffer.concat(stdoutChunks).toString("utf8");
              const stderr = Buffer.concat(stderrChunks).toString("utf8");
              const soft =
                softMarker != null && stdout.includes(softMarker);
              if (code === 0 || soft || code == null) {
                resolve({ stdout, stderr, code });
              } else {
                const msg =
                  stripLabLoggerSshNoise(stderr) ||
                  stripLabLoggerSshNoise(stdout) ||
                  `remote exit ${code} (${label})`;
                reject(new Error(msg));
              }
            })
            .on("data", (d: Buffer) => {
              stdoutChunks.push(d);
            });
          stream.stderr.on("data", (d: Buffer) => {
            stderrChunks.push(d);
          });
          if (stdin && stdin.length > 0) {
            stream.write(stdin);
          }
          stream.end();
        });
      })
      .on("keyboard-interactive", (_n, _i, _l, prompts, finish) => {
        finish(prompts.map(() => MODULE_SSH_PASSWORD));
      })
      .on("error", (e) => {
        clearTimeout(timer);
        reject(
          new Error(`${e.message} (${label}). Проверьте сессию / пароль pi.`)
        );
      })
      .connect({
        host,
        port,
        username: COMPLEX_SSH_USER,
        password: MODULE_SSH_PASSWORD,
        tryKeyboard: true,
        readyTimeout: 15_000,
        hostVerifier: () => true,
      });
  });
}

/**
 * `code === 255` with **no** stdout/stderr at all is OpenSSH's own generic
 * "the ssh client itself failed" signal (ProxyJump hiccup, tunnel port
 * momentarily gone, dropped connection) — not the remote command failing,
 * which would print at least something (our commands always end with
 * `echo OK`, guard every step with `2>/dev/null || true`). Field report: a
 * "Удалить" (uninstall) click failed with exactly `ssh exit 255 (remote Host
 * <port>)` seconds after two other commands succeeded over the same
 * ProxyJump tunnel — a transient jump-host blip, not a script bug. All
 * lab-logger remote commands are idempotent (soft-fail suffixed), so one
 * automatic retry is safe and costs little.
 */
function isBlankSshClientFailure(
  code: number | null,
  out: string,
  err: string
): boolean {
  return code === 255 && out.trim().length === 0 && err.trim().length === 0;
}

function execOpenSshRemoteOnce(input: {
  sshPort: number;
  identityFile: string;
  command: string;
  timeoutMs: number;
  softMarker?: string;
  stdin?: Buffer;
}): Promise<ExecResult> {
  const { sshPort, identityFile, command, timeoutMs, softMarker, stdin } =
    input;
  return new Promise((resolve, reject) => {
    const ssh = resolveSshBinary();
    const args = [
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
      identityFile,
      "-J",
      `tun@${ERP_JUMP_HOST}`,
      "-p",
      String(sshPort),
      `${COMPLEX_SSH_USER}@localhost`,
      command,
    ];
    const child = spawn(ssh, args, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    // Buffer chunks, decode once — see execSsh2 comment (UTF-8 boundary
    // corruption risk on large ring downloads containing non-ASCII text).
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`SSH timeout (remote :${sshPort})`));
    }, timeoutMs);
    child.stdout?.on("data", (b: Buffer) => {
      outChunks.push(b);
    });
    child.stderr?.on("data", (b: Buffer) => {
      errChunks.push(b);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const out = Buffer.concat(outChunks).toString("utf8");
      const err = Buffer.concat(errChunks).toString("utf8");
      const soft = softMarker != null && out.includes(softMarker);
      if (code === 0 || soft) {
        resolve({ stdout: out, stderr: err, code });
        return;
      }
      if (isBlankSshClientFailure(code, out, err)) {
        reject(
          Object.assign(new Error(`ssh exit ${code} (remote Host ${sshPort})`), {
            blankSshClientFailure: true,
          })
        );
        return;
      }
      const msg =
        stripLabLoggerSshNoise(err) ||
        stripLabLoggerSshNoise(out) ||
        `ssh exit ${code} (remote Host ${sshPort})`;
      reject(new Error(msg));
    });
    if (stdin && stdin.length > 0) {
      child.stdin?.write(stdin);
    }
    child.stdin?.end();
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function execOpenSshRemote(input: {
  sshPort: number;
  identityFile: string;
  command: string;
  timeoutMs: number;
  softMarker?: string;
  stdin?: Buffer;
}): Promise<ExecResult> {
  try {
    return await execOpenSshRemoteOnce(input);
  } catch (e) {
    if (!(e as { blankSshClientFailure?: boolean })?.blankSshClientFailure) {
      throw e;
    }
    // One retry after a short settle delay — see isBlankSshClientFailure.
    await delay(700);
    try {
      return await execOpenSshRemoteOnce(input);
    } catch (e2) {
      if ((e2 as { blankSshClientFailure?: boolean })?.blankSshClientFailure) {
        throw new Error(
          `ssh exit 255 (remote Host ${input.sshPort}) — соединение через тоннель нестабильно, повторите позже`
        );
      }
      throw e2;
    }
  }
}

async function execOnComplexos(
  command: string,
  opts?: {
    timeoutMs?: number;
    softMarker?: string;
    identityFile?: string;
    stdin?: Buffer;
  }
): Promise<ExecResult> {
  const timeoutMs = opts?.timeoutMs ?? 30_000;
  const softMarker = opts?.softMarker;
  const stdin = opts?.stdin;
  const session = sshSessionManager.getSnapshot();
  if (!session.connected) {
    throw new Error("Нужна активная сессия (вкладка Сессия)");
  }
  if (session.mode === "local") {
    const ip = complexosLanIp();
    return execSsh2({
      host: ip,
      port: 22,
      command,
      timeoutMs,
      label: `${COMPLEX_SSH_USER}@${ip}`,
      softMarker,
      stdin,
    });
  }
  if (session.mode === "remote") {
    const sshPort = session.sshPort;
    if (sshPort == null) throw new Error("Remote-сессия без sshPort");
    return execOpenSshRemote({
      sshPort,
      identityFile: opts?.identityFile ?? identityPath(),
      command,
      timeoutMs,
      softMarker,
      stdin,
    });
  }
  throw new Error("Сессия без режима local/remote");
}

async function buildInstallBundle(retainHours: number): Promise<{
  payload: Buffer;
  sha256: string;
  fileCount: number;
}> {
  const root = resolveLabLoggerPackageRoot();
  if (!root) {
    throw new Error(
      "Не найден tools/complexos-lab-logger (нужен monorepo / артефакт пакета)"
    );
  }
  const files: Record<string, string> = {};
  for (const rel of LAB_LOGGER_PACKAGE_FILES) {
    const abs = join(root, ...rel.split("/"));
    if (!existsSync(abs)) {
      throw new Error(`Отсутствует файл пакета: ${rel}`);
    }
    const buf = await readFile(abs);
    files[rel] = buf.toString("base64");
  }
  files["config.json"] = Buffer.from(
    buildLabLoggerConfigJson({ retain_hours: retainHours }),
    "utf8"
  ).toString("base64");
  files["sm-lab-logger.service"] = Buffer.from(
    buildLabLoggerSystemdUserUnit(),
    "utf8"
  ).toString("base64");
  const payloadStr = JSON.stringify({
    version: LAB_LOGGER_VERSION,
    root: LAB_LOGGER_REMOTE_ROOT,
    files,
  });
  const payload = Buffer.from(payloadStr, "utf8");
  const sha256 = createHash("sha256").update(payload).digest("hex");
  return { payload, sha256, fileCount: Object.keys(files).length };
}

/** Upload bytes via SSH stdin → remote cat (short argv; safe on Windows). */
async function uploadRemoteFile(
  remotePath: string,
  data: Buffer,
  opts?: { identityFile?: string; timeoutMs?: number }
): Promise<void> {
  const quoted = JSON.stringify(remotePath);
  await execOnComplexos(`cat > ${quoted}`, {
    timeoutMs: opts?.timeoutMs ?? 90_000,
    identityFile: opts?.identityFile,
    stdin: data,
  });
}

export async function labLoggerStatus(input?: {
  identityFile?: string;
}): Promise<
  { ok: true; status: LabLoggerStatus } | { ok: false; error: string }
> {
  try {
    const { stdout } = await execOnComplexos(buildLabLoggerStatusProbeCmd(), {
      timeoutMs: 20_000,
      softMarker: "###LAB_LOGGER###",
      identityFile: input?.identityFile,
    });
    return { ok: true, status: parseLabLoggerStatusOutput(stdout) };
  } catch (e) {
    return { ok: false, error: sshErrMessage(e) };
  }
}

export async function labLoggerInstall(input?: {
  retainHours?: number;
  enableAutostart?: boolean;
  identityFile?: string;
}): Promise<
  | { ok: true; sha256: string; fileCount: number; message: string }
  | { ok: false; error: string }
> {
  try {
    const retainHours = input?.retainHours ?? 24;
    const { payload, sha256, fileCount } = await buildInstallBundle(retainHours);
    await uploadRemoteFile(LAB_LOGGER_REMOTE_BUNDLE_PATH, payload, {
      identityFile: input?.identityFile,
      timeoutMs: 90_000,
    });
    await execOnComplexos(buildLabLoggerRemoteUnpackCmd(), {
      timeoutMs: 60_000,
      softMarker: "UNPACK_OK",
      identityFile: input?.identityFile,
    });
    if (input?.enableAutostart !== false) {
      await execOnComplexos(buildLabLoggerEnableAutostartCmd(), {
        timeoutMs: 25_000,
        softMarker: "OK",
        identityFile: input?.identityFile,
      });
    } else {
      // Still start once so health is reachable after install
      await execOnComplexos(buildLabLoggerStartCmd(), {
        timeoutMs: 25_000,
        softMarker: "OK",
        identityFile: input?.identityFile,
      });
    }
    // Re-running "Установить" over an already-installed, already-running
    // service used to be a silent no-op for the code itself: unpack writes
    // new files, but `systemctl --user start` on an already-active unit does
    // nothing — the OLD process kept running from memory. A field fix that
    // only touches `tools/complexos-lab-logger` (like the heater-PWM/merge
    // fixes) would silently never take effect without this. `restart` starts
    // a stopped unit exactly like `start` would, so this is safe either way.
    await execOnComplexos(buildLabLoggerRestartCmd(), {
      timeoutMs: 25_000,
      softMarker: "OK",
      identityFile: input?.identityFile,
    });
    return {
      ok: true,
      sha256,
      fileCount,
      message: `Установлено в ${LAB_LOGGER_REMOTE_ROOT} (${fileCount} файлов, sha256=${sha256.slice(0, 12)}…)`,
    };
  } catch (e) {
    return { ok: false, error: sshErrMessage(e) };
  }
}

export async function labLoggerUninstall(input?: {
  wipeData?: boolean;
  identityFile?: string;
}): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  try {
    // Always wipe install tree (code + data + lock); soft if already gone.
    await execOnComplexos(
      buildLabLoggerUninstallCmd({ wipeData: input?.wipeData !== false }),
      {
        timeoutMs: 30_000,
        softMarker: "OK",
        identityFile: input?.identityFile,
      }
    );
    return { ok: true, message: "Логгер снят, следы удалены (soft)" };
  } catch (e) {
    const msg = sshErrMessage(e);
    // Missing unit / already gone → soft success
    if (isLabLoggerMissingUnitError(msg)) {
      return { ok: true, message: "Логгер снят (unit отсутствовал — soft)" };
    }
    return { ok: false, error: msg };
  }
}

export async function labLoggerSetAutostart(input: {
  enabled: boolean;
  identityFile?: string;
}): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  try {
    const cmd = input.enabled
      ? buildLabLoggerEnableAutostartCmd()
      : buildLabLoggerDisableAutostartCmd({ stop: true });
    await execOnComplexos(cmd, {
      timeoutMs: 25_000,
      softMarker: "OK",
      identityFile: input.identityFile,
    });
    return {
      ok: true,
      message: input.enabled ? "Autostart включён" : "Autostart выключен",
    };
  } catch (e) {
    const msg = sshErrMessage(e);
    if (!input.enabled && isLabLoggerMissingUnitError(msg)) {
      return { ok: true, message: "Autostart выключен (unit отсутствовал)" };
    }
    return { ok: false, error: msg };
  }
}

export async function labLoggerSetRetention(input: {
  retainHours: number;
  identityFile?: string;
}): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  try {
    if (!(input.retainHours > 0)) {
      return { ok: false, error: "retainHours must be > 0" };
    }
    const cfg = buildLabLoggerConfigJson({ retain_hours: input.retainHours });
    const path = `${LAB_LOGGER_REMOTE_ROOT}/config.json`;
    await uploadRemoteFile(path, Buffer.from(cfg, "utf8"), {
      identityFile: input.identityFile,
      timeoutMs: 30_000,
    });
    await execOnComplexos(buildLabLoggerRestartCmd(), {
      timeoutMs: 25_000,
      softMarker: "OK",
      identityFile: input.identityFile,
    });
    return {
      ok: true,
      message: `retain_hours=${input.retainHours} записан, unit restart`,
    };
  } catch (e) {
    return { ok: false, error: sshErrMessage(e) };
  }
}

export async function labLoggerFetchHealth(input?: {
  identityFile?: string;
}): Promise<
  | { ok: true; health: LabLoggerHealth }
  | { ok: false; error: string }
> {
  try {
    const { stdout, stderr } = await execOnComplexos(
      `curl -sS --max-time 3 http://127.0.0.1:8765/lab/health || true`,
      { timeoutMs: 12_000, identityFile: input?.identityFile }
    );
    const jsonText = extractFirstJsonObject(stdout) ?? stdout.trim();
    const health = parseLabLoggerHealthJson(jsonText);
    if (!health) {
      const hint = stderr.trim().slice(0, 120);
      return {
        ok: false,
        error: hint
          ? `health недоступен (${hint})`
          : "health недоступен (логгер не запущен?)",
      };
    }
    return { ok: true, health };
  } catch (e) {
    return { ok: false, error: sshErrMessage(e) };
  }
}

export async function labLoggerFetchSnapshot(input?: {
  identityFile?: string;
}): Promise<
  | { ok: true; snapshot: unknown }
  | { ok: false; error: string }
> {
  try {
    const { stdout } = await execOnComplexos(buildLabLoggerSnapshotCurlCmd(), {
      timeoutMs: 15_000,
      identityFile: input?.identityFile,
    });
    const jsonText = extractFirstJsonObject(stdout) ?? stdout.trim();
    const snap = JSON.parse(jsonText) as unknown;
    return { ok: true, snapshot: snap };
  } catch (e) {
    return { ok: false, error: sshErrMessage(e) };
  }
}

export async function labLoggerFetchEvents(input?: {
  fromTs?: number;
  identityFile?: string;
}): Promise<
  | { ok: true; events: unknown[] }
  | { ok: false; error: string }
> {
  try {
    const { stdout } = await execOnComplexos(
      buildLabLoggerEventsCurlCmd({ fromTs: input?.fromTs ?? 0 }),
      { timeoutMs: 20_000, identityFile: input?.identityFile }
    );
    const jsonText = extractFirstJsonObject(stdout) ?? stdout.trim();
    const parsed = JSON.parse(jsonText) as { events?: unknown[] };
    const events = Array.isArray(parsed.events) ? parsed.events : [];
    return { ok: true, events };
  } catch (e) {
    return { ok: false, error: sshErrMessage(e) };
  }
}

export async function labLoggerDownloadRing(input?: {
  identityFile?: string;
}): Promise<
  | { ok: true; path: string; bytes: number }
  | { ok: false; error: string }
> {
  try {
    const remote = `${LAB_LOGGER_REMOTE_ROOT}/${LAB_LOGGER_RING_REL}`;
    const { stdout } = await execOnComplexos(
      `if [ -f '${remote}' ]; then wc -c < '${remote}'; echo '###RING###'; cat '${remote}'; else echo '0'; echo '###RING###'; fi`,
      {
        // Ring is trimmed by retain_hours (default 24h), not by a fixed byte
        // cap — it can legitimately reach tens of MB. A 60s ceiling was
        // observed cutting a real 30MB transfer short over slow SD-card /
        // ProxyJump links; the connection got force-closed mid-`cat` and the
        // partial bytes were silently accepted below (see integrity check).
        // Give large rings realistic headroom instead of relying on that
        // check to fail loudly every time.
        timeoutMs: 240_000,
        softMarker: "###RING###",
        identityFile: input?.identityFile,
      }
    );
    const idx = stdout.indexOf("###RING###");
    if (idx < 0) {
      return { ok: false, error: "Не удалось прочитать ring" };
    }
    // First line is `wc -c` on the remote file, measured *before* transfer.
    // If the SSH channel is torn down mid-`cat` (timeout, dropped tunnel),
    // execSsh2/execOpenSshRemoteOnce still resolve "successfully" because the
    // soft marker had already appeared in the stream — without this check we
    // silently write a truncated .jsonl that only fails much later, when the
    // chart's "Импорт лога" tries to parse the cut-off last line.
    const expectedBytes = Number.parseInt(stdout.slice(0, idx).trim(), 10);
    const body = stdout.slice(idx + "###RING###".length).replace(/^\r?\n/, "");
    const actualBytes = Buffer.byteLength(body, "utf8");
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
    const downloads =
      app.getPath("downloads") || join(homedir(), "Downloads");
    await mkdir(downloads, { recursive: true });
    const defaultName = labLoggerRingDownloadFilename();
    const save = await dialog.showSaveDialog({
      title: "Сохранить ring lab-logger (.jsonl)",
      defaultPath: join(downloads, defaultName),
      // Only .jsonl — Windows often falls back to .txt for unknown filters;
      // ensureLabLoggerRingSavePath forces the extension on the write path.
      filters: [{ name: "JSON Lines (*.jsonl)", extensions: ["jsonl"] }],
    });
    if (save.canceled || !save.filePath) {
      return { ok: false, error: "Сохранение отменено" };
    }
    const dest = ensureLabLoggerRingSavePath(save.filePath, "jsonl");
    if (!dest.toLowerCase().endsWith(".jsonl")) {
      return {
        ok: false,
        error: `Внутренняя ошибка расширения: ${dest}`,
      };
    }
    await writeFile(dest, body, "utf8");
    if (!body.trim()) {
      return {
        ok: true,
        path: dest,
        bytes: 0,
      };
    }
    void dialog.showMessageBox({
      type: "info",
      title: "Бортовой лог",
      message: `Сохранено: ${dest}`,
    });
    return { ok: true, path: dest, bytes: actualBytes };
  } catch (e) {
    return { ok: false, error: sshErrMessage(e) };
  }
}
