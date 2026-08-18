/**
 * Host Ping page wiring (form targets + help ids + session gate).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CONTROL_HELPS } from "@service-monitor/core";
import {
  hasHostPingTabletTarget,
  HOST_PING_COMPLEXOS_LAN_IP,
  HOST_PING_REMOTE_ROOT,
  isHostPingSessionAllowed,
  isSeries4ForHostPing,
  resolveHostPingSshTarget,
  resolveHostPingTabletTargets,
  buildHostPingRemoteOpenSshArgs,
} from "@service-monitor/core";
import { readTabletTargetsFromFields } from "./lib/host-ping-targets.ts";

describe("desktop / hostPing", () => {
  it("exposes HostPingPage help ids", () => {
    for (const id of [
      "nav.hostPing",
      "hostPing.install",
      "hostPing.targets",
      "hostPing.download",
    ]) {
      assert.ok(CONTROL_HELPS[id], id);
      assert.ok(CONTROL_HELPS[id]!.body.length > 20);
    }
    assert.match(CONTROL_HELPS["nav.hostPing"]!.body, /sm-host-ping/);
    assert.match(CONTROL_HELPS["hostPing.install"]!.body, /IP|MAC/);
    assert.match(CONTROL_HELPS["hostPing.targets"]!.body, /полях|поля/i);
  });

  it("canonical remote root", () => {
    assert.equal(HOST_PING_REMOTE_ROOT, "/home/pi/sm-host-ping");
    assert.equal(hasHostPingTabletTarget({ ip: "", mac: "" }), false);
    assert.equal(hasHostPingTabletTarget({ ip: "", mac: "aa:bb:cc:dd:ee:ff" }), true);
  });

  it("SSH target builder: Local LAN vs Remote 4.09 jump", () => {
    assert.deepEqual(
      resolveHostPingSshTarget({
        connected: true,
        mode: "local",
        sshPort: null,
      }),
      { mode: "local", host: HOST_PING_COMPLEXOS_LAN_IP, port: 22 }
    );
    assert.deepEqual(
      resolveHostPingSshTarget({
        connected: true,
        mode: "remote",
        sshPort: 22409,
      }),
      { mode: "remote", sshPort: 22409 }
    );
    const argv = buildHostPingRemoteOpenSshArgs({
      sshPort: 22409,
      identityFile: "/tmp/id",
      command: "true",
    });
    assert.ok(argv.includes("tun@erp.fibbee.com"));
    assert.ok(argv.includes("pi@localhost"));
    assert.ok(argv.includes("22409"));
    assert.equal(argv.some((a) => a.includes("127.0.0.1")), false);
  });

  it("readTabletTargetsFromFields rejects empty and builds install payload", () => {
    const empty = readTabletTargetsFromFields({ ip: "", mac: "" });
    assert.equal(empty.ok, false);
    if (!empty.ok) {
      assert.match(empty.error, /IP или MAC/);
      assert.equal(empty.focus, "both");
    }

    const next = readTabletTargetsFromFields({
      ip: "192.168.1.50",
      mac: "AABBCCDDEEFF",
    });
    assert.equal(next.ok, true);
    if (next.ok) {
      assert.equal(next.tabletIp, "192.168.1.50");
      assert.equal(next.tabletMac, "aa:bb:cc:dd:ee:ff");
      // Same shape hostPingInstall / hostPingSetTablet expect.
      const installPayload = {
        tabletIp: next.tabletIp,
        tabletMac: next.tabletMac,
        enableAutostart: true,
      };
      assert.equal(installPayload.tabletIp, "192.168.1.50");
      assert.equal(installPayload.tabletMac, "aa:bb:cc:dd:ee:ff");
    }

    const viaCore = resolveHostPingTabletTargets({
      ip: "",
      mac: "aa-bb-cc-dd-ee-01",
    });
    assert.equal(viaCore.ok, true);
    if (viaCore.ok) assert.equal(viaCore.tabletMac, "aa:bb:cc:dd:ee:01");
  });

  it("enables controls for Remote series 4.09 (and Local)", () => {
    assert.equal(isSeries4ForHostPing("4.09"), true);
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
    // Passing the SessionContextValue shape (hook return) must not enable controls.
    assert.equal(
      isHostPingSessionAllowed({
        session: {
          connected: true,
          mode: "remote",
          seriesLabel: "4.09",
        },
      } as never),
      false
    );
  });
});
