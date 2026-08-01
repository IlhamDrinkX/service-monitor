/**
 * DX UI HTML → pump_R/L_IS + heater PWM.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseDxUiStatHtml,
  extractPumpRisFromDxStat,
  extractPumpRisFromDxHtml,
  parseDxUiSnapshot,
  extractJsonArrayAfter,
  dxUiSnapshotHasData,
} from "./nats/dx-ui-stat.js";

describe("dx-ui-stat", () => {
  it("parses stat JSON from DX UI html", () => {
    const html = `<html><body><div>${JSON.stringify({
      milk_input: 12.3,
      pump_R_IS: 0.45,
      pump_L_IS: 0.12,
      heater1_out: 40,
    })}</div><canvas></canvas><script>let data = [[1,0,50,40,20,30,75,60,55,22,31,40,0.45,0.12,1.2]];</script></body></html>`;
    const stat = parseDxUiStatHtml(html);
    assert.ok(stat);
    assert.equal(stat!.pump_R_IS, 0.45);
    assert.equal(extractPumpRisFromDxStat(stat), 0.45);
    assert.equal(extractPumpRisFromDxHtml(html), 0.45);
    const snap = parseDxUiSnapshot(html);
    assert.equal(snap.pump_R_IS, 0.45);
    assert.equal(snap.pump_L_IS, 0.12);
    assert.equal(snap.heater1_pwm, 75);
    assert.equal(snap.heater2_pwm, 40);
    assert.equal(dxUiSnapshotHasData(snap), true);
  });

  it("extracts pump_R_IS via regex even if JSON parse fails", () => {
    const html = `<div>broken { "pump_R_IS": 1.25, </div>`;
    assert.equal(extractPumpRisFromDxHtml(html), 1.25);
  });

  it("extractJsonArrayAfter uses bracket balance (nested arrays)", () => {
    const html = `let data = [[1,[2,3]],[4,5,6,7,8,9,10,11,12,13,14,15,0.9,0.1,1]];`;
    const data = extractJsonArrayAfter(html, "let data =");
    assert.ok(Array.isArray(data));
    assert.equal((data as unknown[]).length, 2);
    const snap = parseDxUiSnapshot(
      `<div>{"pump_R_IS":0.9}</div><script>${html}</script>`
    );
    assert.equal(snap.heater1_pwm, 10);
    assert.equal(snap.heater2_pwm, 15);
  });

  it("returns null on garbage", () => {
    assert.equal(parseDxUiStatHtml("<html></html>"), null);
    assert.equal(extractPumpRisFromDxStat(null), null);
    assert.equal(extractPumpRisFromDxHtml("<html></html>"), null);
    assert.equal(dxUiSnapshotHasData(parseDxUiSnapshot("")), false);
  });
});
