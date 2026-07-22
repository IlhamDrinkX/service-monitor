/**
 * Stage 0 tests: domain map, debug logger, help, param hints.
 * Запуск: node --test (после tsc).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LAN_MAP,
  DebugLogger,
  getControlHelp,
  getParamHint,
  HELP_ARTICLES,
  NATS_SUBJECTS,
  sshPortFromSeries,
  parseSeriesLabel,
  suggestCurrentThresholdFromDry,
} from "./index.js";

describe("stage0 / lan-map", () => {
  it("maps DrinkX series 4.15 to SSH port 22415", () => {
    assert.equal(sshPortFromSeries(4, 15), 22415);
  });

  it("parses flexible series labels", () => {
    assert.equal(parseSeriesLabel("№4,17").label, "4.17");
    assert.equal(parseSeriesLabel("Комплекс 4.09").label, "4.09");
    assert.equal(sshPortFromSeries(0, 5), 22005);
    assert.throws(() => parseSeriesLabel("abc"), /вида 4\.15/);
  });

  it("uses module web on :8000 and complexos/router on :80", () => {
    const byRole = Object.fromEntries(
      DEFAULT_LAN_MAP.map((e) => [e.role, e])
    );
    assert.equal(byRole.complexos.remotePort, 80);
    assert.equal(byRole.router.remotePort, 80);
    assert.equal(byRole.milk.remotePort, 8000);
    assert.equal(byRole.coffee.remotePort, 8000);
    assert.equal(byRole.water.remotePort, 8000);
    assert.equal(byRole.water.localPort, 8084);
  });
});

describe("stage0 / debug-logger", () => {
  it("buffers warn/error even when debug is off", async () => {
    const lines: string[] = [];
    const logger = new DebugLogger({
      enabled: false,
      sink: {
        append: (l) => {
          lines.push(l);
        },
      },
    });
    logger.info("test", "should skip");
    logger.error("test", "boom", { code: 1 });
    assert.equal(logger.getEntries().length, 1);
    assert.equal(logger.getEntries()[0].level, "error");
    assert.equal(lines.length, 0);
  });

  it("writes to sink when enabled", async () => {
    const lines: string[] = [];
    const logger = new DebugLogger({
      enabled: true,
      sink: {
        append: (l) => {
          lines.push(l);
        },
      },
    });
    logger.info("ssh", "connect ok");
    await Promise.resolve();
    assert.ok(lines.some((l) => l.includes("connect ok")));
    assert.match(logger.exportText(), /connect ok/);
  });
});

describe("stage0 / help", () => {
  it("has control helps for primary navigation actions", () => {
    assert.equal(getControlHelp("nav.fleet")?.title, "Флот");
    assert.match(getControlHelp("session.dashboard")?.body ?? "", /8080/);
    assert.ok(HELP_ARTICLES.length >= 4);
    assert.ok(getControlHelp("modules.nats"));
  });
});

describe("stage0 / nats subjects", () => {
  it("exposes DrinkX bus subjects", () => {
    assert.equal(NATS_SUBJECTS.muster, "coffeemachine.muster");
    assert.equal(NATS_SUBJECTS.status, "coffeemachine.status");
  });
});

describe("stage0 / param-hints", () => {
  it("explains currentTreshold rule dry-0.01", () => {
    const hint = getParamHint("refill.currentTreshold");
    assert.match(hint?.summary ?? "", /0\.01/);
    assert.equal(suggestCurrentThresholdFromDry(0.4745), 0.464);
  });

  it("marks flowrateThreshold as unused in cm-drv", () => {
    const hint = getParamHint("pid.flowrateThreshold");
    assert.match(hint?.warnings?.[0] ?? "", /не влияет|не использует/i);
  });
});
