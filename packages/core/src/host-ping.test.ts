/**
 * Host ping core helpers (tablet targets, config, status parse).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  HOST_PING_PACKAGE_FILES,
  HOST_PING_REMOTE_ROOT,
  HOST_PING_UNIT_NAME,
  HOST_PING_COMPLEXOS_LAN_IP,
  buildHostPingConfigJson,
  buildHostPingRemoteOpenSshArgs,
  buildHostPingSystemdUserUnit,
  formatHostPingSshError,
  formatHostPingStatusLine,
  formatHostPingLogLineForDisplay,
  formatHostPingLogTextForDisplay,
  formatHostPingReachableValue,
  hasHostPingTabletTarget,
  isHostPingSessionAllowed,
  isPlausibleIpv4,
  isPlausibleMac,
  isSeries4ForHostPing,
  normalizeHostPingMac,
  parseHostPingStatusOutput,
  resolveHostPingSshTarget,
  resolveHostPingTabletTargets,
} from "./nats/host-ping.js";
import { parseSeriesLabel, sshPortFromSeries } from "./domain/lan-map.js";

describe("host-ping", () => {
  it("allows Remote 4.09 and Local LAN sessions", () => {
    assert.equal(isSeries4ForHostPing("4.09"), true);
    assert.equal(isSeries4ForHostPing("4.8"), true);
    assert.equal(isSeries4ForHostPing("3.05"), false);
    assert.equal(
      isHostPingSessionAllowed({
        connected: true,
        mode: "remote",
        seriesLabel: "4.09",
      }),
      true
    );
    assert.equal(
      isHostPingSessionAllowed({
        connected: true,
        mode: "local",
        seriesLabel: null,
      }),
      true
    );
    assert.equal(
      isHostPingSessionAllowed({
        connected: false,
        mode: "remote",
        seriesLabel: "4.09",
      }),
      false
    );
  });

  it("resolves Local vs Remote SSH targets (4.09 → 22409)", () => {
    assert.deepEqual(
      resolveHostPingSshTarget({
        connected: true,
        mode: "local",
        sshPort: null,
      }),
      { mode: "local", host: HOST_PING_COMPLEXOS_LAN_IP, port: 22 }
    );
    const { major, minor } = parseSeriesLabel("4.09");
    const port409 = sshPortFromSeries(major, minor);
    assert.equal(port409, 22409);
    assert.deepEqual(
      resolveHostPingSshTarget({
        connected: true,
        mode: "remote",
        sshPort: port409,
      }),
      { mode: "remote", sshPort: 22409 }
    );
    assert.throws(
      () => resolveHostPingSshTarget({ connected: false, mode: "remote", sshPort: 22409 }),
      /Нужна активная сессия/
    );
    assert.throws(
      () =>
        resolveHostPingSshTarget({
          connected: true,
          mode: "remote",
          sshPort: null,
        }),
      /Remote-сессия без/
    );
  });

  it("builds Remote OpenSSH argv with ProxyJump (not bare 127.0.0.1)", () => {
    const args = buildHostPingRemoteOpenSshArgs({
      sshPort: 22409,
      identityFile: "C:/Users/x/.ssh/id_ed25519",
      command: "echo OK",
    });
    assert.ok(args.includes("-J"));
    assert.ok(args.includes("tun@erp.fibbee.com"));
    assert.ok(args.includes("-p"));
    assert.ok(args.includes("22409"));
    assert.ok(args.includes("pi@localhost"));
    assert.equal(args.includes("127.0.0.1"), false);
    assert.equal(args.at(-1), "echo OK");
  });

  it("maps SSH connect failures to clear RU (session vs refused)", () => {
    assert.match(
      formatHostPingSshError("Нужна активная сессия (вкладка Сессия)"),
      /Нужна активная сессия/
    );
    assert.match(
      formatHostPingSshError(
        "ssh: connect to host localhost port 22409: Connection refused"
      ),
      /соединение отклонено/
    );
  });

  it("package files include main + sm_host_ping", () => {
    assert.ok(HOST_PING_PACKAGE_FILES.includes("main.py"));
    assert.ok(HOST_PING_PACKAGE_FILES.includes("sm_host_ping/ping.py"));
    assert.ok(HOST_PING_PACKAGE_FILES.includes("sm_host_ping/resolve.py"));
  });

  it("paths and unit name", () => {
    assert.equal(HOST_PING_REMOTE_ROOT, "/home/pi/sm-host-ping");
    assert.equal(HOST_PING_UNIT_NAME, "sm-host-ping");
  });

  it("requires tablet ip or mac for config", () => {
    assert.throws(() => buildHostPingConfigJson({}), /IP или MAC/);
    const cfg = buildHostPingConfigJson({ tabletIp: "192.168.1.28" });
    assert.match(cfg, /192\.168\.1\.28/);
    assert.match(cfg, /erp\.fibbee\.com/);
    assert.match(cfg, /91\.206\.15\.66/);
    assert.match(cfg, /8\.8\.8\.8/);
    assert.match(cfg, /"snapshot_minutes": 5/);
    const cfg2 = buildHostPingConfigJson({ tabletMac: "aa:bb:cc:dd:ee:ff" });
    assert.match(cfg2, /aa:bb:cc:dd:ee:ff/);
  });

  it("normalizes MAC formats into config tablet.mac", () => {
    assert.equal(normalizeHostPingMac("AA-BB-CC-DD-EE-FF"), "aa:bb:cc:dd:ee:ff");
    assert.equal(normalizeHostPingMac("aabbccddeeff"), "aa:bb:cc:dd:ee:ff");
    assert.equal(normalizeHostPingMac(""), "");
    assert.equal(normalizeHostPingMac("zz"), null);

    const cfg = buildHostPingConfigJson({ tabletMac: "AA-BB-CC-DD-EE-01" });
    const parsed = JSON.parse(cfg) as { tablet: { mac?: string; ip?: string } };
    assert.equal(parsed.tablet.mac, "aa:bb:cc:dd:ee:01");
    assert.equal(parsed.tablet.ip, undefined);

    const both = buildHostPingConfigJson({
      tabletIp: "192.168.1.28",
      tabletMac: "aabbccddee01",
    });
    const p2 = JSON.parse(both) as { tablet: { mac?: string; ip?: string } };
    assert.equal(p2.tablet.ip, "192.168.1.28");
    assert.equal(p2.tablet.mac, "aa:bb:cc:dd:ee:01");
  });

  it("resolveHostPingTabletTargets for install payload", () => {
    const empty = resolveHostPingTabletTargets({ ip: "  ", mac: "" });
    assert.equal(empty.ok, false);
    if (!empty.ok) assert.equal(empty.focus, "both");

    const badIp = resolveHostPingTabletTargets({ ip: "1.2.3", mac: "" });
    assert.equal(badIp.ok, false);

    const ok = resolveHostPingTabletTargets({
      ip: "192.168.1.28",
      mac: "aa-bb-cc-dd-ee-ff",
    });
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.tabletIp, "192.168.1.28");
      assert.equal(ok.tabletMac, "aa:bb:cc:dd:ee:ff");
    }
  });

  it("validates ip/mac helpers", () => {
    assert.equal(hasHostPingTabletTarget({ ip: "", mac: "" }), false);
    assert.equal(hasHostPingTabletTarget({ ip: "1.2.3.4", mac: "" }), true);
    assert.equal(isPlausibleIpv4("192.168.1.1"), true);
    assert.equal(isPlausibleIpv4("999.1.1.1"), false);
    assert.equal(isPlausibleMac("aa-bb-cc-dd-ee-ff"), true);
    assert.equal(isPlausibleMac("aabbccddeeff"), true);
    assert.equal(isPlausibleMac("zz"), false);
  });

  it("systemd unit mentions sm-host-ping", () => {
    const u = buildHostPingSystemdUserUnit();
    assert.match(u, /sm-host-ping/);
    assert.match(u, /Nice=10/);
  });

  it("parses status probe output", () => {
    const s = parseHostPingStatusOutput(
      [
        "###HOST_PING###",
        "path=/home/pi/sm-host-ping",
        "installed=yes",
        "unit_active=active",
        "unit_enabled=enabled",
        "proc=python3 /home/pi/sm-host-ping/main.py|",
        "###CONFIG###",
        '{"tablet":{"ip":"192.168.1.28","mac":"aa:bb:cc:dd:ee:01"},"ping_interval_sec":30,"retain_days":14}',
        "###RING###",
        "ring_bytes=42",
        "###END###",
      ].join("\n")
    );
    assert.equal(s.installed, true);
    assert.equal(s.unitActive, "active");
    assert.equal(s.processRunning, true);
    assert.equal(s.ringBytes, 42);
    assert.equal(s.tabletIp, "192.168.1.28");
    assert.equal(s.tabletMac, "aa:bb:cc:dd:ee:01");
    assert.match(formatHostPingStatusLine(s), /установлен/);
  });

  it("formats log lines with human time and онлайн/оффлайн", () => {
    assert.equal(formatHostPingReachableValue(0), "оффлайн");
    assert.equal(formatHostPingReachableValue(1), "онлайн");
    assert.equal(formatHostPingReachableValue("онлайн"), "онлайн");

    const legacy =
      '{"v":1,"ts":1786375055023,"kind":"host","module":"tablet","name":"reachable","value":0}';
    const pretty = formatHostPingLogLineForDisplay(legacy);
    assert.match(pretty, /tablet/);
    assert.match(pretty, /оффлайн/);
    assert.match(pretty, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

    const modern =
      '{"v":1,"ts":1786375055023,"at":"2026-08-11T10:17:35","kind":"host","module":"milk","name":"reachable","value":"онлайн"}';
    assert.equal(
      formatHostPingLogLineForDisplay(modern),
      "2026-08-11T10:17:35  milk  онлайн"
    );

    const multi = formatHostPingLogTextForDisplay(`${legacy}\n${modern}\n`);
    assert.equal(multi.split("\n").length, 2);

    const trace =
      '{"v":1,"ts":1786375055023,"at":"2026-08-11T10:17:35","kind":"trace","module":"erp","name":"traceroute","value":"1 192.168.1.1\\n2 *"}';
    assert.match(formatHostPingLogLineForDisplay(trace), /traceroute/);
    assert.match(formatHostPingLogLineForDisplay(trace), /erp/);
  });
});
