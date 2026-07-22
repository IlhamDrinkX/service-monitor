/**
 * Stage 5: module device helpers / subjects.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractEnabledState,
  extractTempMap,
  extractWaterTotalPulses,
  pumpPowerToPwm,
  valveCommandSubject,
  defaultHwid,
} from "./index.js";

describe("stage5 / module-devices", () => {
  it("builds valve command subjects", () => {
    assert.equal(
      valveCommandSubject("milk", "drain", true),
      "valves.milk-drain!"
    );
    assert.equal(
      valveCommandSubject("milk", "drain", false),
      "valves.stop.milk-drain!"
    );
    assert.equal(defaultHwid("coffee"), "dx.coffee");
  });

  it("maps pump UI power to PWM", () => {
    assert.equal(pumpPowerToPwm(100), 255);
    assert.equal(pumpPowerToPwm(0), 0);
  });

  it("extracts enabled and temps from status shapes", () => {
    assert.equal(extractEnabledState({ enabled: true }), true);
    assert.equal(extractEnabledState({ result: { enabled: false } }), false);
    const temps = extractTempMap(
      {
        sensors: [
          { name: "milk_input", type: "temp", value: 22.5 },
          { name: "heater1_out", type: "temp", value: 44 },
        ],
      },
      "milk"
    );
    assert.equal(temps.input, 22.5);
    assert.equal(temps.heater1_out, 44);
  });

  it("extracts water total pulses", () => {
    assert.equal(
      extractWaterTotalPulses({
        sensors: [{ name: "water_total_pulses", value: 1234 }],
      }),
      1234
    );
  });
});
