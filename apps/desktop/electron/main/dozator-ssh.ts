/**
 * Общий SSH к Host `dozator` (syrup + flash_sirup).
 */

import { spawn, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import { BrowserWindow } from "electron";

export function resolveSshBinary(): string {
  if (process.platform === "win32") {
    const candidates = [
      "C:\\Program Files\\Git\\usr\\bin\\ssh.exe",
      "C:\\Windows\\System32\\OpenSSH\\ssh.exe",
    ];
    return candidates.find((c) => existsSync(c)) || "ssh";
  }
  return "ssh";
}

export type DozatorSshOptions = {
  timeoutMs?: number;
  /** Stream stdout/stderr lines to renderer channel (e.g. flash:log). */
  logChannel?: string;
  logLevel?: "log" | "error";
};

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

const SSH_WARNINGS = [
  "post-quantum",
  "Permanently added",
  "remote port forwarding failed",
  "Warning:",
];

/**
 * Запуск удалённой команды на Host `dozator`.
 * @returns stdout (stderr warnings may be mixed into log stream)
 */
export function runDozatorSsh(
  remoteCmd: string,
  options: DozatorSshOptions = {}
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const logChannel = options.logChannel;

  return new Promise((resolve, reject) => {
    const ssh = resolveSshBinary();
    const args = [
      "-T",
      "-o",
      "ClearAllForwardings=yes",
      "-o",
      "ConnectTimeout=15",
      "dozator",
      remoteCmd,
    ];
    console.log("[dozator] ssh", args.join(" "));

    const child: ChildProcess = spawn(ssh, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let out = "";
    let err = "";

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("dozator SSH timeout"));
    }, timeoutMs);

    const emit = (level: "log" | "error", message: string) => {
      if (!logChannel || !message.trim()) return;
      broadcast(logChannel, { level, message });
    };

    child.stdout?.on("data", (b: Buffer) => {
      const text = b.toString();
      out += text;
      emit("log", text);
    });

    child.stderr?.on("data", (b: Buffer) => {
      const text = b.toString();
      err += text;
      const isWarn = SSH_WARNINGS.some((w) => text.includes(w));
      emit(isWarn ? "log" : "error", text);
    });

    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else
        reject(
          new Error(err.trim() || out.trim() || `dozator ssh exit ${code}`)
        );
    });
  });
}
