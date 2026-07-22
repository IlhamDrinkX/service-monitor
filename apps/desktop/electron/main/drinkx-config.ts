/**
 * Чтение/запись drinkx.json через ssh2 + пароль pi.
 * ASKPASS OpenSSH на Windows нестабилен — пароль передаём явно.
 *
 * Local:  host 192.168.1.4x:22
 * Remote: host 127.0.0.1:2204x (LocalForward сессии → модуль:22)
 */

import { Client } from "ssh2";
import { appendFile, mkdir } from "fs/promises";
import { join } from "path";
import { app } from "electron";
import {
  COMPLEX_SSH_USER,
  DRINKX_REMOTE_PATH,
  MODULE_SSH_PASSWORD,
  moduleLanIp,
  moduleSshLocalPort,
} from "@service-monitor/core";
import { sshSessionManager } from "./ssh-session-manager";

export type DrinkxModuleRole = "milk" | "coffee" | "water";

function moduleEndpoint(role: DrinkxModuleRole): {
  host: string;
  port: number;
  label: string;
} {
  const session = sshSessionManager.getSnapshot();
  if (!session.connected) {
    throw new Error("Нужна активная сессия (вкладка Сессия)");
  }
  const ip = moduleLanIp(role);

  if (session.mode === "local") {
    return { host: ip, port: 22, label: `${COMPLEX_SSH_USER}@${ip} (пароль pi)` };
  }
  if (session.mode === "remote") {
    const port = moduleSshLocalPort(role);
    return {
      host: "127.0.0.1",
      port,
      label: `туннель :${port}→${ip} (пароль pi)`,
    };
  }
  throw new Error("Сессия без режима local/remote");
}

function execOnModule(
  role: DrinkxModuleRole,
  command: string,
  opts: { timeoutMs?: number; acceptNullExit?: boolean } = {}
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const acceptNullExit = opts.acceptNullExit === true;

  return new Promise((resolve, reject) => {
    void (async () => {
      const { host, port, label } = moduleEndpoint(role);
      console.log("[drinkx] ssh2 password", label, "cmd=", command.slice(0, 60));

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
                // ssh2 даёт code=null, если канал оборвался (типично при restart сервиса).
                const ok =
                  code === 0 ||
                  (code == null &&
                    (acceptNullExit ||
                      /CM_DRV_RESTART|ok|done/i.test(stdout + stderr)));
                if (ok) resolve({ stdout, stderr, code });
                else
                  reject(
                    new Error(
                      stderr.trim() ||
                        stdout.trim() ||
                        `remote exit ${code} (${label})`
                    )
                  );
              })
              .on("data", (d: Buffer) => {
                stdout += d.toString();
              });
            stream.stderr.on("data", (d: Buffer) => {
              stderr += d.toString();
            });
          });
        })
        .on("keyboard-interactive", (_name, _instr, _lang, prompts, finish) => {
          finish(prompts.map(() => MODULE_SSH_PASSWORD));
        })
        .on("error", (e) => {
          clearTimeout(timer);
          reject(
            new Error(`${e.message} (${label}). Проверьте сессию и пароль pi.`)
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
    })().catch(reject);
  });
}

async function audit(entry: Record<string, unknown>): Promise<void> {
  const dir = join(app.getPath("userData"), "audit-logs");
  await mkdir(dir, { recursive: true });
  const line =
    JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n";
  await appendFile(join(dir, "drinkx-audit.jsonl"), line, "utf8");
}

export async function readDrinkxJson(role: DrinkxModuleRole): Promise<
  | {
      ok: true;
      role: DrinkxModuleRole;
      path: string;
      text: string;
      label: string;
    }
  | { ok: false; error: string }
> {
  try {
    const { label } = moduleEndpoint(role);
    const { stdout } = await execOnModule(role, `cat ${DRINKX_REMOTE_PATH}`);
    const text = stdout.trim();
    if (!text.startsWith("{") && !text.startsWith("[")) {
      return {
        ok: false,
        error: `Ответ не похож на JSON (${label}): ${text.slice(0, 120)}`,
      };
    }
    JSON.parse(text);
    await audit({ action: "read", role, path: DRINKX_REMOTE_PATH, label });
    return { ok: true, role, path: DRINKX_REMOTE_PATH, text, label };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Перезапуск cm-drv на модуле после записи drinkx.json. */
export async function restartCmDrv(
  role: DrinkxModuleRole
): Promise<
  | { ok: true; role: DrinkxModuleRole; label: string; detail: string }
  | { ok: false; error: string }
> {
  try {
    const { label } = moduleEndpoint(role);
    // Рестарт в фоне + сразу echo — иначе ssh2 часто закрывает канал с code=null
    // и UI показывает «remote exit null».
    const cmd = [
      "nohup bash -c '",
      "systemctl --user restart cm-drv 2>/dev/null",
      " || systemctl restart cm-drv 2>/dev/null",
      " || (command -v pm2 >/dev/null && pm2 restart cm-drv)",
      " || true",
      "' >/tmp/sm-cm-drv-restart.log 2>&1 &",
      " echo CM_DRV_RESTART_QUEUED",
    ].join("");
    const { stdout, stderr } = await execOnModule(role, cmd, {
      timeoutMs: 15_000,
      acceptNullExit: true,
    });
    const detail = (stdout || stderr || "queued").trim().slice(0, 200);
    await audit({ action: "restart-cm-drv", role, label, detail });
    return { ok: true, role, label, detail };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function writeDrinkxJson(input: {
  role: DrinkxModuleRole;
  text: string;
  unlocked: boolean;
  restart?: boolean;
}): Promise<
  | {
      ok: true;
      role: DrinkxModuleRole;
      path: string;
      label: string;
      restarted?: boolean;
      restartDetail?: string;
    }
  | { ok: false; error: string }
> {
  if (!input.unlocked) {
    return { ok: false, error: "Сначала разблокируйте правки (Настройки)" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.text);
  } catch {
    return { ok: false, error: "Невалидный JSON" };
  }
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, error: "JSON должен быть объектом" };
  }

  try {
    const { label } = moduleEndpoint(input.role);
    const normalized = `${JSON.stringify(parsed, null, 2)}\n`;
    const b64 = Buffer.from(normalized, "utf8").toString("base64");
    await execOnModule(
      input.role,
      `echo ${b64} | base64 -d > ${DRINKX_REMOTE_PATH}`
    );
    await audit({
      action: "write",
      role: input.role,
      path: DRINKX_REMOTE_PATH,
      label,
      bytes: normalized.length,
    });

    // Write ok even if optional restart fails — не маскируем успех записи.
    let restarted: boolean | undefined;
    let restartDetail: string | undefined;
    if (input.restart === true) {
      const r = await restartCmDrv(input.role);
      restarted = r.ok;
      restartDetail = r.ok ? r.detail : r.error;
    }

    return {
      ok: true,
      role: input.role,
      path: DRINKX_REMOTE_PATH,
      label,
      restarted,
      restartDetail,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
