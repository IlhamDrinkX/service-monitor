/**
 * Complex status tuple parsing.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseComplexStatusTuple,
  complexTupleSummary,
  extractOpenValveNumbers,
  mergeOpenValveNumbers,
  applyLabStatusReplies,
  emptyLabSnapshot,
} from "./index.js";

describe("complex-status", () => {
  it("parses facade aggregate into three hosts", () => {
    const tuple = parseComplexStatusTuple([
      {
        format: "drinkx-1.0",
        milkSensors: [
          { name: "milk_input", type: "temp", value: 21 },
          { name: "milk_heater1_out", type: "temp", value: 40 },
        ],
        coffeeSensors: [
          { name: "coffee_input", type: "temp", value: 22 },
        ],
        waterSensors: [
          { name: "water_input", type: "temp", value: 19 },
          { name: "water_water_pressure", type: "pressure", value: 1.5 },
          { name: "water_total_pulses", type: "counter", value: 99 },
        ],
      },
    ]);
    assert.equal(tuple.replies, 1);
    assert.ok(tuple.hosts.milk.sensorCount >= 2);
    assert.ok(tuple.hosts.coffee.sensorCount >= 1);
    assert.ok(tuple.hosts.water.sensorCount >= 2);
    assert.equal(tuple.hosts.water.waterPressure, 1.5);
    assert.match(complexTupleSummary(tuple), /milk:/);
  });

  it("facade {hwid:dx} milkSensors + milkValves [] → temps filled, fridge all OFF", () => {
    const facade = {
      format: "drinkx-1.0",
      hwid: "dx",
      milkSensors: [
        { name: "milk_input", type: "temp", value: 6.2 },
        { name: "milk_heater1_out", type: "temp", value: 55 },
      ],
      coffeeSensors: [{ name: "coffee_input", type: "temp", value: 24 }],
      waterSensors: [{ name: "water_input", type: "temp", value: 18 }],
      milkValves: [] as number[],
      coffeeValves: [] as number[],
      waterValves: [] as number[],
    };
    const tuple = parseComplexStatusTuple([facade]);
    assert.equal(tuple.hosts.milk.temps.input, 6.2);
    assert.equal(tuple.hosts.coffee.temps.input, 24);
    assert.equal(tuple.hosts.water.temps.input, 18);
    assert.equal(tuple.hosts.milk.source, "facade");
    // Explicit [] = all closed (not null/yellow unknown)
    assert.deepEqual(extractOpenValveNumbers(facade), []);
    assert.deepEqual(mergeOpenValveNumbers([]), []);

    const snap = applyLabStatusReplies(emptyLabSnapshot(), [facade], 100);
    assert.deepEqual(snap.milkSystemOpen?.value, []);
    assert.notEqual(snap.milkSystemOpen, null);
  });

  it("merges module replies by hwid", () => {
    const tuple = parseComplexStatusTuple([
      {
        hwid: "dx.milk",
        sensors: [{ name: "milk_input", type: "temp", value: 18 }],
      },
      {
        hwid: "dx.coffee",
        sensors: [{ name: "coffee_input", type: "temp", value: 25 }],
      },
    ]);
    assert.equal(tuple.hosts.milk.temps.input, 18);
    assert.equal(tuple.hosts.coffee.temps.input, 25);
  });

  it("attributes module reply by sensor name prefix without hwid", () => {
    const tuple = parseComplexStatusTuple([
      {
        success: true,
        result: {
          sensors: [
            { name: "coffee_input", type: "temp", value: 33 },
            { name: "coffee_heater1_out", type: "temp", value: 41 },
          ],
        },
      },
      {
        success: true,
        result: {
          sensors: [
            { name: "water_input", type: "temp", value: 17 },
            { name: "water_water_pressure", type: "pressure", value: 1.2 },
          ],
        },
      },
    ]);
    assert.equal(tuple.hosts.milk.sensorCount, 0);
    assert.equal(tuple.hosts.coffee.temps.input, 33);
    assert.equal(tuple.hosts.water.temps.input, 17);
    assert.equal(tuple.hosts.water.waterPressure, 1.2);
  });
});
