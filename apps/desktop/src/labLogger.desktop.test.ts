/**
 * Lab logger page help wiring (без Electron).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CONTROL_HELPS,
  LAB_LOGGER_POLL_INTERVAL_MS_DEFAULT,
  LAB_LOGGER_POLL_INTERVAL_MS_MIN,
  LAB_LOGGER_REMOTE_ROOT,
  clampLabLoggerPollIntervalMs,
  convertOnboardRecordsToLabEvents,
  formatLabLoggerStatusLine,
  isLabLoggerRealtimeReady,
  isLabLoggerSessionAllowed,
  isSeries4ForLabLogger,
  maxOnboardRecordTs,
  nextOnboardEventsFromTs,
  parseLabLoggerStatusOutput,
  resolveLabLoggerSshTarget,
} from "@service-monitor/core";

describe("desktop / labLogger help + helpers", () => {
  it("exposes LabLoggerPage help ids", () => {
    const required = [
      "nav.labLogger",
      "labLogger.install",
      "labLogger.view",
      "labLogger.realtime",
      "labLogger.path",
      "labLogger.status",
      "labLogger.autostart",
      "labLogger.retention",
      "labLogger.uninstall",
      "labLogger.download",
    ];
    for (const id of required) {
      assert.ok(CONTROL_HELPS[id], id);
      assert.ok(CONTROL_HELPS[id]!.body.length > 20, id);
    }
    assert.match(CONTROL_HELPS["labLogger.path"]!.body, /\/home\/pi\/sm-lab-logger/);
    assert.match(CONTROL_HELPS["labLogger.realtime"]!.body, /1500/);
    assert.match(CONTROL_HELPS["labLogger.realtime"]!.body, /1000/);
    assert.match(CONTROL_HELPS["nav.labLogger"]!.body, /Local LAN|192\.168\.1\.43/);
  });

  it("clamps poll interval and converts onboard events (UI logic)", () => {
    assert.equal(clampLabLoggerPollIntervalMs(500), LAB_LOGGER_POLL_INTERVAL_MS_MIN);
    assert.equal(
      clampLabLoggerPollIntervalMs(LAB_LOGGER_POLL_INTERVAL_MS_DEFAULT),
      1500
    );
    const ev = convertOnboardRecordsToLabEvents([
      { ts: 10, kind: "sensor", module: "water", name: "input", value: true },
    ]);
    assert.equal(ev.length, 1);
    assert.equal(ev[0]!.name, "input");
    assert.equal(nextOnboardEventsFromTs(maxOnboardRecordTs([{ ts: 10 }])), 11);
    assert.equal(isLabLoggerRealtimeReady(null), false);
  });

  it("gates series-4 for page controls; Local LAN without series still allowed", () => {
    assert.equal(isSeries4ForLabLogger("4.11"), true);
    assert.equal(isSeries4ForLabLogger("3.05"), false);
    assert.equal(
      isLabLoggerSessionAllowed({
        connected: true,
        mode: "local",
        seriesLabel: null,
      }),
      true
    );
    assert.deepEqual(
      resolveLabLoggerSshTarget({ connected: true, mode: "local" }),
      { mode: "local", host: "192.168.1.43", port: 22 }
    );
  });

  it("formats status line for UI badge with path", () => {
    const s = parseLabLoggerStatusOutput(
      [
        "###LAB_LOGGER###",
        "installed=no",
        "unit_active=inactive",
        "unit_enabled=disabled",
        "proc=",
        "###END###",
      ].join("\n")
    );
    assert.match(formatLabLoggerStatusLine(s), /не установлен/);
    assert.match(formatLabLoggerStatusLine(s), new RegExp(LAB_LOGGER_REMOTE_ROOT));
  });

  it("parses noisy health chunk without false parse failure", () => {
    const s = parseLabLoggerStatusOutput(
      [
        "###LAB_LOGGER###",
        "installed=yes",
        "unit_active=active",
        "unit_enabled=enabled",
        "proc=python3 /home/pi/sm-lab-logger/main.py|",
        "###HEALTH###",
        "Warning: something",
        '{"ok":true,"ticks":4,"lock_held":true,"topology_warnings":[],"disk_bytes":2}',
        "###CONFIG###",
        '{"retain_hours":24}',
        "###END###",
      ].join("\n")
    );
    assert.equal(s.installed, true);
    assert.ok(s.health?.ok);
    assert.equal(s.healthError, null);
    assert.match(formatLabLoggerStatusLine(s), /health=ok/);
  });
});
