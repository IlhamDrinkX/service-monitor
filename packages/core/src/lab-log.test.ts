/**
 * Lab event log helpers.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createLabEvent,
  formatLabTerminalLine,
  labEventsToCsv,
  sensorSeries,
  booleanStepSeries,
  pumpPowerSeries,
  chartSeriesMeta,
  chartSinceMs,
  seriesKey,
  parseSeriesKey,
  snapshotAt,
  complexSensorCatalog,
} from "./index.js";

describe("lab-log", () => {
  it("formats terminal line and csv", () => {
    const e = createLabEvent({
      kind: "valve",
      module: "milk",
      hwid: "dx.milk",
      name: "drain",
      value: true,
      detail: "open",
      at: "2026-07-31T12:00:00.000Z",
    });
    assert.match(formatLabTerminalLine(e), /milk\/valve drain=true/);
    const csv = labEventsToCsv([e]);
    assert.match(csv, /^at,kind,module/);
    assert.match(csv, /valve,milk,dx\.milk,drain,true,open/);
  });

  it("builds namespaced sensor series", () => {
    const events = [
      createLabEvent({
        kind: "sensor",
        module: "milk",
        hwid: "dx.milk",
        name: "input",
        value: 20,
        at: "2026-07-31T12:00:00.000Z",
      }),
      createLabEvent({
        kind: "sensor",
        module: "coffee",
        hwid: "dx.coffee",
        name: "input",
        value: 30,
        at: "2026-07-31T12:00:05.000Z",
      }),
      createLabEvent({
        kind: "sensor",
        module: "milk",
        hwid: "dx.milk",
        name: "input",
        value: 21.5,
        at: "2026-07-31T12:00:05.000Z",
      }),
    ];
    const milk = sensorSeries(events, seriesKey("milk", "input"));
    assert.equal(milk.length, 2);
    assert.equal(milk[1]!.v, 21.5);
    const coffee = sensorSeries(events, "coffee.input");
    assert.equal(coffee.length, 1);
    assert.equal(coffee[0]!.v, 30);
  });

  it("builds boolean step and pump power series", () => {
    const events = [
      createLabEvent({
        kind: "valve",
        module: "water",
        hwid: "dx.water",
        name: "drain",
        value: true,
        at: "2026-07-31T12:00:00.000Z",
      }),
      createLabEvent({
        kind: "valve",
        module: "water",
        hwid: "dx.water",
        name: "drain",
        value: false,
        at: "2026-07-31T12:00:10.000Z",
      }),
      createLabEvent({
        kind: "pump",
        module: "water",
        hwid: "dx.water",
        name: "pump",
        value: true,
        detail: "power%=80 pwm=204 ms=3000",
        at: "2026-07-31T12:00:01.000Z",
      }),
      createLabEvent({
        kind: "pump",
        module: "water",
        hwid: "dx.water",
        name: "pump",
        value: false,
        detail: "stop",
        at: "2026-07-31T12:00:04.000Z",
      }),
    ];
    const steps = booleanStepSeries(events, "valve", "water.drain");
    assert.ok(steps.length >= 3);
    assert.equal(steps[0]!.v, 1);
    assert.equal(steps.at(-1)!.v, 0);
    const power = pumpPowerSeries(events, null, 200, "water");
    assert.equal(power[0]!.v, 80);
    assert.equal(power.at(-1)!.v, 0);
  });

  it("chart meta, keys, snapshot, catalog", () => {
    assert.equal(seriesKey("milk", "input"), "milk.input");
    assert.deepEqual(parseSeriesKey("milk.pumpCurrent"), {
      module: "milk",
      name: "pumpCurrent",
    });
    assert.equal(chartSeriesMeta("milk.waterPressure").unit, "bar");
    assert.match(chartSeriesMeta("coffee.pumpCurrent").label, /coffee/);
    assert.equal(chartSeriesMeta("pumpCurrent").unit, "A");
    assert.equal(chartSinceMs("all"), null);
    assert.ok(complexSensorCatalog().includes("milk.pumpCurrent"));

    const events = [
      createLabEvent({
        kind: "sensor",
        module: "milk",
        hwid: "dx.milk",
        name: "input",
        value: 22,
        at: "2026-07-31T12:00:00.000Z",
      }),
      createLabEvent({
        kind: "valve",
        module: "milk",
        hwid: "dx.milk",
        name: "drain",
        value: true,
        at: "2026-07-31T12:00:01.000Z",
      }),
      createLabEvent({
        kind: "sensor",
        module: "milk",
        hwid: "dx.milk",
        name: "input",
        value: 25,
        at: "2026-07-31T12:00:10.000Z",
      }),
    ];
    const snap = snapshotAt(events, Date.parse("2026-07-31T12:00:05.000Z"));
    const input = snap.find((r) => r.key === "milk.input");
    assert.equal(input?.value, 22);
    const drain = snap.find((r) => r.key === "milk.drain");
    assert.equal(drain?.value, true);
  });
});
