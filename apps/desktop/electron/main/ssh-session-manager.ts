/**
 * Управление сессией комплекса в main-процессе.
 * Local: строгий HTTP-probe + NATS (TCP connect недостаточно — ложные online).
 */

import { spawn, type ChildProcess } from "child_process";
import http from "http";
import { createConnection } from "net";
import {
  DEFAULT_LAN_MAP,
  ERP_JUMP_HOST,
  MODULE_SSH_FORWARDS,
  NATS_TUNNEL_URL,
  NATS_LAN_URL,
  NATS_LAN_HOST,
  NATS_LAN_PORT,
  NATS_TUNNEL_HOST,
  NATS_TUNNEL_PORT,
  NATS_REMOTE_FORWARD_TARGET,
  COMPLEX_SSH_USER,
  emptySession,
  devicesFromOnlineMap,
  isLanModulesReachable,
  lanHttpProbeSpecs,
  tunnelHttpProbeSpecs,
  type ComplexSessionSnapshot,
  type ModuleRole,
  type SessionFailureReason,
  type SessionMode,
} from "@service-monitor/core";
import {
  discoverLanNeighbors,
  mergeDiscoveredDevices,
  withStickyExtras,
  clearDiscoveryCache,
} from "./lan-discovery";

export class ComplexSessionManager {
  private child: ChildProcess | null = null;
  private snapshot: ComplexSessionSnapshot = emptySession();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  /** Сколько подряд remote-probe провалились (анти-мигание после сна/нагрузки). */
  private remoteProbeFailStreak = 0;

  getSnapshot(): ComplexSessionSnapshot {
    return {
      ...this.snapshot,
      devices: this.snapshot.devices.map((d) => ({ ...d })),
    };
  }

  async connect(input: {
    mode: SessionMode;
    seriesLabel?: string;
    identityFile: string;
  }): Promise<ComplexSessionSnapshot> {
    if (input.mode === "local") {
      return this.connectLocal();
    }
    return this.connectRemote({
      seriesLabel: input.seriesLabel ?? "",
      identityFile: input.identityFile,
    });
  }

  async connectLocal(): Promise<ComplexSessionSnapshot> {
    await this.disconnect("not_connected");

    const { devices, natsOnline, detail } = await probeLanStack("local");
    if (!isLanModulesReachable(devices, natsOnline)) {
      this.snapshot = {
        ...emptySession("lan_unreachable"),
        mode: "local",
        devices,
        natsOnline,
        message: `Не в сети с комплексом (${detail})`,
      };
      this.startHeartbeat();
      return this.getSnapshot();
    }

    const now = new Date().toISOString();
    this.snapshot = {
      connected: true,
      mode: "local",
      seriesLabel: null,
      sshPort: null,
      startedAt: now,
      lastAliveAt: now,
      natsUrl: NATS_LAN_URL,
      natsOnline: true,
      failureReason: null,
      message: "Local LAN · HTTP модулей + NATS ok",
      devices,
    };
    this.startHeartbeat();
    return this.getSnapshot();
  }

  async connectRemote(input: {
    seriesLabel: string;
    identityFile: string;
  }): Promise<ComplexSessionSnapshot> {
    await this.disconnect("not_connected");

    const seriesLabel = input.seriesLabel.trim();
    const m = /^(\d+)\.(\d+)$/.exec(seriesLabel);
    if (!m) {
      return this.fail("connect_failed", 'Серия должна быть вида "4.15"');
    }
    const sshPort = 22000 + Number(m[1]) * 100 + Number(m[2]);

    const forwards = DEFAULT_LAN_MAP.flatMap((e) => [
      "-L",
      `127.0.0.1:${e.localPort}:${e.ip}:${e.remotePort}`,
    ]);
    // NATS на complexos слушает localhost — цель форварда резолвится на удалённой Pi
    forwards.push(
      "-L",
      `127.0.0.1:${NATS_TUNNEL_PORT}:${NATS_REMOTE_FORWARD_TARGET}`
    );
    // SSH на модули (drinkx.json) — прямой туннель, без nested ssh
    for (const m of MODULE_SSH_FORWARDS) {
      forwards.push("-L", `127.0.0.1:${m.localPort}:${m.ip}:22`);
    }

    const args = [
      "-N",
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "UserKnownHostsFile=/dev/null",
      "-o",
      "ExitOnForwardFailure=yes",
      "-o",
      "ServerAliveInterval=15",
      "-o",
      "ServerAliveCountMax=3",
      "-i",
      input.identityFile,
      "-J",
      `tun@${ERP_JUMP_HOST}`,
      "-p",
      String(sshPort),
      ...forwards,
      `${COMPLEX_SSH_USER}@localhost`,
    ];

    console.log("[session] ssh", args.join(" "));

    const child = spawn("ssh", args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;

    let stderr = "";
    child.stderr.on("data", (buf: Buffer) => {
      stderr += buf.toString();
      console.warn("[session] ssh stderr:", buf.toString().trim());
    });

    child.on("exit", (code, signal) => {
      console.warn("[session] ssh exited", code, signal);
      if (this.child === child) {
        this.child = null;
        this.stopHeartbeat();
        this.snapshot = {
          ...emptySession("process_dead"),
          mode: "remote",
          seriesLabel,
          sshPort,
          message: `SSH завершился (code=${code ?? "?"}${signal ? ` signal=${signal}` : ""})`,
        };
      }
    });

    const ok = await waitForLocalPort(8080, 12_000, () => child.exitCode != null);
    if (!ok || child.exitCode != null) {
      this.killChild();
      return this.fail(
        "connect_failed",
        stderr.trim() || "Не удалось поднять SSH-туннель (таймаут / ошибка)"
      );
    }

    // Форварды прогреваются после -N; один короткий probe часто ложный.
    await sleepMs(700);
    const { devices, natsOnline, detail } = await probeLanStack("remote", {
      attempts: 3,
      timeoutMs: 2_800,
    });
    this.remoteProbeFailStreak = natsOnline ? 0 : 1;
    const now = new Date().toISOString();
    this.snapshot = {
      connected: true,
      mode: "remote",
      seriesLabel,
      sshPort,
      startedAt: now,
      lastAliveAt: now,
      natsUrl: NATS_TUNNEL_URL,
      natsOnline,
      failureReason: null,
      message: natsOnline
        ? `Remote SSH · порт ${sshPort}`
        : `Remote SSH · порт ${sshPort} · прогрев… (${detail})`,
      devices,
    };
    this.startHeartbeat();
    return this.getSnapshot();
  }

  async disconnect(
    reason: SessionFailureReason = "not_connected"
  ): Promise<ComplexSessionSnapshot> {
    this.stopHeartbeat();
    this.killChild();
    this.remoteProbeFailStreak = 0;
    clearDiscoveryCache();
    this.snapshot = emptySession(reason);
    if (reason === "not_connected") {
      this.snapshot.message = "Сессия отключена";
    }
    return this.getSnapshot();
  }

  async refreshNetwork(): Promise<ComplexSessionSnapshot> {
    const snap = await this.heartbeatOrProbe();
    try {
      const { neighbors, error } = await discoverLanNeighbors();
      const merged = mergeDiscoveredDevices(snap.devices, neighbors);
      const extraOnline = merged.filter(
        (d) => d.role === "unknown" && d.online
      ).length;
      const extraSticky = merged.filter((d) => d.role === "unknown").length;
      let message = snap.message;
      if (error) {
        message = `${snap.message} · ARP ошибка: ${error.slice(0, 120)}`;
      } else if (extraSticky > 0) {
        message = `${snap.message} · соседи complexos: ${extraOnline}/${extraSticky}`;
      } else {
        message = `${snap.message} · в ARP complexos нет других устройств с MAC`;
      }
      this.snapshot = {
        ...this.getSnapshot(),
        devices: merged,
        message,
      };
    } catch (e) {
      console.warn("[session] discovery skip", e);
      this.snapshot = {
        ...this.getSnapshot(),
        message: `${snap.message} · discovery fail`,
      };
    }
    return this.getSnapshot();
  }

  /** Heartbeat если сессия есть, иначе одноразовый local probe. */
  private async heartbeatOrProbe(): Promise<ComplexSessionSnapshot> {
    if (this.snapshot.mode === "local" || this.snapshot.connected) {
      return this.heartbeat();
    }
    const { devices, natsOnline, detail } = await probeLanStack("local");
    const reachable = isLanModulesReachable(devices, natsOnline);
    this.snapshot = {
      ...this.snapshot,
      devices,
      natsOnline,
      message: reachable
        ? "LAN видна — можно подключить Local"
        : `LAN недоступна (${detail})`,
    };
    return this.getSnapshot();
  }

  async heartbeat(): Promise<ComplexSessionSnapshot> {
    if (this.snapshot.mode === "local") {
      return this.heartbeatLocal();
    }
    if (!this.snapshot.connected && this.snapshot.mode !== "remote") {
      return this.getSnapshot();
    }
    return this.heartbeatRemote();
  }

  private async heartbeatLocal(): Promise<ComplexSessionSnapshot> {
    const { devices, natsOnline, detail } = await probeLanStack("local");
    const reachable = isLanModulesReachable(devices, natsOnline);
    const now = new Date().toISOString();

    if (!reachable) {
      this.snapshot = {
        ...this.snapshot,
        connected: false,
        mode: "local",
        devices: withStickyExtras(devices),
        natsOnline,
        failureReason: "lan_unreachable",
        message: `Нет связи с комплексом (${detail})`,
        lastAliveAt: this.snapshot.lastAliveAt,
        natsUrl: null,
      };
      return this.getSnapshot();
    }

    this.snapshot = {
      ...this.snapshot,
      connected: true,
      mode: "local",
      devices: withStickyExtras(devices),
      natsOnline: true,
      lastAliveAt: now,
      failureReason: null,
      natsUrl: NATS_LAN_URL,
      message: "Local LAN · HTTP модулей + NATS ok",
      startedAt: this.snapshot.startedAt ?? now,
    };
    return this.getSnapshot();
  }

  private async heartbeatRemote(): Promise<ComplexSessionSnapshot> {
    if (this.snapshot.mode !== "remote") {
      return this.getSnapshot();
    }
    if (!this.child || this.child.exitCode != null) {
      this.stopHeartbeat();
      this.remoteProbeFailStreak = 0;
      this.snapshot = {
        ...emptySession("process_dead"),
        mode: "remote",
        seriesLabel: this.snapshot.seriesLabel,
        sshPort: this.snapshot.sshPort,
        message: "SSH-процесс не активен",
      };
      return this.getSnapshot();
    }

    // После сна порт может «ожить» с задержкой — не убивать туннель с первого фейла.
    let portOk = await waitForLocalPort(8080, 2_500, () => false);
    if (!portOk) {
      await sleepMs(900);
      portOk = await waitForLocalPort(8080, 3_500, () => false);
    }
    if (!portOk) {
      this.killChild();
      this.stopHeartbeat();
      this.remoteProbeFailStreak = 0;
      this.snapshot = {
        ...emptySession("expired"),
        mode: "remote",
        seriesLabel: this.snapshot.seriesLabel,
        sshPort: this.snapshot.sshPort,
        message: "Сессия протухла (туннель не отвечает)",
        lastAliveAt: this.snapshot.lastAliveAt,
      };
      return this.getSnapshot();
    }

    // Туннель жив — сессия connected, даже если HTTP/NATS probe мигнул.
    const { devices, natsOnline, detail } = await probeLanStack("remote", {
      attempts: 2,
      timeoutMs: 2_500,
    });

    if (natsOnline) {
      this.remoteProbeFailStreak = 0;
    } else {
      this.remoteProbeFailStreak += 1;
    }
    // Нужны 2 подряд fail, чтобы снять natsOnline (после крышки/нагрузки).
    const stableNats =
      natsOnline ||
      (this.remoteProbeFailStreak < 2 && this.snapshot.natsOnline === true);

    const now = new Date().toISOString();
    this.snapshot = {
      ...this.snapshot,
      connected: true,
      mode: "remote",
      lastAliveAt: now,
      failureReason: stableNats ? null : "expired",
      message: stableNats
        ? `Remote SSH · порт ${this.snapshot.sshPort}`
        : `Туннель жив · NATS/модули временно недоступны (${detail})`,
      natsUrl: NATS_TUNNEL_URL,
      natsOnline: stableNats,
      devices: withStickyExtras(
        mergeDeviceOnlineSticky(this.snapshot.devices, devices, stableNats)
      ),
    };
    return this.getSnapshot();
  }

  /** Туннель жив? (для resume — не рвать рабочий SSH). */
  isRemoteTunnelAlive(): boolean {
    return (
      this.snapshot.mode === "remote" &&
      this.child != null &&
      this.child.exitCode == null
    );
  }

  private fail(
    reason: SessionFailureReason,
    message: string
  ): ComplexSessionSnapshot {
    this.snapshot = { ...emptySession(reason), message };
    return this.getSnapshot();
  }

  private killChild(): void {
    if (!this.child) return;
    try {
      this.child.kill();
    } catch {
      // ignore
    }
    this.child = null;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      void this.heartbeat();
    }, 10_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

async function probeLanStack(
  mode: "local" | "remote",
  opts: { attempts?: number; timeoutMs?: number } = {}
): Promise<{
  devices: ReturnType<typeof devicesFromOnlineMap>;
  natsOnline: boolean;
  detail: string;
}> {
  const attempts = Math.max(1, opts.attempts ?? 1);
  const timeoutMs = opts.timeoutMs ?? 1_800;
  let last = await probeLanStackOnce(mode, timeoutMs);
  for (let i = 1; i < attempts && !last.natsOnline; i++) {
    await sleepMs(350);
    last = await probeLanStackOnce(mode, timeoutMs);
  }
  return last;
}

async function probeLanStackOnce(
  mode: "local" | "remote",
  timeoutMs: number
): Promise<{
  devices: ReturnType<typeof devicesFromOnlineMap>;
  natsOnline: boolean;
  detail: string;
}> {
  const specs =
    mode === "local" ? lanHttpProbeSpecs() : tunnelHttpProbeSpecs();
  const onlineByRole: Partial<Record<ModuleRole, boolean>> = {};
  const missing: string[] = [];

  await Promise.all(
    specs.map(async (spec) => {
      const ok = await probeHttp(spec.url, timeoutMs);
      onlineByRole[spec.role] = ok;
      if (!ok) missing.push(spec.role);
    })
  );

  const natsHost = mode === "local" ? NATS_LAN_HOST : NATS_TUNNEL_HOST;
  const natsPort = mode === "local" ? NATS_LAN_PORT : NATS_TUNNEL_PORT;
  // Не голый TCP: настоящий NATS сразу шлёт строку INFO {...}
  const natsOnline = await probeNats(natsHost, natsPort, timeoutMs);
  if (!natsOnline) missing.push("nats");

  const devices = devicesFromOnlineMap(specs, onlineByRole);
  const detail =
    missing.length > 0 ? `offline: ${missing.join(", ")}` : "ok";
  console.log("[session] probe", mode, detail, {
    devices: devices.map((d) => `${d.role}:${d.online ? 1 : 0}`).join(" "),
    nats: natsOnline,
  });
  return { devices, natsOnline, detail };
}

/** Не мигать offline от одного фейла, если раньше роль была online. */
function mergeDeviceOnlineSticky(
  previous: ComplexSessionSnapshot["devices"],
  next: ComplexSessionSnapshot["devices"],
  trustNextFully: boolean
): ComplexSessionSnapshot["devices"] {
  if (trustNextFully) return next;
  const prevByRole = new Map(
    previous.filter((d) => d.role !== "unknown").map((d) => [d.role, d])
  );
  return next.map((d) => {
    const was = prevByRole.get(d.role);
    if (!d.online && was?.online) {
      return { ...d, online: true };
    }
    return d;
  });
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** HTTP GET: только реальный HTTP-ответ = online (не голый TCP). */
function probeHttp(url: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };

    const req = http.get(
      url,
      {
        timeout: timeoutMs,
        family: 4,
        headers: { Connection: "close", Accept: "*/*" },
      },
      (res) => {
        res.resume();
        // Любой HTTP-ответ (в т.ч. 401/404) = сервер жив
        done(true);
      }
    );
    req.on("timeout", () => {
      req.destroy();
      done(false);
    });
    req.on("error", () => done(false));
  });
}

function probeNats(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let buf = "";
    const socket = createConnection({ host, port, family: 4 });
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.removeAllListeners();
        socket.destroy();
      } catch {
        // ignore
      }
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    socket.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      // NATS protocol: first message is INFO {...}\r\n
      if (/^INFO\s*\{/m.test(buf) || buf.includes("INFO {")) {
        done(true);
      }
    });
    socket.on("error", () => done(false));
    // connect без данных ≠ NATS (анти-false-positive на «дырявые» порты)
  });
}

function probeTcp(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      try {
        socket.removeAllListeners();
        socket.destroy();
      } catch {
        // ignore
      }
      resolve(ok);
    };

    const socket = createConnection({ host, port, family: 4 });
    const timer = setTimeout(() => done(false), timeoutMs);
    socket.on("connect", () => {
      clearTimeout(timer);
      done(true);
    });
    socket.on("error", () => {
      clearTimeout(timer);
      done(false);
    });
  });
}

function waitForLocalPort(
  port: number,
  timeoutMs: number,
  isAborted: () => boolean
): Promise<boolean> {
  const started = Date.now();
  return new Promise((resolve) => {
    const tryOnce = () => {
      if (isAborted()) {
        resolve(false);
        return;
      }
      const socket = createConnection({ host: "127.0.0.1", port, family: 4 }, () => {
        socket.end();
        resolve(true);
      });
      socket.on("error", () => {
        socket.destroy();
        if (Date.now() - started >= timeoutMs) {
          resolve(false);
          return;
        }
        setTimeout(tryOnce, 400);
      });
    };
    tryOnce();
  });
}

export const sshSessionManager = new ComplexSessionManager();
