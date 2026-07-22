/**
 * Smoke: shared core browser export + bridge contract surface.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  NATS_SUBJECTS,
  MODULE_VALVES,
  defaultHwid,
  DRINKX_HOSTS,
} from "@service-monitor/core/browser";
import { BRIDGE_METHOD_NAMES } from "./bridge-contract.ts";

describe("android stub / core browser", () => {
  it("exposes DrinkX subjects and valves", () => {
    assert.equal(NATS_SUBJECTS.muster, "coffeemachine.muster");
    assert.ok(MODULE_VALVES.milk.includes("drain"));
    assert.equal(defaultHwid("water"), "dx.water");
    assert.deepEqual([...DRINKX_HOSTS], ["milk", "coffee", "water"]);
  });

  it("lists native bridge methods", () => {
    assert.ok(BRIDGE_METHOD_NAMES.includes("natsConnect"));
    assert.ok(BRIDGE_METHOD_NAMES.includes("flashPartA"));
  });
});
