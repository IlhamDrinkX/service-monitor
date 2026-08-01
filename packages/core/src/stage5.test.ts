/**
 * Stage 5: module device helpers / subjects.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractEnabledState,
  extractTempMap,
  extractWaterPressure,
  extractWaterTotalPulses,
  extractPumpCurrent,
  extractPumpPowerPercent,
  extractHeaterStatus,
  estimateHeaterPwmPercent,
  extractOpenValveNumbers,
  mergeOpenValveNumbers,
  milkSystemValveId,
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

  it("extracts water pressure from typed sensor", () => {
    assert.equal(
      extractWaterPressure({
        sensors: [
          { name: "water_water_pressure", type: "pressure", value: 1.85 },
          { name: "water_total_pulses", type: "counter", value: 10 },
        ],
      }),
      1.85
    );
  });

  it("extracts pump power percent from pumps.status", () => {
    assert.equal(extractPumpPowerPercent({ power: 80, enabled: true }), 80);
    assert.equal(
      extractPumpPowerPercent({ result: { power: 255, enabled: true } }),
      100
    );
    // ERP reverse → negative speed/power; UI shows magnitude %
    assert.equal(extractPumpPowerPercent({ power: -40, enabled: true }), 40);
    assert.equal(extractPumpPowerPercent({ power: -200 }), 78);
    assert.equal(extractPumpPowerPercent({}), null);
  });

  it("extracts heater status and estimates PWM (not from stale DX graph)", () => {
    const snap = extractHeaterStatus({
      success: true,
      enabled: true,
      target: 60,
      temperature: 40,
      mode: "manual",
    });
    assert.equal(snap.enabled, true);
    assert.equal(snap.target, 60);
    assert.equal(snap.temperature, 40);
    assert.equal(estimateHeaterPwmPercent(true, 60, 40), 30);
    assert.equal(estimateHeaterPwmPercent(false, 60, 40), 0);
    assert.equal(estimateHeaterPwmPercent(true, 50, 55), 0);
    assert.equal(estimateHeaterPwmPercent(true, 80, 20), 75);
  });

  it("maps milk-system open valve numbers to UI 1..6", () => {
    // явный 0-based (есть 0) → +1
    assert.deepEqual(mergeOpenValveNumbers([0, 2], [5]), [1, 3, 6]);
    // ERP milk-1..N / bus без нуля: [1] остаётся клапаном 1 (не 2)
    assert.deepEqual(mergeOpenValveNumbers([1]), [1]);
    assert.deepEqual(mergeOpenValveNumbers([1, 3]), [1, 3]);
    assert.deepEqual(
      extractOpenValveNumbers({
        format: "drinkx-1.0",
        milkValves: [0, 1],
        coffeeValves: [],
      }),
      [0, 1]
    );
    assert.equal(milkSystemValveId(3), "msValve3");
  });

  it("extracts pump current via deep search", () => {
    assert.equal(
      extractPumpCurrent({
        result: { temps: { pump_R_IS: 1.23, input: 20 } },
      }),
      1.23
    );
  });
});
