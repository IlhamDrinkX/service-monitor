/**
 * Stage 1 tests: SSH config generation/merge, profiles, write gate.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createComplexProfile,
  hasErpJumpHost,
  localServiceUrls,
  mergeSshConfig,
  profileFromSeriesLabel,
  renderSshSnippet,
  WriteGate,
} from "./index.js";
import {
  hashServicePassword,
  passwordsMatch,
  verifyServicePassword,
  SERVICE_PASSWORD_PLAIN,
} from "./security/password.js";

describe("stage1 / profiles", () => {
  it("builds profile from series label 4.15", () => {
    const p = profileFromSeriesLabel("4.15");
    assert.equal(p.sshPort, 22415);
    assert.equal(p.seriesLabel, "4.15");
    assert.match(p.name, /4\.15/);
  });

  it("rejects invalid ssh ports", () => {
    assert.throws(
      () => createComplexProfile({ name: "x", sshPort: 22 }),
      /22000/
    );
  });
});

describe("stage1 / ssh-config", () => {
  const profile = profileFromSeriesLabel("4.15");
  const profile417 = profileFromSeriesLabel("4.17");
  const identityFile = "C:\\Users\\Ilham\\.ssh\\id_ed25519";

  it("default snippet is complex-only (no jump duplicate)", () => {
    const snippet = renderSshSnippet({ profile, identityFile });
    assert.doesNotMatch(snippet, /Host erp\.fibbee\.com/);
    assert.match(snippet, /Host 22415/);
    assert.match(
      snippet,
      /LocalForward 127\.0\.0\.1:8082 192\.168\.1\.44:8000/
    );
  });

  it("can optionally render jump + complex", () => {
    const snippet = renderSshSnippet({
      profile,
      identityFile,
      includeJumpHost: true,
    });
    assert.match(snippet, /Host erp\.fibbee\.com/);
    assert.match(snippet, /User tun/);
    assert.match(snippet, /Host 22415/);
  });

  it("merges replacing existing Host without re-adding jump", () => {
    const old = [
      "# === Подключение к ERP (шлюз) ===",
      "Host erp.fibbee.com",
      "    User tun",
      "",
      "Host 22415",
      "    Port 22415",
      "    LocalForward 127.0.0.1:8080 192.168.1.43:80",
      "",
      "Host 22416",
      "    Port 22416",
      "",
    ].join("\n");

    const result = mergeSshConfig(old, { profile, identityFile });
    assert.equal(result.hadJumpHost, true);
    assert.equal(result.jumpHostAdded, false);
    assert.equal(
      result.config.match(/Host erp\.fibbee\.com/g)?.length,
      1
    );
    assert.match(result.config, /192\.168\.1\.46:8000/);
    assert.equal(result.config.match(/Host 22415/g)?.length, 1);
    assert.match(result.config, /Host 22416/);
  });

  it("adds only new complex when jump already present", () => {
    const old = [
      "Host erp.fibbee.com",
      "    User tun",
      "",
      "Host 22415",
      "    Port 22415",
      "",
    ].join("\n");

    const result = mergeSshConfig(old, {
      profile: profile417,
      identityFile,
    });
    assert.equal(result.hadJumpHost, true);
    assert.equal(result.jumpHostAdded, false);
    assert.equal(
      result.config.match(/Host erp\.fibbee\.com/g)?.length,
      1
    );
    assert.match(result.config, /Host 22417/);
    assert.match(result.config, /Комплекс №4\.17/);
  });

  it("adds jump once on empty config", () => {
    const result = mergeSshConfig("", { profile, identityFile });
    assert.equal(result.hadJumpHost, false);
    assert.equal(result.jumpHostAdded, true);
    assert.equal(hasErpJumpHost(result.config), true);
    assert.match(result.config, /Host 22415/);
  });

  it("exposes chart URLs for milk/coffee/water", () => {
    const urls = localServiceUrls();
    assert.match(urls.dashboard, /8080/);
    assert.match(urls.kiosk, /ordering/);
    assert.equal(urls.milkCharts, "http://127.0.0.1:8082/");
    assert.equal(urls.coffeeCharts, "http://127.0.0.1:8083/");
    assert.equal(urls.waterCharts, "http://127.0.0.1:8084/");
  });
});

describe("stage1 / write-gate", () => {
  it("stays locked by default and unlocks with service password", async () => {
    let now = 1_000_000;
    const gate = new WriteGate({
      sessionTtlMs: 1000,
      verifyPassword: (p) => verifyServicePassword(p),
      now: () => now,
    });
    assert.equal(gate.isUnlocked(), false);
    assert.equal((await gate.unlock("wrong")).unlocked, false);
    assert.equal(
      (await gate.unlock(SERVICE_PASSWORD_PLAIN)).unlocked,
      true
    );
    gate.assertCanWrite();
    now += 2000;
    assert.equal(gate.isUnlocked(), false);
    assert.throws(() => gate.assertCanWrite(), /Write locked/);
  });

  it("accepts admin password 112358", () => {
    assert.equal(SERVICE_PASSWORD_PLAIN, "112358");
    assert.equal(verifyServicePassword("112358"), true);
    assert.equal(verifyServicePassword("000000"), false);
    assert.equal(passwordsMatch("112358"), true);
    assert.ok(hashServicePassword("112358").length === 64);
  });
});
