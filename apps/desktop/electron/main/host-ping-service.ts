/**
 * Host ping agent — SSH install/control on complexos (soft-fail).
 * Sibling of lab-logger; separate paths/unit/names.
 * Local: ssh2 → 192.168.1.43:22; Remote: OpenSSH jump like lab-logger.
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
  MODULE_SSH_PASSWORD,
  HOST_PING_PACKAGE_FILES,
  HOST_PING_VERSION,
  HOST_PING_REMOTE_BUNDLE_PATH,
  HOST_PING_REMOTE_ROOT,
  HOST_PING_RING_REL,
  buildHostPingConfigJson,
  buildHostPingDisableAutostartCmd,
  buildHostPingEnableAutostartCmd,
  buildHostPingRemoteOpenSshArgs,
  buildHostPingRemoteUnpackCmd,
  buildHostPingRestartCmd,
  buildHostPingStartCmd,
  buildHostPingStatusProbeCmd,
  buildHostPingSystemdUserUnit,
  buildHostPingTailCmd,
  buildHostPingUninstallCmd,
  ensureHostPingRingSavePath,
  formatHostPingSshError,
  hostPingRingDownloadFilename,
  isHostPingMissingUnitError,
  formatHostPingLogTextForDisplay,
  parseHostPingRingDownloadStdout,
  parseHostPingStatusOutput,
  parseHostPingTailStdout,
  resolveHostPingSshTarget,
  stripHostPingSshNoise,
  type HostPingStatus,
} from "@service-monitor/core";
import { resolveSshBinary } from "./dozator-ssh";
import { sshSessionManager } from "./ssh-session-manager";

function identityPath(): string {
  return join(homedir(), ".ssh", "id_ed25519");
}

function sshErrMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return formatHostPingSshError(raw);
}

function complexosLanIp(): string {
  const entry = DEFAULT_LAN_MAP.find((e) => e.role === "complexos");
  return entry?.ip ?? "192.168.1.43";
}

export function resolveHostPingPackageRoot(): string | null {
  const candidates = [
    join(process.cwd(), "tools", "complexos-host-ping"),
    join(process.cwd(), "..", "..", "tools", "complexos-host-ping"),
    join(__dirname, "..", "..", "..", "..", "tools", "complexos-host-ping"),
    join("C:", "myApp", "service-monitor", "tools", "complexos-host-ping"),
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
              const soft = softMarker != null && stdout.includes(softMarker);
              if (code === 0 || soft || code == null) {
                resolve({ stdout, stderr, code });
              } else {
                const msg =
                  stripHostPingSshNoise(stderr) ||
                  stripHostPingSshNoise(stdout) ||
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
          if (stdin && stdin.length > 0) stream.write(stdin);
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
    const args = buildHostPingRemoteOpenSshArgs({
      sshPort,
      identityFile,
      command,
    });
    const child = spawn(ssh, args, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
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
        stripHostPingSshNoise(err) ||
        stripHostPingSshNoise(out) ||
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
  const target = resolveHostPingSshTarget(session, complexosLanIp());
  if (target.mode === "local") {
    return execSsh2({
      host: target.host,
      port: target.port,
      command,
      timeoutMs,
      label: `local ${target.host}`,
      softMarker,
      stdin,
    });
  }
  return execOpenSshRemote({
    sshPort: target.sshPort,
    identityFile: opts?.identityFile ?? identityPath(),
    command,
    timeoutMs,
    softMarker,
    stdin,
  });
}

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

async function buildInstallBundle(input: {
  tabletIp?: string;
  tabletMac?: string;
}): Promise<{ payload: Buffer; sha256: string; fileCount: number }> {
  const root = resolveHostPingPackageRoot();
  if (!root) {
    throw new Error(
      "Не найден tools/complexos-host-ping (нужен monorepo / артефакт пакета)"
    );
  }
  const files: Record<string, string> = {};
  for (const rel of HOST_PING_PACKAGE_FILES) {
    const abs = join(root, ...rel.split("/"));
    if (!existsSync(abs)) throw new Error(`Отсутствует файл пакета: ${rel}`);
    files[rel] = (await readFile(abs)).toString("base64");
  }
  files["config.json"] = Buffer.from(
    buildHostPingConfigJson({
      tabletIp: input.tabletIp,
      tabletMac: input.tabletMac,
    }),
    "utf8"
  ).toString("base64");
  files["sm-host-ping.service"] = Buffer.from(
    buildHostPingSystemdUserUnit(),
    "utf8"
  ).toString("base64");
  const payloadStr = JSON.stringify({
    version: HOST_PING_VERSION,
    root: HOST_PING_REMOTE_ROOT,
    files,
  });
  const payload = Buffer.from(payloadStr, "utf8");
  const sha256 = createHash("sha256").update(payload).digest("hex");
  return { payload, sha256, fileCount: Object.keys(files).length };
}

export async function hostPingStatus(input?: {
  identityFile?: string;
}): Promise<
  { ok: true; status: HostPingStatus } | { ok: false; error: string }
> {
  try {
    const { stdout } = await execOnComplexos(buildHostPingStatusProbeCmd(), {
      timeoutMs: 20_000,
      softMarker: "###HOST_PING###",
      identityFile: input?.identityFile,
    });
    return { ok: true, status: parseHostPingStatusOutput(stdout) };
  } catch (e) {
    return { ok: false, error: sshErrMessage(e) };
  }
}

export async function hostPingInstall(input: {
  tabletIp?: string;
  tabletMac?: string;
  enableAutostart?: boolean;
  identityFile?: string;
}): Promise<
  | { ok: true; sha256: string; fileCount: number; message: string }
  | { ok: false; error: string }
> {
  try {
    const tip = (input.tabletIp ?? "").trim();
    const tmac = (input.tabletMac ?? "").trim();
    if (!tip && !tmac) {
      return { ok: false, error: "Нужен IP или MAC планшета — установка отменена" };
    }
    const { payload, sha256, fileCount } = await buildInstallBundle({
      tabletIp: tip || undefined,
      tabletMac: tmac || undefined,
    });
    await uploadRemoteFile(HOST_PING_REMOTE_BUNDLE_PATH, payload, {
      identityFile: input.identityFile,
      timeoutMs: 90_000,
    });
    await execOnComplexos(buildHostPingRemoteUnpackCmd(), {
      timeoutMs: 60_000,
      softMarker: "UNPACK_OK",
      identityFile: input.identityFile,
    });
    if (input.enableAutostart !== false) {
      await execOnComplexos(buildHostPingEnableAutostartCmd(), {
        timeoutMs: 20_000,
        softMarker: "OK",
        identityFile: input.identityFile,
      });
    } else {
      await execOnComplexos(buildHostPingStartCmd(), {
        timeoutMs: 15_000,
        softMarker: "OK",
        identityFile: input.identityFile,
      });
    }
    await execOnComplexos(buildHostPingRestartCmd(), {
      timeoutMs: 15_000,
      softMarker: "OK",
      identityFile: input.identityFile,
    });
    // Brief pause to let systemd activate the unit, then validate.
    await delay(1_500);
    let unitNote = "";
    try {
      const probe = await hostPingStatus({ identityFile: input.identityFile });
      if (probe.ok) {
        const s = probe.status;
        if (s.unitActive === "inactive" || s.unitActive === "failed") {
          unitNote = ` ⚠ unit=${s.unitActive} — проверьте конфиг или journalctl --user -u sm-host-ping`;
        }
      }
    } catch {
      // soft-fail: unit note is informational only
    }
    return {
      ok: true,
      sha256,
      fileCount,
      message: `Host ping установлен (${fileCount} файлов, sha256=${sha256.slice(0, 12)}…)${unitNote}`,
    };
  } catch (e) {
    return { ok: false, error: sshErrMessage(e) };
  }
}

export async function hostPingUninstall(input?: {
  wipeData?: boolean;
  identityFile?: string;
}): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  try {
    await execOnComplexos(
      buildHostPingUninstallCmd({ wipeData: input?.wipeData !== false }),
      {
        timeoutMs: 30_000,
        softMarker: "OK",
        identityFile: input?.identityFile,
      }
    );
    return { ok: true, message: "Host ping удалён" };
  } catch (e) {
    const msg = sshErrMessage(e);
    if (isHostPingMissingUnitError(msg)) {
      return { ok: true, message: "Host ping уже отсутствует (soft)" };
    }
    return { ok: false, error: msg };
  }
}

export async function hostPingSetAutostart(input: {
  enabled: boolean;
  identityFile?: string;
}): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  try {
    const cmd = input.enabled
      ? buildHostPingEnableAutostartCmd()
      : buildHostPingDisableAutostartCmd({ stop: true });
    await execOnComplexos(cmd, {
      timeoutMs: 20_000,
      softMarker: "OK",
      identityFile: input.identityFile,
    });
    return {
      ok: true,
      message: input.enabled ? "Autostart включён" : "Autostart выключен",
    };
  } catch (e) {
    const msg = sshErrMessage(e);
    if (!input.enabled && isHostPingMissingUnitError(msg)) {
      return { ok: true, message: "Autostart выключен (unit отсутствует)" };
    }
    return { ok: false, error: msg };
  }
}

export async function hostPingSetTablet(input: {
  tabletIp?: string;
  tabletMac?: string;
  identityFile?: string;
}): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  try {
    const tip = (input.tabletIp ?? "").trim();
    const tmac = (input.tabletMac ?? "").trim();
    if (!tip && !tmac) {
      return { ok: false, error: "Нужен IP или MAC планшета" };
    }
    const cfg = buildHostPingConfigJson({
      tabletIp: tip || undefined,
      tabletMac: tmac || undefined,
    });
    const remote = `${HOST_PING_REMOTE_ROOT}/config.json`;
    await uploadRemoteFile(remote, Buffer.from(cfg, "utf8"), {
      identityFile: input.identityFile,
    });
    await execOnComplexos(buildHostPingRestartCmd(), {
      timeoutMs: 15_000,
      softMarker: "OK",
      identityFile: input.identityFile,
    });
    return { ok: true, message: "Цели планшета записаны в config.json" };
  } catch (e) {
    return { ok: false, error: sshErrMessage(e) };
  }
}

export async function hostPingDownloadRing(input?: {
  identityFile?: string;
}): Promise<
  { ok: true; path: string; bytes: number } | { ok: false; error: string }
> {
  try {
    const remote = `${HOST_PING_REMOTE_ROOT}/${HOST_PING_RING_REL}`;
    const { stdout } = await execOnComplexos(
      `if [ -f '${remote}' ]; then wc -c < '${remote}'; echo '###RING###'; cat '${remote}'; else echo '0'; echo '###RING###'; fi`,
      {
        timeoutMs: 120_000,
        softMarker: "###RING###",
        identityFile: input?.identityFile,
      }
    );
    const parsed = parseHostPingRingDownloadStdout(stdout);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const downloads = app.getPath("downloads") || join(homedir(), "Downloads");
    await mkdir(downloads, { recursive: true });
    const save = await dialog.showSaveDialog({
      title: "Сохранить лог доступности (.jsonl)",
      defaultPath: join(downloads, hostPingRingDownloadFilename()),
      filters: [{ name: "JSON Lines (*.jsonl)", extensions: ["jsonl"] }],
    });
    if (save.canceled || !save.filePath) {
      return { ok: false, error: "Сохранение отменено" };
    }
    const dest = ensureHostPingRingSavePath(save.filePath, "jsonl");
    await writeFile(dest, parsed.body, "utf8");
    void dialog.showMessageBox({
      type: "info",
      title: "Доступность",
      message: `Сохранено: ${dest}`,
    });
    return { ok: true, path: dest, bytes: parsed.actualBytes };
  } catch (e) {
    return { ok: false, error: sshErrMessage(e) };
  }
}

export async function hostPingFetchRecent(input?: {
  identityFile?: string;
  lines?: number;
}): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  try {
    const { stdout } = await execOnComplexos(
      buildHostPingTailCmd({ lines: input?.lines ?? 40 }),
      {
        timeoutMs: 20_000,
        softMarker: "###TAIL###",
        identityFile: input?.identityFile,
      }
    );
    const raw = parseHostPingTailStdout(stdout);
    return { ok: true, text: formatHostPingLogTextForDisplay(raw) };
  } catch (e) {
    return { ok: false, error: sshErrMessage(e) };
  }
}

