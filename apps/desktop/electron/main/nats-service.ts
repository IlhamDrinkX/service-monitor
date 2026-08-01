/**
 * Встроенный NATS-клиент (Electron main).
 * Сервер берётся из активной сессии (Local LAN или туннель :14222).
 */

import { connect, StringCodec, type NatsConnection, type Subscription } from "nats";
import { BrowserWindow } from "electron";
import {
  NATS_SUBJECTS,
  type NatsConnectionInfo,
  type NatsMusterEntry,
} from "@service-monitor/core";
import { sshSessionManager } from "./ssh-session-manager";

const sc = StringCodec();
const DEFAULT_TIMEOUT = 5_000;

let nc: NatsConnection | null = null;
let statusSub: Subscription | null = null;
let busSubs: Subscription[] = [];
/** clientId → subjects (Lab + ComplexOS не затирают друг друга). */
const busClients = new Map<string, string[]>();
let currentServer: string | null = null;

function decode(data: Uint8Array): unknown {
  const text = sc.decode(data);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function encode(payload: unknown): Uint8Array {
  return sc.encode(JSON.stringify(payload ?? {}));
}

function inbox(): string {
  return `sm-inbox.${Date.now()}.${Math.random().toString(16).slice(2)}`;
}

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

export function getNatsInfo(): NatsConnectionInfo {
  return {
    connected: nc != null && !nc.isClosed(),
    server: currentServer,
    message: nc && !nc.isClosed()
      ? `NATS · ${currentServer}`
      : "NATS не подключён",
  };
}

export async function natsDisconnect(): Promise<NatsConnectionInfo> {
  try {
    statusSub?.unsubscribe();
  } catch {
    // ignore
  }
  statusSub = null;
  clearBusSubs();
  busClients.clear();
  if (nc) {
    try {
      await nc.drain();
    } catch {
      try {
        await nc.close();
      } catch {
        // ignore
      }
    }
  }
  nc = null;
  currentServer = null;
  const info = getNatsInfo();
  broadcast("nats:state", info);
  return info;
}

export async function natsConnect(
  serverOverride?: string
): Promise<NatsConnectionInfo> {
  await natsDisconnect();

  const session = sshSessionManager.getSnapshot();
  const server =
    serverOverride?.trim() ||
    session.natsUrl ||
    (session.mode === "local"
      ? "nats://192.168.1.43:4222"
      : "nats://127.0.0.1:14222");

  if (!session.connected && !serverOverride) {
    return {
      connected: false,
      server: null,
      message: "Сначала подключите сессию (вкладка Сессия)",
    };
  }

  console.log("[nats] connect", server);
  try {
    const conn = await connect({
      servers: server,
      timeout: 8_000,
      reconnect: true,
      maxReconnectAttempts: 10,
    });
    nc = conn;
    currentServer = server;
    conn.closed().then(() => {
      if (nc === conn) {
        nc = null;
        currentServer = null;
        broadcast("nats:state", getNatsInfo());
      }
    });
    const info = getNatsInfo();
    broadcast("nats:state", info);
    return info;
  } catch (e) {
    nc = null;
    currentServer = null;
    const message = e instanceof Error ? e.message : String(e);
    console.warn("[nats] connect failed", message);
    const info = { connected: false, server: null, message: `NATS: ${message}` };
    broadcast("nats:state", info);
    return info;
  }
}

async function ensure(): Promise<NatsConnection> {
  if (nc && !nc.isClosed()) return nc;
  const info = await natsConnect();
  if (!info.connected || !nc) {
    throw new Error(info.message || "NATS offline");
  }
  return nc;
}

/** Discovery модулей (muster → несколько ответов), как в module_test. */
export async function natsMuster(
  timeoutMs = 900
): Promise<NatsMusterEntry[]> {
  const conn = await ensure();
  const reply = inbox();
  const results: NatsMusterEntry[] = [];
  const seen = new Set<string>();

  return await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      try {
        sub.unsubscribe();
      } catch {
        // ignore
      }
      if (err) reject(err);
      else resolve(results);
    };

    const sub = conn.subscribe(reply, {
      callback: (err, msg) => {
        if (err) {
          finish(err);
          return;
        }
        const raw = decode(msg.data);
        const key = JSON.stringify(raw);
        if (seen.has(key)) return;
        seen.add(key);
        const obj = (raw && typeof raw === "object" ? raw : {}) as Record<
          string,
          unknown
        >;
        results.push({
          hwid: typeof obj.hwid === "string" ? obj.hwid : undefined,
          label: typeof obj.label === "string" ? obj.label : undefined,
          role: typeof obj.role === "string" ? obj.role : undefined,
          apps: Array.isArray(obj.apps) ? (obj.apps as string[]) : undefined,
          raw,
        });
      },
    });

    try {
      conn.publish(NATS_SUBJECTS.muster, encode({}), { reply });
    } catch (e) {
      finish(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    setTimeout(() => finish(), timeoutMs);
  });
}

/** Команды (клапаны) не ждут опрос — иначе UI «залипает». */
let commandChain: Promise<unknown> = Promise.resolve();

export type NatsRequestPriority = "command" | "poll";

/**
 * Кортеж ответов на один publish (как muster / module_test requestMany).
 * Для coffeemachine.status собирает replies от всех модулей + facade.
 */
export async function natsRequestMany(
  subject: string,
  payload: unknown = {},
  timeoutMs = 900,
  priority: NatsRequestPriority = "poll"
): Promise<unknown[]> {
  const run = async (): Promise<unknown[]> => {
    const conn = await ensure();
    const reply = inbox();
    const results: unknown[] = [];
    const seen = new Set<string>();

    return await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        try {
          sub.unsubscribe();
        } catch {
          // ignore
        }
        if (err) reject(err);
        else resolve(results);
      };

      const sub = conn.subscribe(reply, {
        callback: (err, msg) => {
          if (err) {
            finish(err);
            return;
          }
          const raw = decode(msg.data);
          const key = JSON.stringify(raw);
          if (seen.has(key)) return;
          seen.add(key);
          results.push(raw);
        },
      });

      try {
        conn.publish(subject, encode(payload ?? {}), { reply });
      } catch (e) {
        finish(e instanceof Error ? e : new Error(String(e)));
        return;
      }
      setTimeout(() => finish(), timeoutMs);
    });
  };

  if (priority === "command") {
    const next = commandChain.then(run, run);
    commandChain = next.then(
      () => undefined,
      () => undefined
    );
    return next as Promise<unknown[]>;
  }

  // poll: ждём только команды; между собой опросы идут параллельно
  // (иначе requestMany + valves.status сериализуются и все таймаутятся).
  return commandChain.then(run, run) as Promise<unknown[]>;
}

/** Request/response с inbox (упрощённо относительно aerp ack-retry). */
export async function natsRequest(
  subject: string,
  payload: unknown = {},
  timeoutMs = DEFAULT_TIMEOUT,
  priority: NatsRequestPriority = "command"
): Promise<unknown> {
  const run = async (): Promise<unknown> => {
    try {
      const conn = await ensure();
      const reply = inbox();
      return await new Promise((resolve, reject) => {
        let sub: Subscription;
        const timer = setTimeout(() => {
          try {
            sub.unsubscribe();
          } catch {
            // ignore
          }
          reject(new Error(`${subject} timeout ${timeoutMs}ms`));
        }, timeoutMs);

        try {
          sub = conn.subscribe(reply, {
            max: 1,
            callback: (err, msg) => {
              clearTimeout(timer);
              if (err) {
                reject(err);
                return;
              }
              try {
                resolve(decode(msg.data));
              } catch (e) {
                reject(e instanceof Error ? e : new Error(String(e)));
              }
            },
          });
          conn.publish(subject, encode(payload), { reply });
        } catch (e) {
          clearTimeout(timer);
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      });
    } catch (e) {
      throw e instanceof Error ? e : new Error(String(e));
    }
  };

  if (priority === "command") {
    const next = commandChain.then(run, run);
    commandChain = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  // poll: ждёт только команды, параллельно с другими poll
  return commandChain.then(run, run);
}

export async function natsStatus(filter: Record<string, unknown> = {}): Promise<unknown> {
  return natsRequest(NATS_SUBJECTS.status, filter, 4_000);
}

export async function natsPublish(
  subject: string,
  payload: unknown = {}
): Promise<{ ok: true }> {
  const conn = await ensure();
  conn.publish(subject, encode(payload));
  return { ok: true };
}

export async function natsSubscribeStatus(): Promise<{ ok: true }> {
  const conn = await ensure();
  try {
    statusSub?.unsubscribe();
  } catch {
    // ignore
  }
  statusSub = conn.subscribe(NATS_SUBJECTS.statusNotification, {
    callback: (err, msg) => {
      if (err) {
        console.warn("[nats] status sub", err);
        return;
      }
      broadcast("nats:status", decode(msg.data));
    },
  });
  return { ok: true };
}

function clearBusSubs() {
  for (const sub of busSubs) {
    try {
      sub.unsubscribe();
    } catch {
      // ignore
    }
  }
  busSubs = [];
}

/**
 * Подписка на bus subjects. Несколько клиентов (lab / complexos) мержатся.
 * Сообщения → renderer channel `nats:bus` { subject, data }.
 */
export async function natsSubscribeBus(
  subjects: string[],
  clientId = "default"
): Promise<{ ok: true; subjects: string[] }> {
  const unique = [...new Set(subjects.map((s) => s.trim()).filter(Boolean))];
  busClients.set(clientId || "default", unique);
  const merged = rebuildBusSubjectList();
  await ensure();
  await resubscribeBus(merged);
  console.log("[nats] subscribeBus", clientId, unique, "→", merged);
  return { ok: true, subjects: merged };
}

export async function natsUnsubscribeBus(
  clientId = "default"
): Promise<{ ok: true }> {
  busClients.delete(clientId || "default");
  const merged = rebuildBusSubjectList();
  console.log("[nats] unsubscribeBus", clientId, "→", merged);
  if (merged.length === 0) {
    clearBusSubs();
  } else if (nc) {
    await resubscribeBus(merged);
  } else {
    clearBusSubs();
  }
  return { ok: true };
}

function rebuildBusSubjectList(): string[] {
  const all = new Set<string>();
  for (const list of busClients.values()) {
    for (const s of list) all.add(s);
  }
  return [...all];
}

async function resubscribeBus(subjects: string[]): Promise<void> {
  clearBusSubs();
  if (!nc || subjects.length === 0) return;
  for (const subject of subjects) {
    const sub = nc.subscribe(subject, {
      callback: (err, msg) => {
        if (err) {
          console.warn("[nats] bus sub", subject, err);
          return;
        }
        const data = decode(msg.data);
        console.log("[nats] bus", msg.subject || subject);
        broadcast("nats:bus", {
          subject: msg.subject || subject,
          data,
        });
      },
    });
    busSubs.push(sub);
  }
}

export async function natsUpdateConfig(
  patch: Record<string, unknown>
): Promise<unknown> {
  return natsRequest(NATS_SUBJECTS.updateConfig, patch, 8_000);
}
