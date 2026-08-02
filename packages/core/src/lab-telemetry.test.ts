/**
 * Lab telemetry timed values / stale / status apply / hostHealth.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  timed,
  isStale,
  isTelemetryStale,
  emptyLabSnapshot,
  STALE_MS,
  LAB_ACTIVE_POLL_MS,
  LAB_OTHER_STATUS_MS,
  planLabNatsPoll,
  extractPumpPowerPercent,
  applyLabStatusReplies,
  computeNatsHostHealth,
  applyDxPumpCurrents,
  extractOpenValveNumbers,
  mergeOpenValveNumbers,
  shouldThrottleLabPoll,
  isLabPollMode,
  LAB_POLL_MODE_DEFAULT,
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

  it("planLabNatsPoll: active full; others status+actuators+pumps on interval; track off drops module", () => {
    assert.equal(LAB_ACTIVE_POLL_MS, 800);
    assert.equal(LAB_OTHER_STATUS_MS, 800);
    const allOn = () => true;
    const t0 = planLabNatsPoll({
      active: "milk",
      now: 10_000,
      lastOtherStatusAt: 10_000,
      otherStatusMs: 800,
      isTracked: allOn,
    });
    assert.deepEqual(t0.fullHosts, ["milk"]);
    assert.deepEqual(t0.statusHosts, ["milk"]);
    assert.deepEqual(t0.actuatorHosts, ["milk"]);
    assert.deepEqual(t0.pumpHosts, ["milk"]);
    assert.equal(t0.didOtherStatus, false);

    const t1 = planLabNatsPoll({
      active: "milk",
      now: 10_800,
      lastOtherStatusAt: 10_000,
      otherStatusMs: 800,
      isTracked: allOn,
    });
    assert.deepEqual(t1.fullHosts, ["milk"]);
    assert.deepEqual(t1.statusHosts, ["milk", "coffee", "water"]);
    assert.deepEqual(t1.actuatorHosts, ["milk", "coffee", "water"]);
    assert.deepEqual(t1.pumpHosts, ["milk", "coffee", "water"]);
    assert.equal(t1.didOtherStatus, true);

    const coffeeOff = (h: "milk" | "coffee" | "water") => h !== "coffee";
    const t2 = planLabNatsPoll({
      active: "milk",
      now: 20_000,
      lastOtherStatusAt: 0,
      otherStatusMs: 800,
      isTracked: coffeeOff,
    });
    assert.deepEqual(t2.fullHosts, ["milk"]);
    assert.deepEqual(t2.statusHosts, ["milk", "water"]);
    assert.deepEqual(t2.actuatorHosts, ["milk", "water"]);
    assert.deepEqual(t2.pumpHosts, ["milk", "water"]);
    assert.ok(!t2.statusHosts.includes("coffee"));
    assert.ok(!t2.actuatorHosts.includes("coffee"));
    assert.ok(!t2.pumpHosts.includes("coffee"));

    const activeOff = planLabNatsPoll({
      active: "coffee",
      now: 5_000,
      lastOtherStatusAt: 0,
      isTracked: (h) => h !== "coffee",
    });
    assert.deepEqual(activeOff.fullHosts, []);
    assert.deepEqual(activeOff.statusHosts, ["milk", "water"]);
    assert.deepEqual(activeOff.actuatorHosts, ["milk", "water"]);
    assert.deepEqual(activeOff.pumpHosts, ["milk", "water"]);
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

/** Facade status poll path: `{ hwid: "dx" }` → milkSensors/coffeeSensors/waterSensors. */
const FACADE_DX_STATUS = {
  format: "drinkx-1.0",
  hwid: "dx",
  milkSensors: [
    { name: "milk_input", type: "temp", value: 6.2 },
    { name: "milk_heater1_out", type: "temp", value: 55 },
  ],
  coffeeSensors: [{ name: "coffee_input", type: "temp", value: 24 }],
  waterSensors: [
    { name: "water_input", type: "temp", value: 18 },
    { name: "water_water_pressure", type: "pressure", value: 1.4 },
  ],
  milkValves: [] as number[],
  coffeeValves: [] as number[],
  waterValves: [] as number[],
};

describe("applyLabStatusReplies (facade {hwid:dx})", () => {
  it("fills temps from milkSensors/coffeeSensors/waterSensors", () => {
    const at = 5_000;
    const next = applyLabStatusReplies(emptyLabSnapshot(), [FACADE_DX_STATUS], at);
    assert.equal(next.complexTemps.milk?.input, 6.2);
    assert.equal(next.complexTemps.milk?.heater1_out, 55);
    assert.equal(next.complexTemps.coffee?.input, 24);
    assert.equal(next.complexTemps.water?.input, 18);
    assert.equal(next.waterPressure?.value, 1.4);
    assert.equal(next.tempsUpdatedAt, at);
  });

  it("applies extractPumpCurrent from status as nats pumpRis fallback", () => {
    const at = 7_000;
    const withRis = {
      ...FACADE_DX_STATUS,
      milkSensors: [
        ...FACADE_DX_STATUS.milkSensors,
        { name: "milk_pump_R_IS", type: "current", value: 0.42 },
      ],
    };
    const next = applyLabStatusReplies(emptyLabSnapshot(), [withRis], at);
    assert.equal(next.pumpRis.milk?.value, 0.42);
    assert.equal(next.pumpRis.milk?.source, "nats");

    const withDx = emptyLabSnapshot();
    withDx.pumpRis = { milk: timed(0.99, "dx", at - 100) };
    const keepDx = applyLabStatusReplies(withDx, [withRis], at);
    assert.equal(keepDx.pumpRis.milk?.value, 0.99);
    assert.equal(keepDx.pumpRis.milk?.source, "dx");
  });

  it("explicit milkValves [] → fridge all closed (not unknown/yellow)", () => {
    const prev = emptyLabSnapshot();
    // Simulate prior unknown (null) — yellow in UI
    assert.equal(prev.milkSystemOpen, null);

    const next = applyLabStatusReplies(prev, [FACADE_DX_STATUS], 1_000);
    assert.ok(next.milkSystemOpen, "milkSystemOpen must be set");
    assert.deepEqual(next.milkSystemOpen!.value, []);
    assert.equal(next.milkSystemOpen!.source, "nats");
    // Same contract as extract/merge used by UI lamps
    assert.deepEqual(extractOpenValveNumbers(FACADE_DX_STATUS), []);
    assert.deepEqual(mergeOpenValveNumbers([]), []);
  });

  it("respects milkSystemHoldUntil (keeps bus/cmd open list)", () => {
    const prev = {
      ...emptyLabSnapshot(),
      milkSystemOpen: timed([2, 4], "cmd", 900),
    };
    const next = applyLabStatusReplies(prev, [FACADE_DX_STATUS], 1_000, {
      milkSystemHoldUntil: 2_000,
      now: 1_500,
    });
    assert.deepEqual(next.milkSystemOpen?.value, [2, 4]);
    assert.equal(next.milkSystemOpen?.source, "cmd");
  });
});

describe("computeNatsHostHealth", () => {
  it("natsOk true when pump succeeds", () => {
    const hh = computeNatsHostHealth(
      {},
      {
        pumpOk: { milk: true, coffee: false, water: false },
        heaterOk: { milk: false, coffee: false, water: false },
        complexTemps: {},
        at: 10,
      }
    );
    assert.equal(hh.milk?.natsOk, true);
    assert.equal(hh.coffee?.natsOk, false);
    assert.equal(hh.water?.natsOk, false);
    assert.equal(hh.milk?.dxOk, null);
  });

  it("natsOk true when heater succeeds even if pump fails", () => {
    const hh = computeNatsHostHealth(
      {},
      {
        pumpOk: { coffee: false },
        heaterOk: { coffee: true },
        complexTemps: {},
        at: 10,
      }
    );
    assert.equal(hh.coffee?.natsOk, true);
  });

  it("natsOk true from temps alone (facade status filled)", () => {
    const afterStatus = applyLabStatusReplies(
      emptyLabSnapshot(),
      [FACADE_DX_STATUS],
      10
    );
    const hh = computeNatsHostHealth(
      {},
      {
        pumpOk: { milk: false, coffee: false, water: false },
        heaterOk: { milk: false, coffee: false, water: false },
        complexTemps: afterStatus.complexTemps,
        at: 10,
      }
    );
    assert.equal(hh.milk?.natsOk, true);
    assert.equal(hh.coffee?.natsOk, true);
    assert.equal(hh.water?.natsOk, true);
  });

  it("natsOk false when pump/heater fail and no temps", () => {
    const hh = computeNatsHostHealth(
      { milk: { natsOk: true, dxOk: true, updatedAt: 1 } },
      {
        pumpOk: { milk: false },
        heaterOk: { milk: false },
        complexTemps: {},
        at: 20,
      }
    );
    assert.equal(hh.milk?.natsOk, false);
    assert.equal(hh.milk?.dxOk, true, "preserves dxOk from previous");
  });

  it("keeps previous natsOk when pump/heater unset (no evidence)", () => {
    const hh = computeNatsHostHealth(
      { water: { natsOk: true, dxOk: false, updatedAt: 1 } },
      {
        pumpOk: {},
        heaterOk: {},
        complexTemps: {},
        at: 30,
      }
    );
    assert.equal(hh.water?.natsOk, true);
    assert.equal(hh.water?.dxOk, false);
  });
});

describe("applyDxPumpCurrents hostHealth.dxOk", () => {
  const emptyMod = {
    pump_R_IS: null as number | null,
    pump_L_IS: null as number | null,
  };

  it("dxOk true when R_IS present; preserves natsOk", () => {
    const base = {
      ...emptyLabSnapshot(),
      hostHealth: {
        milk: { natsOk: true, dxOk: null, updatedAt: 1 },
        coffee: { natsOk: false, dxOk: null, updatedAt: 1 },
      },
    };
    const next = applyDxPumpCurrents(
      base,
      {
        milk: { ...emptyMod, pump_R_IS: 0.42 },
        coffee: { ...emptyMod, error: "ECONNREFUSED" },
        water: { ...emptyMod, pump_R_IS: 0.11, pump_L_IS: 0.02 },
      },
      50
    );
    assert.equal(next.hostHealth.milk?.dxOk, true);
    assert.equal(next.hostHealth.milk?.natsOk, true);
    assert.equal(next.hostHealth.coffee?.dxOk, false);
    assert.equal(next.hostHealth.coffee?.natsOk, false);
    assert.equal(next.hostHealth.water?.dxOk, true);
    assert.equal(next.pumpRis.milk?.value, 0.42);
    assert.equal(next.pumpRis.water?.value, 0.11);
    assert.match(next.dxUiStatus, /DX UI ток/);
  });

  it("dxOk false on error without currents", () => {
    const next = applyDxPumpCurrents(
      emptyLabSnapshot(),
      {
        milk: { ...emptyMod, error: "timeout" },
        coffee: { ...emptyMod, error: "404" },
        water: { ...emptyMod, error: "offline" },
      },
      60
    );
    assert.equal(next.hostHealth.milk?.dxOk, false);
    assert.equal(next.hostHealth.coffee?.dxOk, false);
    assert.equal(next.hostHealth.water?.dxOk, false);
    assert.match(next.dxUiStatus, /DX UI пусто/);
  });
});

describe("shouldThrottleLabPoll (XOR laptop/onboard dense poll)", () => {
  it("dense mode never throttles, regardless of onboard state", () => {
    assert.equal(shouldThrottleLabPoll("dense", true), false);
    assert.equal(shouldThrottleLabPoll("dense", false), false);
  });

  it("reduced mode always throttles, regardless of onboard state", () => {
    assert.equal(shouldThrottleLabPoll("reduced", true), true);
    assert.equal(shouldThrottleLabPoll("reduced", false), true);
  });

  it("auto mode is the real XOR: throttles only when onboard is ready", () => {
    assert.equal(shouldThrottleLabPoll("auto", true), true);
    assert.equal(shouldThrottleLabPoll("auto", false), false);
  });

  it("LAB_POLL_MODE_DEFAULT is auto", () => {
    assert.equal(LAB_POLL_MODE_DEFAULT, "auto");
  });

  it("isLabPollMode narrows valid string values only", () => {
    assert.equal(isLabPollMode("dense"), true);
    assert.equal(isLabPollMode("auto"), true);
    assert.equal(isLabPollMode("reduced"), true);
    assert.equal(isLabPollMode("Auto"), false);
    assert.equal(isLabPollMode(""), false);
    assert.equal(isLabPollMode(null), false);
    assert.equal(isLabPollMode(undefined), false);
    assert.equal(isLabPollMode(1), false);
  });
});
