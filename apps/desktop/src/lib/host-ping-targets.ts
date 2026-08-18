/**
 * Pure tablet target helpers for Host Ping UI (no React / window.prompt).
 */
import { resolveHostPingTabletTargets } from "@service-monitor/core";

/** Validate form fields; used by Install / «Задать цели…». */
export function readTabletTargetsFromFields(existing: {
  ip: string;
  mac: string;
}):
  | { ok: true; ip: string; mac: string; tabletIp?: string; tabletMac?: string }
  | { ok: false; error: string; focus: "ip" | "mac" | "both" } {
  return resolveHostPingTabletTargets(existing);
}
