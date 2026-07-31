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

  it("builds sensor series", () => {
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
        module: "milk",
        hwid: "dx.milk",
        name: "input",
        value: 21.5,
        at: "2026-07-31T12:00:05.000Z",
      }),
    ];
    const s = sensorSeries(events, "input");
    assert.equal(s.length, 2);
    assert.equal(s[1].v, 21.5);
  });
});
