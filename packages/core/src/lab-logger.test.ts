/**
 * Unit tests for lab onboard logger install helpers (pure).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LAB_LOGGER_HTTP_PORT,
  LAB_LOGGER_PACKAGE_FILES,
  LAB_LOGGER_POLL_INTERVAL_MS_DEFAULT,
  LAB_LOGGER_POLL_INTERVAL_MS_MAX,
  LAB_LOGGER_POLL_INTERVAL_MS_MIN,
  LAB_LOGGER_REMOTE_BUNDLE_PATH,
  LAB_LOGGER_REMOTE_ROOT,
  LAB_LOGGER_UNIT_NAME,
  LAB_LOGGER_USER_UNIT_PATH,
  LAB_LOGGER_USER_UNIT_REL,
  buildLabLoggerConfigJson,
  buildLabLoggerDisableAutostartCmd,
  buildLabLoggerEnableAutostartCmd,
  buildLabLoggerEventsCurlCmd,
  buildLabLoggerHealthCurlCmd,
  buildLabLoggerRemoteUnpackCmd,
  buildLabLoggerStartCmd,
  buildLabLoggerStatusProbeCmd,
  buildLabLoggerSystemdUserUnit,
  buildLabLoggerUninstallCmd,
  buildLabLoggerUserSystemdPrefix,
  clampLabLoggerPollIntervalMs,
  collectOnboardSeriesKeys,
  convertOnboardRecordsToLabEvents,
  ensureLabLoggerRingSavePath,
  extractFirstJsonObject,
  formatLabLoggerStatusLine,
  formatLabLoggerStatusParts,
  isLabLoggerMissingUnitError,
  isLabLoggerRealtimeReady,
  isSeries4ForLabLogger,
  labLoggerRingDownloadFilename,
  maxOnboardRecordTs,
  mergeOnboardLabEvents,
  nextOnboardEventsFromTs,
  normalizeOnboardTsMs,
  onboardHeaterIds,
  onboardHeaterPwmOverlayKeys,
  onboardPumpOverlayHosts,
  onboardValveOverlayKeys,
  parseLabLoggerConfigJson,
  parseLabLoggerHealthJson,
  parseLabLoggerStatusOutput,
  resolveLabLoggerSourceKind,
  stripLabLoggerSshNoise,
  valvesMapFromOnboardEvents,
} from "./nats/lab-logger.js";
import { createLabEvent, type LabEvent } from "./nats/lab-log.js";

describe("lab-logger helpers", () => {
  it("canonical paths are absolute under /home/pi", () => {
    assert.equal(LAB_LOGGER_REMOTE_ROOT, "/home/pi/sm-lab-logger");
    assert.equal(
      LAB_LOGGER_USER_UNIT_PATH,
      "/home/pi/.config/systemd/user/sm-lab-logger.service"
    );
    assert.match(LAB_LOGGER_USER_UNIT_REL, /sm-lab-logger\.service/);
    assert.ok(LAB_LOGGER_USER_UNIT_PATH.startsWith("/home/pi/"));
  });

  it("gates series-4 only", () => {
    assert.equal(isSeries4ForLabLogger("4.15"), true);
    assert.equal(isSeries4ForLabLogger("4.8"), true);
    assert.equal(isSeries4ForLabLogger("3.05"), false);
    assert.equal(isSeries4ForLabLogger(null), false);
    assert.equal(isSeries4ForLabLogger(""), false);
  });

  it("builds config json with defaults and validates", () => {
    const text = buildLabLoggerConfigJson({ retain_hours: 12 });
    const cfg = parseLabLoggerConfigJson(text);
    assert.ok(cfg);
    assert.equal(cfg!.retain_hours, 12);
    assert.equal(cfg!.http_port, LAB_LOGGER_HTTP_PORT);
    assert.equal(cfg!.fake_source, false);
    assert.throws(() => buildLabLoggerConfigJson({ retain_hours: 0 }));
    assert.throws(() => buildLabLoggerConfigJson({ interval_ms: 10 }));
  });

  it("builds systemd user unit with Nice and http port (no fake by default)", () => {
    const unit = buildLabLoggerSystemdUserUnit();
    assert.match(unit, /\[Service\]/);
    assert.match(unit, /Nice=10/);
    assert.match(unit, new RegExp(LAB_LOGGER_REMOTE_ROOT));
    assert.match(unit, /--http-port 8765/);
    assert.doesNotMatch(unit, /--fake-source/);
    assert.match(unit, /WantedBy=default\.target/);
    const fake = buildLabLoggerSystemdUserUnit({ fakeSource: true });
    assert.match(fake, /--fake-source/);
  });

  it("status probe includes soft markers and safe proc check", () => {
    const cmd = buildLabLoggerStatusProbeCmd();
    assert.match(cmd, /###LAB_LOGGER###/);
    assert.match(cmd, /###END###/);
    assert.match(cmd, /###HEALTH###/);
    assert.match(cmd, new RegExp(LAB_LOGGER_UNIT_NAME));
    assert.match(cmd, /127\.0\.0\.1:8765\/lab\/health/);
    assert.match(cmd, /sm_lab_logger/);
    assert.match(cmd, new RegExp(LAB_LOGGER_USER_UNIT_PATH.replace(/\//g, "\\/")));
    assert.match(cmd, /XDG_RUNTIME_DIR/);
    assert.match(cmd, /path=\/home\/pi\/sm-lab-logger/);
    // Must not use broad pgrep that matches the probe shell itself
    assert.doesNotMatch(cmd, /pgrep -af/);
    assert.match(cmd, /ps -C python3/);
  });

  it("remote unpack uses exec multiline script + && (no broken for:;)", () => {
    const cmd = buildLabLoggerRemoteUnpackCmd();
    assert.match(cmd, new RegExp(LAB_LOGGER_REMOTE_BUNDLE_PATH));
    assert.match(cmd, /UNPACK_OK/);
    assert.match(cmd, /python3 -c/);
    assert.match(cmd, /exec\(/);
    assert.match(cmd, / && /);
    // NatsSource now uses a stdlib-only mini NATS client (mini_nats.py) — no
    // more `pip install nats-py`. That step silently failed on field
    // complexos hosts (no route to PyPI), leaving NatsSource() raising
    // ImportError and the agent stuck in source=idle forever (empty ring).
    // Do not re-add a pip step here without re-reading that incident.
    assert.doesNotMatch(cmd, /pip install/);
    assert.doesNotMatch(cmd, /for rel,b in blob\['files'\]\.items\(\):;/);
    assert.doesNotMatch(cmd, /echo '[A-Za-z0-9+/=]{200,}/);
    assert.ok(cmd.length < 9000, `unpack cmd too long: ${cmd.length}`);
  });

  it("user systemd prefix exports XDG_RUNTIME_DIR", () => {
    assert.match(buildLabLoggerUserSystemdPrefix(), /XDG_RUNTIME_DIR/);
    assert.match(buildLabLoggerEnableAutostartCmd(), /enable-linger/);
    assert.match(buildLabLoggerStartCmd(), /systemctl --user start/);
  });

  it("extracts first JSON object from noisy SSH output", () => {
    const noisy =
      "Warning: Permanently added\n" +
      '{"ok":true,"ticks":2,"lock_held":false,"topology_warnings":[]}\n' +
      "extra junk";
    const sliced = extractFirstJsonObject(noisy);
    assert.ok(sliced);
    assert.equal(JSON.parse(sliced!).ok, true);
    assert.equal(extractFirstJsonObject("no json here"), null);
    assert.equal(extractFirstJsonObject("{"), null);
  });

  it("strips SSH PQ / known_hosts noise", () => {
    const noisy = [
      "Warning: Permanently added 'localhost' to the list of known hosts.",
      "demo: post-quantum key exchange warning",
      "Failed to stop unit: Unit file does not exist",
    ].join("\n");
    const cleaned = stripLabLoggerSshNoise(noisy);
    assert.doesNotMatch(cleaned, /known_hosts/i);
    assert.doesNotMatch(cleaned, /post-quantum/i);
    assert.match(cleaned, /Unit file does not exist/);
    assert.equal(isLabLoggerMissingUnitError(noisy), true);
    assert.equal(isLabLoggerMissingUnitError("connection refused"), false);
  });

  it("strips the OpenSSH PQ 'store now, decrypt later' advisory (field wording)", () => {
    // Verbatim wrapping seen in the field over stock OpenSSH clients; must
    // not leak through to the SM log as a fake "[err]" line.
    const noisy = [
      "**********************************************************************",
      '** This session may be vulnerable to "store now, decrypt later" attacks. **',
      "** The server may need to be upgraded. See https://openssh.com/pq.html **",
      "**********************************************************************",
      "ok",
    ].join("\n");
    const cleaned = stripLabLoggerSshNoise(noisy);
    assert.doesNotMatch(cleaned, /vulnerable/i);
    assert.doesNotMatch(cleaned, /decrypt later/i);
    assert.doesNotMatch(cleaned, /openssh\.com/i);
    assert.doesNotMatch(cleaned, /\*/);
    assert.match(cleaned, /^ok$/);
  });

  it("parses health JSON (incl. banners / trailing junk)", () => {
    const h = parseLabLoggerHealthJson(
      JSON.stringify({
        ok: true,
        last_sample_age_ms: 120,
        lock_held: true,
        topology_warnings: ["coffee@unexpected"],
        disk_bytes: 42,
        ticks: 3,
        watchdog_backoff: false,
        dx_allowed: true,
        interval_ms: 200,
      })
    );
    assert.ok(h);
    assert.equal(h!.ok, true);
    assert.equal(h!.lastSampleAgeMs, 120);
    assert.equal(h!.lockHeld, true);
    assert.deepEqual(h!.topologyWarnings, ["coffee@unexpected"]);
    assert.equal(parseLabLoggerHealthJson("{}"), null);
    assert.equal(parseLabLoggerHealthJson("not-json"), null);
    const noisy = parseLabLoggerHealthJson(
      'banner\n{"ok":true,"ticks":1,"lock_held":false,"topology_warnings":[],"disk_bytes":0}\n'
    );
    assert.ok(noisy);
    assert.equal(noisy!.ticks, 1);
  });

  it("parses status probe output", () => {
    const out = [
      "###LAB_LOGGER###",
      "path=/home/pi/sm-lab-logger",
      "installed=yes",
      "unit_active=active",
      "unit_enabled=enabled",
      "proc=1234 python3 /home/pi/sm-lab-logger/main.py|",
      "python=/usr/bin/python3",
      "###HEALTH###",
      '{"ok":true,"last_sample_age_ms":50,"lock_held":true,"topology_warnings":[],"disk_bytes":10,"ticks":1,"watchdog_backoff":false,"dx_allowed":true,"interval_ms":200}',
      "###CONFIG###",
      '{"retain_hours":24,"interval_ms":200,"http_port":8765}',
      "###END###",
    ].join("\n");
    const s = parseLabLoggerStatusOutput(out);
    assert.equal(s.installed, true);
    assert.equal(s.remotePath, "/home/pi/sm-lab-logger");
    assert.equal(s.unitActive, "active");
    assert.equal(s.unitEnabled, true);
    assert.equal(s.processRunning, true);
    assert.equal(s.retainHours, 24);
    assert.ok(s.health?.ok);
    assert.match(formatLabLoggerStatusLine(s), /установлен/);
    assert.match(formatLabLoggerStatusLine(s), /path=\/home\/pi\/sm-lab-logger/);
  });

  it("formats installed but stopped", () => {
    const s = parseLabLoggerStatusOutput(
      [
        "###LAB_LOGGER###",
        "path=/home/pi/sm-lab-logger",
        "installed=yes",
        "unit_active=inactive",
        "unit_enabled=disabled",
        "proc=",
        "###HEALTH###",
        "{}",
        "###CONFIG###",
        "{}",
        "###END###",
      ].join("\n")
    );
    assert.equal(s.installed, true);
    assert.match(formatLabLoggerStatusLine(s), /установлен \(остановлен\)/);
    assert.match(formatLabLoggerStatusLine(s), /health=недоступен/);
  });

  it("parses health with SSH noise between markers", () => {
    const out = [
      "###LAB_LOGGER###",
      "installed=no",
      "unit_active=inactive",
      "unit_enabled=unknown",
      "proc=",
      "###HEALTH###",
      "curl: (7) Failed to connect",
      '{"ok":true,"ticks":9,"lock_held":true,"topology_warnings":[],"disk_bytes":1}',
      "###CONFIG###",
      "{}",
      "###END###",
    ].join("\n");
    const s = parseLabLoggerStatusOutput(out);
    assert.equal(s.installed, false);
    assert.ok(s.health?.ok);
    assert.equal(s.health!.ticks, 9);
    assert.equal(s.healthError, null);
  });

  it("formats orphan proc when not installed", () => {
    const s = parseLabLoggerStatusOutput(
      [
        "###LAB_LOGGER###",
        "installed=no",
        "unit_active=inactive",
        "unit_enabled=unknown",
        "proc=python3 /tmp/other/main.py|",
        "###HEALTH###",
        "{}",
        "###CONFIG###",
        "{}",
        "###END###",
      ].join("\n")
    );
    assert.equal(s.installed, false);
    assert.equal(s.processRunning, true);
    assert.match(formatLabLoggerStatusLine(s), /orphan/);
  });

  it("enable/disable/uninstall cmds are soft and wipe by default", () => {
    assert.match(buildLabLoggerEnableAutostartCmd(), /enable/);
    assert.match(buildLabLoggerDisableAutostartCmd(), /disable/);
    assert.match(buildLabLoggerDisableAutostartCmd(), /\|\| true/);
    const wipe = buildLabLoggerUninstallCmd();
    assert.match(wipe, /rm -rf '\/home\/pi\/sm-lab-logger'/);
    assert.match(wipe, /rm -f '\/home\/pi\/\.config\/systemd\/user\/sm-lab-logger\.service'/);
    assert.match(wipe, /daemon-reload/);
    assert.match(wipe, /\|\| true/);
    // Uninstall must revert host-level side effects left by install/autostart
    // (enable-linger, pip --user nats-py) — not just delete the code tree.
    assert.match(wipe, /disable-linger/);
    assert.match(wipe, /pip uninstall -y nats-py/);
    const keep = buildLabLoggerUninstallCmd({ wipeData: false });
    assert.match(keep, /main\.py/);
    assert.doesNotMatch(keep, /rm -rf '\/home\/pi\/sm-lab-logger'/);
    assert.match(buildLabLoggerHealthCurlCmd(), /\/lab\/health/);
    assert.match(buildLabLoggerEventsCurlCmd({ fromTs: 1 }), /from=1/);
  });

  it("download filename helper keeps .jsonl and fixes Windows-ish paths", () => {
    const name = labLoggerRingDownloadFilename(
      new Date("2026-08-02T14:58:01.534Z")
    );
    assert.equal(name, "sm-lab-logger-ring-20260802-145801.jsonl");
    assert.doesNotMatch(name, /\.jsonl\.txt$/);
    assert.doesNotMatch(name, /\d+\.\d+/); // no mid-name dots (Windows ext trap)

    assert.equal(
      ensureLabLoggerRingSavePath("C:/tmp/ring.jsonl"),
      "C:/tmp/ring.jsonl"
    );
    assert.equal(
      ensureLabLoggerRingSavePath("C:\\Users\\me\\Downloads\\ring.jsonl"),
      "C:\\Users\\me\\Downloads\\ring.jsonl"
    );
    // Windows Save dialog often appends .txt for unknown types
    assert.equal(
      ensureLabLoggerRingSavePath("C:/tmp/ring.jsonl.txt"),
      "C:/tmp/ring.jsonl"
    );
    assert.equal(
      ensureLabLoggerRingSavePath("C:/tmp/ring.txt"),
      "C:/tmp/ring.jsonl"
    );
    assert.equal(
      ensureLabLoggerRingSavePath("C:/tmp/ring.txt.txt"),
      "C:/tmp/ring.jsonl"
    );
    // No extension
    assert.equal(
      ensureLabLoggerRingSavePath("C:/tmp/ring"),
      "C:/tmp/ring.jsonl"
    );
    // Accidental double .jsonl
    assert.equal(
      ensureLabLoggerRingSavePath("C:/tmp/ring.jsonl.jsonl"),
      "C:/tmp/ring.jsonl"
    );
    // Force jsonl even if dialog returned .json (jsonl-only download)
    assert.equal(
      ensureLabLoggerRingSavePath("C:/tmp/ring.json", "jsonl"),
      "C:/tmp/ring.jsonl"
    );
    assert.equal(
      ensureLabLoggerRingSavePath("C:/tmp/ring", "json"),
      "C:/tmp/ring.json"
    );
    // Empty → default .jsonl basename
    assert.match(ensureLabLoggerRingSavePath(""), /\.jsonl$/);
  });

  it("package file list covers main + package modules", () => {
    assert.ok(LAB_LOGGER_PACKAGE_FILES.includes("main.py"));
    assert.ok(
      LAB_LOGGER_PACKAGE_FILES.some((f) => f.startsWith("sm_lab_logger/"))
    );
    assert.ok(LAB_LOGGER_PACKAGE_FILES.includes("sm_lab_logger/http_api.py"));
    assert.ok(LAB_LOGGER_PACKAGE_FILES.includes("sm_lab_logger/devices.py"));
    assert.ok(LAB_LOGGER_PACKAGE_FILES.includes("sm_lab_logger/dx_ui.py"));
    assert.ok(LAB_LOGGER_PACKAGE_FILES.includes("requirements.txt"));
  });

  it("clamps realtime poll interval (SSH-safe bounds)", () => {
    assert.equal(clampLabLoggerPollIntervalMs(100), LAB_LOGGER_POLL_INTERVAL_MS_MIN);
    assert.equal(clampLabLoggerPollIntervalMs(1500), 1500);
    assert.equal(
      clampLabLoggerPollIntervalMs(99_999),
      LAB_LOGGER_POLL_INTERVAL_MS_MAX
    );
    assert.equal(
      clampLabLoggerPollIntervalMs(Number.NaN),
      LAB_LOGGER_POLL_INTERVAL_MS_DEFAULT
    );
    assert.ok(LAB_LOGGER_POLL_INTERVAL_MS_MIN >= 1000);
    assert.equal(LAB_LOGGER_POLL_INTERVAL_MS_DEFAULT, 1500);
  });

  it("converts onboard records and advances from= cursor", () => {
    const delta = {
      v: 1,
      ts: 1_725_000_000_000,
      kind: "valve",
      module: "milk",
      name: "drain",
      value: 1,
    };
    const snap = {
      v: 1,
      ts: 1_725_000_001_000,
      kind: "snapshot",
      values: { "coffee.pumpCurrent": 0.4, "milk.drain": 0 },
      kinds: { "coffee.pumpCurrent": "sensor", "milk.drain": "valve" },
    };
    const events = convertOnboardRecordsToLabEvents([delta, snap]);
    assert.equal(events.length, 3);
    assert.equal(events[0]!.kind, "valve");
    assert.equal(events[0]!.module, "milk");
    assert.equal(events[0]!.value, true); // 0/1 → boolean
    assert.equal(events[1]!.kind, "sensor");
    assert.equal(events[1]!.detail, "heartbeat");
    assert.equal(events[2]!.kind, "valve");
    assert.equal(events[2]!.value, false);
    assert.equal(maxOnboardRecordTs([delta, snap]), 1_725_000_001_000);
    assert.equal(nextOnboardEventsFromTs(1_725_000_001_000), 1_725_000_001_001);
    assert.equal(nextOnboardEventsFromTs(null), 0);
    assert.equal(normalizeOnboardTsMs(1_725_000_000), 1_725_000_000_000);

    const merged = mergeOnboardLabEvents([], events);
    assert.equal(merged.length, 3);
    const again = mergeOnboardLabEvents(merged, events);
    assert.equal(again.length, 3); // no dupes (same at)
    assert.deepEqual(collectOnboardSeriesKeys(merged).sort(), [
      "coffee.pumpCurrent",
    ]);
    assert.deepEqual(valvesMapFromOnboardEvents(merged).milk, ["drain"]);
    assert.deepEqual(onboardValveOverlayKeys(merged).sort(), ["milk.drain"]);
    assert.deepEqual(onboardPumpOverlayHosts(merged), []);
    const withPump = mergeOnboardLabEvents(merged, [
      createLabEvent({
        at: new Date(1_725_000_002_000).toISOString(),
        kind: "pump",
        module: "coffee",
        hwid: "onboard",
        name: "pump",
        value: true,
      }),
      createLabEvent({
        at: new Date(1_725_000_002_000).toISOString(),
        kind: "sensor",
        module: "milk",
        hwid: "onboard",
        name: "heater1_pwm",
        value: 30,
      }),
    ]);
    assert.deepEqual(onboardPumpOverlayHosts(withPump), ["coffee"]);
    assert.deepEqual(onboardHeaterPwmOverlayKeys(withPump), ["milk.heater1_pwm"]);
    assert.deepEqual(onboardHeaterIds(withPump), ["heater1"]);
  });

  it("does not wipe accumulated onboard history on a small delta batch (curves stayed visible)", () => {
    // Regression: mergeOnboardLabEvents used to delegate to
    // mergeLabChartSyncEvents, whose "prev.length > 1000 && incoming.length
    // <= 8" heuristic (meant to detect Modules «Очистить лог») fires on
    // almost every quiet onboard poll tick — a delta+heartbeat source
    // legitimately sends tiny batches (often just 1-3 events) between
    // heartbeats. That wiped the whole local chart ring back down to a
    // handful of points on a cycle, i.e. "curves disappear after a while".
    let events: LabEvent[] = [];
    for (let i = 0; i < 1200; i++) {
      events = mergeOnboardLabEvents(events, [
        createLabEvent({
          at: new Date(1_725_000_000_000 + i * 200).toISOString(),
          kind: "sensor",
          module: "milk",
          hwid: "onboard",
          name: "input",
          value: 20 + (i % 5),
        }),
      ]);
    }
    // 1200 single-event polls, each batch well under the old "<=8" trigger —
    // history must have accumulated, not been reset back to ~1 each time.
    assert.ok(
      events.length > 1000,
      `expected accumulated history, got ${events.length}`
    );

    // A genuinely empty poll (nothing changed this tick) must also not
    // discard prior history.
    const afterEmpty = mergeOnboardLabEvents(events, []);
    assert.equal(afterEmpty.length, events.length);
  });

  it("orders valves canonically (MODULE_VALVES), not alphabetically", () => {
    // Regression: valvesMapFromOnboardEvents used `.sort()` (alphabetical),
    // which put "air" (Пневмораспределитель №6) before drain/dump/
    // drysideValve — the opposite of how Modules lists the same valves
    // (MODULE_VALVES.milk: milkInput, waterInput, drain, dump,
    // drysideValve, air). Field report: onboard chart valve order didn't
    // match Modules at all.
    const events = [
      createLabEvent({ kind: "valve", module: "milk", hwid: "onboard", name: "air", value: false }),
      createLabEvent({ kind: "valve", module: "milk", hwid: "onboard", name: "drysideValve", value: false }),
      createLabEvent({ kind: "valve", module: "milk", hwid: "onboard", name: "dump", value: false }),
      createLabEvent({ kind: "valve", module: "milk", hwid: "onboard", name: "drain", value: true }),
      createLabEvent({ kind: "valve", module: "milk", hwid: "onboard", name: "waterInput", value: false }),
      createLabEvent({ kind: "valve", module: "milk", hwid: "onboard", name: "milkInput", value: false }),
    ];
    const map = valvesMapFromOnboardEvents(events);
    assert.deepEqual(map.milk, [
      "milkInput",
      "waterInput",
      "drain",
      "dump",
      "drysideValve",
      "air",
    ]);
  });

  it("detects realtime readiness from status", () => {
    assert.equal(isLabLoggerRealtimeReady(null), false);
    const stopped = parseLabLoggerStatusOutput(
      [
        "###LAB_LOGGER###",
        "installed=yes",
        "unit_active=inactive",
        "unit_enabled=disabled",
        "proc=",
        "###HEALTH###",
        "{}",
        "###CONFIG###",
        "{}",
        "###END###",
      ].join("\n")
    );
    assert.equal(isLabLoggerRealtimeReady(stopped), false);
    const active = parseLabLoggerStatusOutput(
      [
        "###LAB_LOGGER###",
        "installed=yes",
        "unit_active=active",
        "unit_enabled=enabled",
        "proc=python3 /home/pi/sm-lab-logger/main.py|",
        "###HEALTH###",
        '{"ok":true,"ticks":1,"lock_held":true,"topology_warnings":[],"disk_bytes":0}',
        "###CONFIG###",
        "{}",
        "###END###",
      ].join("\n")
    );
    assert.equal(isLabLoggerRealtimeReady(active), true);
    assert.ok(formatLabLoggerStatusParts(active).length >= 4);
  });

  it("browser-safe export includes path constants used by LabLoggerPage", async () => {
    const browser = await import("./browser.js");
    assert.equal(browser.LAB_LOGGER_REMOTE_ROOT, "/home/pi/sm-lab-logger");
    assert.match(browser.LAB_LOGGER_USER_UNIT_REL, /sm-lab-logger\.service/);
    assert.equal(
      typeof browser.formatLabLoggerStatusLine,
      "function"
    );
    assert.equal(typeof browser.clampLabLoggerPollIntervalMs, "function");
    assert.equal(typeof browser.convertOnboardRecordsToLabEvents, "function");
    assert.equal(typeof browser.ensureLabLoggerRingSavePath, "function");
    assert.equal(typeof browser.onboardValveOverlayKeys, "function");
    assert.equal(typeof browser.onboardPumpOverlayHosts, "function");
    assert.equal(typeof browser.onboardHeaterPwmOverlayKeys, "function");
    assert.equal(typeof browser.onboardHeaterIds, "function");
    assert.equal(browser.LAB_LOGGER_POLL_INTERVAL_MS_DEFAULT, 1500);
  });
});
