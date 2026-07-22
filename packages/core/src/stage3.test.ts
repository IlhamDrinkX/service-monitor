/**
 * Stage 3 session health + local LAN tests.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  emptySession,
  isSessionHealthy,
  shouldWarnSession,
  isLanModulesReachable,
  SESSION_IDLE_TTL_MS,
  lanServiceUrls,
  serviceUrlsForMode,
  lanHttpProbeSpecs,
  type NetworkDevice,
} from "./index.js";

describe("stage3 / session-health", () => {
  it("empty session is unhealthy and warns red", () => {
    const s = emptySession();
    assert.equal(s.connected, false);
    assert.equal(s.mode, null);
    assert.equal(s.natsOnline, false);
    assert.equal(isSessionHealthy(s), false);
    assert.equal(shouldWarnSession(s), true);
  });

  it("fresh remote session needs natsOnline", () => {
    const now = 1_000_000;
    const base = {
      ...emptySession(),
      connected: true,
      mode: "remote" as const,
      seriesLabel: "4.15",
      sshPort: 22415,
      startedAt: new Date(now - 1000).toISOString(),
      lastAliveAt: new Date(now).toISOString(),
      natsUrl: "nats://127.0.0.1:14222",
      failureReason: null,
      message: "OK",
    };
    assert.equal(isSessionHealthy({ ...base, natsOnline: false }, now), false);
    assert.equal(isSessionHealthy({ ...base, natsOnline: true }, now), true);
    assert.equal(shouldWarnSession({ ...base, natsOnline: true }, now), false);
  });

  it("stale lastAlive is expired", () => {
    const now = 1_000_000;
    const s = {
      ...emptySession("expired"),
      connected: true,
      mode: "remote" as const,
      natsOnline: true,
      lastAliveAt: new Date(now - SESSION_IDLE_TTL_MS - 1).toISOString(),
      failureReason: null,
      message: "stale",
    };
    assert.equal(isSessionHealthy(s, now), false);
    assert.equal(shouldWarnSession(s, now), true);
  });

  it("local mode warns red when modules or nats offline", () => {
    const now = 1_000_000;
    const devices: NetworkDevice[] = [
      { hostname: "complexos.local", ip: "192.168.1.43", role: "complexos", online: true },
      { hostname: "router", ip: "192.168.1.1", role: "router", online: false },
      { hostname: "milk.local", ip: "192.168.1.44", role: "milk", online: false },
      { hostname: "coffee.local", ip: "192.168.1.45", role: "coffee", online: true },
      { hostname: "water.local", ip: "192.168.1.46", role: "water", online: true },
    ];
    assert.equal(isLanModulesReachable(devices, true), false);
    assert.equal(isLanModulesReachable(devices.map((d) => ({ ...d, online: true })), false), false);
    const s = {
      ...emptySession(),
      connected: true,
      mode: "local" as const,
      lastAliveAt: new Date(now).toISOString(),
      devices,
      natsOnline: true,
      failureReason: null,
      message: "partial",
    };
    assert.equal(isSessionHealthy(s, now), false);
    assert.equal(shouldWarnSession(s, now), true);
  });

  it("local mode healthy when HTTP modules + NATS online", () => {
    const now = 1_000_000;
    const devices: NetworkDevice[] = [
      { hostname: "complexos.local", ip: "192.168.1.43", role: "complexos", online: true },
      { hostname: "router", ip: "192.168.1.1", role: "router", online: false },
      { hostname: "milk.local", ip: "192.168.1.44", role: "milk", online: true },
      { hostname: "coffee.local", ip: "192.168.1.45", role: "coffee", online: true },
      { hostname: "water.local", ip: "192.168.1.46", role: "water", online: true },
    ];
    assert.equal(isLanModulesReachable(devices, true), true);
    const s = {
      ...emptySession(),
      connected: true,
      mode: "local" as const,
      lastAliveAt: new Date(now).toISOString(),
      natsUrl: "nats://192.168.1.43:4222",
      natsOnline: true,
      devices,
      failureReason: null,
      message: "LAN ok",
    };
    assert.equal(isSessionHealthy(s, now), true);
    assert.equal(shouldWarnSession(s, now), false);
  });

  it("lan HTTP probe specs use real URLs not only ports", () => {
    const specs = lanHttpProbeSpecs();
    assert.ok(specs.some((s) => s.url === "http://192.168.1.43/"));
    assert.ok(specs.some((s) => s.url === "http://192.168.1.44:8000/"));
    const lan = lanServiceUrls();
    assert.match(lan.dashboard, /192\.168\.1\.43/);
    assert.equal(serviceUrlsForMode("local").waterCharts, lan.waterCharts);
    assert.match(serviceUrlsForMode("remote").dashboard, /127\.0\.0\.1:8080/);
  });
});
