/**
 * Heater warmup helpers (#12).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  HEATER_WARMUP_DEFAULTS,
  warmupOverheatKey,
  warmupSensorKey,
} from "./index.js";

describe("heater-warmup", () => {
  it("defaults match Modules Lab profile", () => {
    assert.equal(HEATER_WARMUP_DEFAULTS.targetC, 50);
    assert.equal(HEATER_WARMUP_DEFAULTS.maxOutC, 70);
    assert.equal(HEATER_WARMUP_DEFAULTS.staggerMs, 1500);
    assert.equal(HEATER_WARMUP_DEFAULTS.timeoutMs, 90_000);
    assert.deepEqual([...HEATER_WARMUP_DEFAULTS.order], ["heater1", "heater2"]);
  });

  it("warmupSensorKey / overheatKey map heaters", () => {
    assert.equal(warmupSensorKey("heater1"), "heater1_out");
    assert.equal(warmupSensorKey("heater2"), "heater2_out");
    assert.equal(warmupSensorKey("heater3"), null);
    assert.equal(warmupOverheatKey("heater1"), "heater1_overheat");
    assert.equal(warmupOverheatKey("heater2"), "heater2_overheat");
    assert.equal(warmupOverheatKey("x"), null);
  });
});
