/**
 * Stage 4 + discovery parse tests.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getParamHint,
  listParamHints,
  parseNeighbors,
  mergeDiscoveredDevices,
  summarizeJsonDiff,
  DISCOVERY_STICKY_TTL_MS,
  type StickyNeighbor,
} from "./index.js";

describe("stage4 / param-hints", () => {
  it("explains currentTreshold with code ref", () => {
    const h = getParamHint("refill.currentTreshold");
    assert.ok(h);
    assert.match(h!.summary, /pump_R_IS/);
    assert.ok(h!.codeRef?.includes("drinkx.js"));
  });

  it("resolves nested heater1.kP to heater hint or exact", () => {
    const h = getParamHint("heater1.kP");
    assert.ok(h);
    assert.ok(h!.path.startsWith("heater1"));
  });

  it("lists many drinkx keys", () => {
    assert.ok(listParamHints().length >= 15);
  });
});

describe("stage4 / neigh-parse", () => {
  it("parses ip neigh lladdr", () => {
    const raw = `
192.168.1.28 dev eth0 lladdr aa:bb:cc:dd:ee:01 REACHABLE
192.168.1.31 dev eth0 lladdr aa:bb:cc:dd:ee:02 STALE
192.168.1.43 dev eth0 lladdr 11:22:33:44:55:66 REACHABLE
`;
    const n = parseNeighbors(raw);
    assert.equal(n.find((x) => x.ip === "192.168.1.28")?.mac, "aa:bb:cc:dd:ee:01");
    assert.equal(n.find((x) => x.ip === "192.168.1.31")?.mac, "aa:bb:cc:dd:ee:02");
  });

  it("keeps sticky extras with MAC, hostname and TTL", () => {
    const sticky = new Map<string, StickyNeighbor>();
    const now = 1_000_000;
    const probed = [
      {
        hostname: "complexos.local",
        ip: "192.168.1.43",
        role: "complexos" as const,
        online: true,
      },
    ];
    let devices = mergeDiscoveredDevices(
      probed,
      sticky,
      [
        {
          ip: "192.168.1.28",
          mac: "aa:bb:cc:dd:ee:ff",
          hostname: "tablet.local",
        },
      ],
      now
    );
    const extra = devices.find((d) => d.ip === "192.168.1.28");
    assert.ok(extra);
    assert.equal(extra!.mac, "aa:bb:cc:dd:ee:ff");
    assert.equal(extra!.hostname, "tablet.local");
    assert.equal(extra!.online, true);

    // Пропал из ARP — остаётся sticky, online=false, hostname сохраняется
    devices = mergeDiscoveredDevices(probed, sticky, [], now + 60_000);
    const idle = devices.find((d) => d.ip === "192.168.1.28");
    assert.ok(idle);
    assert.equal(idle!.online, false);
    assert.equal(idle!.mac, "aa:bb:cc:dd:ee:ff");
    assert.equal(idle!.hostname, "tablet.local");

    // После TTL — исчезает
    devices = mergeDiscoveredDevices(
      probed,
      sticky,
      [],
      now + DISCOVERY_STICKY_TTL_MS + 1
    );
    assert.equal(
      devices.find((d) => d.ip === "192.168.1.28"),
      undefined
    );
  });

  it("parses hostnames from getent/hosts section", () => {
    const raw = `
192.168.1.28 dev eth0 lladdr aa:bb:cc:dd:ee:01 REACHABLE
===HOSTS===
192.168.1.28 tablet.local
===GETENT===
192.168.1.31 phone.lan
192.168.1.31 dev eth0 lladdr aa:bb:cc:dd:ee:02 STALE
`;
    const n = parseNeighbors(raw);
    assert.equal(n.find((x) => x.ip === "192.168.1.28")?.hostname, "tablet.local");
    assert.equal(n.find((x) => x.ip === "192.168.1.31")?.hostname, "phone.lan");
    assert.equal(n.find((x) => x.ip === "192.168.1.31")?.mac, "aa:bb:cc:dd:ee:02");
  });

  it("ignores FAILED/incomplete without MAC (no ping ghosts)", () => {
    const raw = `
192.168.1.28 dev eth0 FAILED
192.168.1.29 dev eth0 INCOMPLETE
192.168.1.40 dev eth0 lladdr 28:0c:50:e9:a6:5b REACHABLE
192.168.1.2
`;
    const n = parseNeighbors(raw);
    assert.equal(n.length, 1);
    assert.equal(n[0].ip, "192.168.1.40");
    assert.equal(n[0].mac, "28:0c:50:e9:a6:5b");
  });

  it("summarizes json top-level diff", () => {
    const d = summarizeJsonDiff(
      JSON.stringify({ a: 1, b: 2 }),
      JSON.stringify({ a: 1, b: 3, c: 4 })
    );
    assert.ok(d.includes("~ b"));
    assert.ok(d.includes("+ c"));
  });
});
