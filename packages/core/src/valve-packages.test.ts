/**
 * Valve package step expansion.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getValvePackage, VALVE_PACKAGES } from "./index.js";

describe("valve-packages", () => {
  it("sequential_cycle: milk 12 steps, water 6", () => {
    const pkg = getValvePackage("sequential_cycle");
    assert.ok(pkg);
    assert.equal(pkg.stepsFor("milk").length, 12);
    assert.equal(pkg.stepsFor("water").length, 6);
  });

  it("all_open_hold_close: open all then close all", () => {
    const pkg = getValvePackage("all_open_hold_close");
    assert.ok(pkg);
    const milk = pkg.stepsFor("milk");
    assert.equal(milk.length, 12);
    assert.equal(milk.filter((s) => s.enabled).length, 6);
    assert.equal(milk.filter((s) => !s.enabled).length, 6);
    const lastOpen = milk.filter((s) => s.enabled).at(-1);
    assert.equal(lastOpen?.holdMs, 2000);
  });

  it("inputs_only skips non-input valves", () => {
    const pkg = getValvePackage("inputs_only");
    assert.ok(pkg);
    const milk = pkg.stepsFor("milk");
    assert.equal(milk.length, 4);
    assert.ok(milk.every((s) => s.valveId === "milkInput" || s.valveId === "waterInput"));
    const water = pkg.stepsFor("water");
    assert.equal(water.length, 2);
    assert.ok(water.every((s) => s.valveId === "milkInput"));
  });

  it("exports three presets", () => {
    assert.equal(VALVE_PACKAGES.length, 3);
  });
});
