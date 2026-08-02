/**
 * Read-only SSH probe на complexos: ft-*-drv + USB (ATOL/Kozen/NIIMBOT).
 * Local: ssh2 → 192.168.1.43 (пароль pi, как drinkx-модули).
 * Remote: отдельный OpenSSH (без LocalForward — сессия уже держит :808x).
 */

import { spawn } from "child_process";
import { Client } from "ssh2";
import { join } from "path";
import { homedir } from "os";
import {
  COMPLEX_SSH_USER,
  DEFAULT_LAN_MAP,
  ERP_JUMP_HOST,
  MODULE_SSH_PASSWORD,
  POS_HOST_PROBE_CMD,
  parsePosHostProbeOutput,
  type PosHostProbe,
} from "@service-monitor/core";
import { resolveSshBinary } from "./dozator-ssh";
import { sshSessionManager } from "./ssh-session-manager";

function identityPath(): string {
  return join(homedir(), ".ssh", "id_ed25519");
}

function complexosLanIp(): string {
  const entry = DEFAULT_LAN_MAP.find((e) => e.role === "complexos");
  return entry?.ip ?? "192.168.1.43";
}

function execSsh2(input: {
  host: string;
  port: number;
  command: string;
  timeoutMs: number;
  label: string;
}): Promise<string> {
  const { host, port, command, timeoutMs, label } = input;
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
          let stdout = "";
          let stderr = "";
          stream
            .on("close", (code: number | null) => {
              clearTimeout(timer);
              try {
                conn.end();
              } catch {
                // ignore
              }
              if (code === 0 || stdout.includes("###UNITS###")) {
                resolve(stdout);
              } else {
                reject(
                  new Error(
                    stderr.trim() ||
                      stdout.trim() ||
                      `remote exit ${code} (${label})`
                  )
                );
              }
            })
            .on("data", (d: Buffer) => {
              stdout += d.toString();
            });
          stream.stderr.on("data", (d: Buffer) => {
            stderr += d.toString();
          });
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

function execOpenSshRemote(input: {
  sshPort: number;
  identityFile: string;
  command: string;
  timeoutMs: number;
}): Promise<string> {
  const { sshPort, identityFile, command, timeoutMs } = input;
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
    console.log("[pos-host] ssh remote", args.slice(0, -1).join(" "), "…");

    const child = spawn(ssh, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`SSH timeout (remote :${sshPort})`));
    }, timeoutMs);

    child.stdout?.on("data", (b: Buffer) => {
      out += b.toString();
    });
    child.stderr?.on("data", (b: Buffer) => {
      err += b.toString();
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 || out.includes("###UNITS###")) resolve(out);
      else
        reject(
          new Error(
            err.trim() ||
              out.trim() ||
              `ssh exit ${code} (remote Host ${sshPort})`
          )
        );
    });
  });
}

export async function probePosHost(input?: {
  timeoutMs?: number;
  identityFile?: string;
}): Promise<
  { ok: true; probe: PosHostProbe } | { ok: false; error: string }
> {
  const timeoutMs = input?.timeoutMs ?? 18_000;
  const session = sshSessionManager.getSnapshot();
  if (!session.connected) {
    return {
      ok: false,
      error: "Нужна активная сессия (вкладка Сессия)",
    };
  }

  try {
    let stdout: string;
    if (session.mode === "local") {
      const ip = complexosLanIp();
      stdout = await execSsh2({
        host: ip,
        port: 22,
        command: POS_HOST_PROBE_CMD,
        timeoutMs,
        label: `${COMPLEX_SSH_USER}@${ip}`,
      });
    } else if (session.mode === "remote") {
      const sshPort = session.sshPort;
      if (sshPort == null) {
        return { ok: false, error: "Remote-сессия без sshPort" };
      }
      stdout = await execOpenSshRemote({
        sshPort,
        identityFile: input?.identityFile ?? identityPath(),
        command: POS_HOST_PROBE_CMD,
        timeoutMs,
      });
    } else {
      return { ok: false, error: "Сессия без режима local/remote" };
    }

    const probe = parsePosHostProbeOutput(stdout);
    return { ok: true, probe };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
