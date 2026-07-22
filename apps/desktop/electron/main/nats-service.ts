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

/** Сериализуем request — иначе poll + toggle клапанов заливают inbox и «ломают» кнопки. */
let requestChain: Promise<unknown> = Promise.resolve();

/** Request/response с inbox (упрощённо относительно aerp ack-retry). */
export async function natsRequest(
  subject: string,
  payload: unknown = {},
  timeoutMs = DEFAULT_TIMEOUT
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

  const next = requestChain.then(run, run);
  requestChain = next.then(
    () => undefined,
    () => undefined
  );
  return next;
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

export async function natsUpdateConfig(
  patch: Record<string, unknown>
): Promise<unknown> {
  return natsRequest(NATS_SUBJECTS.updateConfig, patch, 8_000);
}
