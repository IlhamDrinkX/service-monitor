/**
 * Проверка wiring help/URL без Electron (node --test).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CONTROL_HELPS,
  HELP_ARTICLES,
  localServiceUrls,
} from "@service-monitor/core";

describe("desktop / stage0 content wiring", () => {
  it("exposes helps used by navigation and access buttons", () => {
    const required = [
      "nav.fleet",
      "nav.access",
      "nav.session",
      "nav.modules",
      "nav.peripherals",
      "nav.complexos",
      "nav.config",
      "nav.help",
      "nav.settings",
      "lab.scenarios",
      "lab.scenario.milkrinseMicro",
      "lab.scenario.milkrinseLong",
      "access.generateKey",
      "access.copySnippet",
      "access.applyConfig",
      "session.dashboard",
      "session.kiosk",
      "settings.debug",
    ];
    for (const id of required) {
      assert.ok(CONTROL_HELPS[id], id);
      assert.ok(CONTROL_HELPS[id].body.length > 20);
    }
  });

  it("has help articles for complex architecture", () => {
    assert.ok(HELP_ARTICLES.some((a) => a.id === "how-complex-works"));
    assert.ok(HELP_ARTICLES.some((a) => a.id === "debug-mode"));
    assert.ok(HELP_ARTICLES.some((a) => a.id === "nats-payloads"));
    assert.ok(HELP_ARTICLES.some((a) => a.id === "lab-scenarios"));
  });

  it("session shortcuts point at tunnel ports", () => {
    const urls = localServiceUrls();
    assert.match(urls.dashboard, /:8080/);
    assert.match(urls.kiosk, /ordering/);
    assert.match(urls.water, /:8084/);
  });
});
