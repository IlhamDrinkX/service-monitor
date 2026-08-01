/**
 * Semantic chart layout.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  layoutModuleChartKeys,
  moduleChartColumns,
  seriesKey,
} from "./index.js";

describe("chart-layout", () => {
  it("places R/L_IS in col3, input/power in col4, pwm on row3", () => {
    const keys = [
      seriesKey("milk", "input"),
      seriesKey("milk", "heater1_out"),
      seriesKey("milk", "heater2_out"),
      seriesKey("milk", "heater1_overheat"),
      seriesKey("milk", "heater2_overheat"),
      seriesKey("milk", "pumpCurrent"),
      seriesKey("milk", "pumpCurrentL"),
      seriesKey("milk", "pumpPower"),
      seriesKey("milk", "heater1_pwm"),
      seriesKey("milk", "heater2_pwm"),
    ];
    const { slots, rest } = layoutModuleChartKeys("milk", keys);
    assert.equal(moduleChartColumns("milk"), 4);
    // row1
    assert.equal(slots[0], "milk.heater1_overheat");
    assert.equal(slots[1], "milk.heater2_overheat");
    assert.equal(slots[2], "milk.pumpCurrent");
    assert.equal(slots[3], "milk.input");
    // row2
    assert.equal(slots[4], "milk.heater1_out");
    assert.equal(slots[5], "milk.heater2_out");
    assert.equal(slots[6], "milk.pumpCurrentL");
    assert.equal(slots[7], "milk.pumpPower");
    // row3
    assert.equal(slots[8], "milk.heater1_pwm");
    assert.equal(slots[9], "milk.heater2_pwm");
    assert.equal(rest.length, 0);
  });

  it("lays out water in 3 columns", () => {
    const { slots } = layoutModuleChartKeys("water", [
      seriesKey("water", "waterTotalPulses"),
      seriesKey("water", "input"),
      seriesKey("water", "waterPressure"),
    ]);
    assert.equal(moduleChartColumns("water"), 3);
    assert.deepEqual(slots, [
      "water.input",
      "water.waterPressure",
      "water.waterTotalPulses",
    ]);
  });
});
