/**
 * Lab telemetry timed values / stale.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  timed,
  isStale,
  isTelemetryStale,
  emptyLabSnapshot,
  STALE_MS,
  extractPumpPowerPercent,
} from "./index.js";

describe("lab-telemetry", () => {
  it("marks stale after threshold", () => {
    const tv = timed(42, "nats", 1_000);
    assert.equal(isStale(tv, 3_000, 3_500), false);
    assert.equal(isStale(tv, 3_000, 5_000), true);
    assert.equal(isStale(null, STALE_MS.actuators, 10_000), true);
  });

  it("isTelemetryStale ignores mid-tick and pause", () => {
    assert.equal(
      isTelemetryStale(
        { lastTickAt: 1, pollInFlight: true, pollPaused: false },
        100,
        10_000
      ),
      false
    );
    assert.equal(
      isTelemetryStale(
        { lastTickAt: 1, pollInFlight: false, pollPaused: true },
        100,
        10_000
      ),
      false
    );
    assert.equal(
      isTelemetryStale(
        { lastTickAt: 1, pollInFlight: false, pollPaused: false },
        100,
        10_000
      ),
      true
    );
  });

  it("empty snapshot defaults", () => {
    const s = emptyLabSnapshot();
    assert.equal(s.tick, 0);
    assert.equal(s.pollPaused, false);
    assert.equal(s.pollInFlight, false);
    assert.deepEqual(s.errors, []);
    assert.deepEqual(s.hostHealth, {});
  });
});

describe("extractPumpPowerPercent extras", () => {
  it("reads speed and nested result", () => {
    assert.equal(extractPumpPowerPercent({ power: 80 }), 80);
    assert.equal(extractPumpPowerPercent({ speed: 80 }), 80);
    assert.equal(extractPumpPowerPercent({ result: { power: 50 } }), 50);
    assert.equal(extractPumpPowerPercent({ pwm: 255 }), 100);
  });
});
