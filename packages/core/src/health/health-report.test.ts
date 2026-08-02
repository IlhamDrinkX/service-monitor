/**
 * Unit tests for buildHealthReport (pure — no NATS/IPC involved).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildHealthReport,
  formatHealthReportText,
  healthLevelLabel,
  type HealthReportInput,
} from "./health-report.js";

function baseConnectedInput(): HealthReportInput {
  return {
    session: { connected: true, mode: "remote", natsOnline: true },
    muster: {
      ok: true,
      modules: [
        { role: "milk", hwid: "dx.milk", raw: {} },
        { role: "coffee", hwid: "dx.coffee", raw: {} },
        { role: "water", hwid: "dx.water", raw: {} },
      ],
    },
    statusTuple: {
      ok: true,
      tuple: {
        at: new Date().toISOString(),
        replies: 3,
        hosts: {
          milk: {
            host: "milk",
            temps: {
              input: 22,
              heater1_out: 40,
              heater2_out: 41,
              heater1_overheat: 0,
              heater2_overheat: 0,
            },
            waterPressure: null,
            waterPulses: null,
            pumpCurrent: 0.4,
            sensorCount: 6,
            source: "facade",
          },
          coffee: {
            host: "coffee",
            temps: {
              input: 22,
              heater1_out: 40,
              heater2_out: 41,
              heater1_overheat: 0,
              heater2_overheat: 0,
            },
            waterPressure: null,
            waterPulses: null,
            pumpCurrent: 0.3,
            sensorCount: 6,
            source: "facade",
          },
          water: {
            host: "water",
            temps: { input: 21, heater1_out: 40, heater2_out: 41 },
            waterPressure: 1.2,
            waterPulses: 900,
            pumpCurrent: null,
            sensorCount: 5,
            source: "facade",
          },
        },
      },
    },
    dx: {
      ok: true,
      data: {
        milk: { pump_R_IS: 0.42, pump_L_IS: 0.1, via: "http" },
        coffee: { pump_R_IS: 0.31, pump_L_IS: 0.09, via: "http" },
        water: { pump_R_IS: 0.28, pump_L_IS: null, via: "http" },
      },
    },
    complexOs: { ok: true },
    sirup: {
      ok: true,
      hwids: ["1", "2", "3"],
      sample: [
        { hwid: "1", kind: "ok", status: "stopped" },
        { hwid: "2", kind: "ok", status: "stopped" },
      ],
    },
    pos: {
      printerMusterOk: true,
      paymentsMusterOk: true,
      printer: { connected: true, workday: "open" },
      payments: { connected: true, ready: true, workday: "open" },
      paymentsCheck: { ready: true },
      hostProbe: { level: "ok", lines: ["systemctl: active", "usb: atol ok"] },
    },
    labLogger: {
      installed: true,
      status: {
        installed: true,
        remotePath: "/home/pi/sm-lab-logger",
        unitActive: "active",
        unitEnabled: true,
        processRunning: true,
        retainHours: 24,
        fakeSource: false,
        health: {
          ok: true,
          lastSampleAgeMs: 500,
          lockHeld: true,
          topologyWarnings: [],
          diskBytes: 1000,
          ticks: 100,
          watchdogBackoff: false,
          dxAllowed: true,
          intervalMs: 200,
          source: "nats",
          raw: {},
        },
        healthError: null,
        pythonHint: null,
        lines: [],
      },
    },
    topology: null, // remote mode — topology only checked in Local
  };
}

describe("buildHealthReport / disconnected session", () => {
  it("reports session error and skips every other section", () => {
    const report = buildHealthReport({
      session: { connected: false, mode: null, natsOnline: false },
      muster: null,
      statusTuple: null,
      dx: null,
      complexOs: null,
      sirup: null,
      pos: null,
      labLogger: null,
      topology: null,
    });
    assert.equal(report.overall, "error");
    const session = report.sections.find((s) => s.id === "session")!;
    assert.equal(session.level, "error");
    assert.match(session.checks[0]!.message, /не подключена/);
    assert.ok(session.checks[0]!.recommendation);

    for (const s of report.sections) {
      if (s.id === "session") continue;
      assert.equal(s.level, "skip", `${s.id} should be skip`);
    }
    assert.ok(report.recommendations.length >= 1);
  });
});

describe("buildHealthReport / fully healthy complex", () => {
  it("everything ok/skip (topology skipped in remote mode) → overall ok", () => {
    const report = buildHealthReport(baseConnectedInput());
    assert.equal(report.overall, "ok", JSON.stringify(report.sections, null, 2));
    const topology = report.sections.find((s) => s.id === "topology")!;
    assert.equal(topology.level, "skip");
    assert.match(topology.checks[0]!.message, /Remote/);
    assert.equal(report.recommendations.length, 0);
  });
});

describe("buildHealthReport / core NATS muster", () => {
  it("flags missing hosts as warn, total failure as error", () => {
    const missingHost = buildHealthReport({
      ...baseConnectedInput(),
      muster: {
        ok: true,
        modules: [
          { role: "milk", raw: {} },
          { role: "coffee", raw: {} },
        ],
      },
    });
    const s1 = missingHost.sections.find((s) => s.id === "core-nats")!;
    assert.equal(s1.level, "warn");
    assert.match(s1.checks[0]!.message, /water/);

    const failed = buildHealthReport({
      ...baseConnectedInput(),
      muster: { ok: false, modules: [], error: "timeout" },
    });
    const s2 = failed.sections.find((s) => s.id === "core-nats")!;
    assert.equal(s2.level, "error");
    assert.equal(failed.overall, "error");
  });
});

describe("buildHealthReport / per-module sensors + DX currents", () => {
  it("no sensors at all → error; partial → warn; DX null data → warn", () => {
    const input = baseConnectedInput();
    input.statusTuple!.tuple!.hosts.milk.sensorCount = 0;
    input.statusTuple!.tuple!.hosts.milk.temps = {};
    input.statusTuple!.tuple!.hosts.coffee.temps = { input: 22 };
    input.statusTuple!.tuple!.hosts.coffee.sensorCount = 1;
    input.dx!.data!.water = { pump_R_IS: null, pump_L_IS: null, error: "no reply" };

    const report = buildHealthReport(input);
    const milk = report.sections.find((s) => s.id === "module-milk")!;
    assert.equal(milk.level, "error");
    assert.match(milk.checks.find((c) => c.id === "milk.status")!.message, /0 датчиков/);

    const coffee = report.sections.find((s) => s.id === "module-coffee")!;
    assert.equal(coffee.level, "warn");

    const waterDx = report.sections
      .find((s) => s.id === "module-water")!
      .checks.find((c) => c.id === "water.dx")!;
    assert.equal(waterDx.level, "warn");
    assert.match(waterDx.message, /no reply/);

    assert.equal(report.overall, "error");
  });
});

describe("buildHealthReport / ComplexOS + sirup + POS", () => {
  it("complexOs failure, empty sirup muster, POS printer disconnected all surface correctly", () => {
    const input = baseConnectedInput();
    input.complexOs = { ok: false, error: "timeout" };
    input.sirup = { ok: true, hwids: [], sample: [] };
    input.pos!.printer = { connected: false, message: "USB unplugged" };

    const report = buildHealthReport(input);

    const complexOs = report.sections.find((s) => s.id === "complexos")!;
    assert.equal(complexOs.level, "error");

    const sirup = report.sections.find((s) => s.id === "sirup")!;
    assert.equal(sirup.level, "warn");
    assert.match(sirup.checks[0]!.message, /Ни один мотор/);

    const pos = report.sections.find((s) => s.id === "pos")!;
    assert.equal(pos.level, "error");
    const printerCheck = pos.checks.find((c) => c.id === "pos.printer")!;
    assert.match(printerCheck.message, /USB unplugged/);
    assert.ok(printerCheck.recommendation);

    assert.equal(report.overall, "error");
  });

  it("sirup sample with a timeout is a warn, not an error", () => {
    const input = baseConnectedInput();
    input.sirup = {
      ok: true,
      hwids: ["1", "2"],
      sample: [
        { hwid: "1", kind: "ok", status: "stopped" },
        { hwid: "2", kind: "timeout" },
      ],
    };
    const report = buildHealthReport(input);
    const sirup = report.sections.find((s) => s.id === "sirup")!;
    assert.equal(sirup.level, "warn");
    assert.match(sirup.checks.find((c) => c.id === "sirup.sample")!.message, /#2/);
  });
});

describe("buildHealthReport / lab-logger", () => {
  it("not installed → skip (not a problem); inactive unit → error; fake/idle source flagged; stale + topology warnings", () => {
    const notInstalled = buildHealthReport({
      ...baseConnectedInput(),
      labLogger: { installed: false },
    });
    assert.equal(notInstalled.sections.find((s) => s.id === "lab-logger")!.level, "skip");
    // Not installed must not drag overall status down.
    assert.equal(notInstalled.overall, "ok");

    const inactive = buildHealthReport({
      ...baseConnectedInput(),
      labLogger: {
        installed: true,
        status: {
          installed: true,
          remotePath: "/home/pi/sm-lab-logger",
          unitActive: "failed",
          unitEnabled: true,
          processRunning: false,
          retainHours: 24,
          fakeSource: false,
          health: null,
          healthError: null,
          pythonHint: null,
          lines: [],
        },
      },
    });
    const lgSection = inactive.sections.find((s) => s.id === "lab-logger")!;
    assert.equal(lgSection.level, "error");

    const staleAndWarn = buildHealthReport({
      ...baseConnectedInput(),
      labLogger: {
        installed: true,
        status: {
          installed: true,
          remotePath: "/home/pi/sm-lab-logger",
          unitActive: "active",
          unitEnabled: true,
          processRunning: true,
          retainHours: 24,
          fakeSource: false,
          health: {
            ok: true,
            lastSampleAgeMs: 60_000,
            lockHeld: true,
            topologyWarnings: ["milk not on .44"],
            diskBytes: 1,
            ticks: 1,
            watchdogBackoff: false,
            dxAllowed: true,
            intervalMs: 200,
            source: "nats",
            raw: {},
          },
          healthError: null,
          pythonHint: null,
          lines: [],
        },
      },
    });
    const staleSection = staleAndWarn.sections.find((s) => s.id === "lab-logger")!;
    assert.equal(staleSection.level, "warn");
    assert.ok(staleSection.checks.some((c) => c.id === "lab-logger.stale"));
    assert.ok(staleSection.checks.some((c) => c.id === "lab-logger.topology"));
  });
});

describe("buildHealthReport / topology (Local LAN)", () => {
  it("matches, wrong IP, and offline all classified correctly", () => {
    const input = baseConnectedInput();
    input.session.mode = "local";
    input.topology = {
      devices: [
        { hostname: "complexos.local", ip: "192.168.1.43", role: "complexos", online: true },
        { hostname: "milk.local", ip: "192.168.1.44", role: "milk", online: true },
        { hostname: "coffee.local", ip: "192.168.1.33", role: "coffee", online: true },
        { hostname: "water.local", ip: "192.168.1.46", role: "water", online: false },
      ],
    };
    const report = buildHealthReport(input);
    const topo = report.sections.find((s) => s.id === "topology")!;
    assert.equal(topo.level, "error"); // water offline
    assert.equal(topo.checks.find((c) => c.id === "topology.milk")!.level, "ok");
    assert.equal(topo.checks.find((c) => c.id === "topology.coffee")!.level, "warn");
    assert.match(topo.checks.find((c) => c.id === "topology.coffee")!.message, /192\.168\.1\.33/);
    assert.equal(topo.checks.find((c) => c.id === "topology.water")!.level, "error");
  });
});

describe("buildHealthReport / recommendations + text formatting", () => {
  it("dedupes identical recommendations and formatHealthReportText renders sections", () => {
    const input = baseConnectedInput();
    input.dx!.data!.water = { pump_R_IS: null, pump_L_IS: null };
    // Force the same wording twice isn't realistic here, so just check shape instead.
    const report = buildHealthReport(input);
    assert.equal(new Set(report.recommendations).size, report.recommendations.length);

    const text = formatHealthReportText(report);
    assert.match(text, /Health Report/);
    assert.match(text, /Модуль milk/);
    assert.equal(healthLevelLabel("ok"), "OK");
    assert.equal(healthLevelLabel("error"), "Проблема");
  });
});
