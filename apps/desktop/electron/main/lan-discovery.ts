/**
 * Discovery соседей в LAN: IP + MAC, sticky TTL.
 */

import { spawn } from "child_process";
import { homedir } from "os";
import { join } from "path";
import {
  COMPLEX_SSH_USER,
  ERP_JUMP_HOST,
  mergeDiscoveredDevices as mergeCore,
  parseNeighbors,
  type NeighborEntry,
  type NetworkDevice,
  type StickyNeighbor,
} from "@service-monitor/core";
import { sshSessionManager } from "./ssh-session-manager";

export type { NeighborEntry };

const stickyByIp = new Map<string, StickyNeighbor>();

function identityPath(): string {
  return join(homedir(), ".ssh", "id_ed25519");
}

/**
 * Одна строка для `ssh host '…'`.
 * Только таблица соседей complexos (ip neigh + /proc/net/arp) — без ping-свипа.
 * Имена — getent только для IP, у которых уже есть MAC.
 */
const NEIGH_CMD =
  "ip -4 neigh show 2>/dev/null; echo '===ARP==='; cat /proc/net/arp 2>/dev/null; " +
  "echo '===HOSTS==='; cat /etc/hosts 2>/dev/null; echo '===GETENT==='; " +
  "ip -4 neigh show 2>/dev/null | awk '/lladdr/{print $1}' | " +
  "while read -r ip; do " +
  "n=$(getent hosts \"$ip\" 2>/dev/null | awk '{print $2; exit}'); " +
  "[ -n \"$n\" ] && echo \"$ip $n\"; " +
  "done";

function runSystemSsh(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    console.log("[discovery] ssh", args.join(" "));
    const child = spawn("ssh", args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (b: Buffer) => {
      out += b.toString();
    });
    child.stderr.on("data", (b: Buffer) => {
      err += b.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const stderr = err.trim();
      // Есть ARP/neigh в stdout — принимаем, даже если ssh ругнулся на known_hosts.
      if (out.includes("192.168.1.") || out.includes("===ARP===")) {
        if (code !== 0 && stderr) {
          console.warn("[discovery] ssh exit", code, stderr.slice(0, 240));
        }
        resolve(out);
        return;
      }
      reject(new Error(stderr || `ssh exit ${code}`));
    });
  });
}

export { parseNeighbors, DISCOVERY_STICKY_TTL_MS } from "@service-monitor/core";

export function mergeDiscoveredDevices(
  probed: NetworkDevice[],
  neighbors: NeighborEntry[]
): NetworkDevice[] {
  return mergeCore(probed, stickyByIp, neighbors);
}

/** После heartbeat: не терять «другие» IP из sticky-кэша. */
export function withStickyExtras(probed: NetworkDevice[]): NetworkDevice[] {
  return mergeCore(probed, stickyByIp, []);
}

export function clearDiscoveryCache(): void {
  stickyByIp.clear();
}

export type DiscoveryResult = {
  neighbors: NeighborEntry[];
  error: string | null;
};

export async function discoverLanNeighbors(): Promise<DiscoveryResult> {
  const session = sshSessionManager.getSnapshot();
  const base = [
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "UserKnownHostsFile=/dev/null",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "BatchMode=yes",
    "-i",
    identityPath(),
  ];

  try {
    let out: string;
    if (session.mode === "remote" && session.sshPort) {
      out = await runSystemSsh([
        ...base,
        "-J",
        `tun@${ERP_JUMP_HOST}`,
        "-p",
        String(session.sshPort),
        `${COMPLEX_SSH_USER}@localhost`,
        NEIGH_CMD,
      ]);
    } else if (session.mode === "local" || session.connected) {
      out = await runSystemSsh([
        ...base,
        `${COMPLEX_SSH_USER}@192.168.1.43`,
        NEIGH_CMD,
      ]);
    } else {
      return {
        neighbors: [],
        error: "Сначала подключите сессию (Remote или Local)",
      };
    }
    const neighbors = parseNeighbors(out).filter((n) => !!n.mac);
    // Свежий снимок ARP complexos — без мусора от старого ping-свипа
    stickyByIp.clear();
    console.log(
      "[discovery] neighbors",
      neighbors.length,
      neighbors
        .map(
          (n) =>
            `${n.ip}/${n.mac ?? "?"}${n.hostname ? `/${n.hostname}` : ""}`
        )
        .join(", ")
    );
    return { neighbors, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[discovery] failed", msg);
    return { neighbors: [], error: msg };
  }
}
