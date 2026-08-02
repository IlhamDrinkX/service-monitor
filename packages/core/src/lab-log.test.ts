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
  extendSeriesEnd,
  SENSOR_SERIES_HOLD_MS,
  isDxSensorLocalName,
  chartSeriesMeta,
  chartSinceMs,
  seriesKey,
  parseSeriesKey,
  snapshotAt,
  complexSensorCatalog,
  LAB_EVENTS_MAX,
  LAB_EVENTS_CHART_SYNC_MAX,
  LAB_EVENTS_CHART_WINDOW_MAX,
  trimLabEvents,
  trimLabEventsForChartSync,
  mergeLabChartSyncEvents,
  maxLabEventAtMs,
  seriesHasDrawablePoints,
  seriesYDomain,
  seriesPathD,
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

    // ON до окна since не теряется; линия тянется до now
    const held = booleanStepSeries(
      [
        createLabEvent({
          kind: "valve",
          module: "milk",
          hwid: "dx.milk",
          name: "air",
          value: true,
          at: "2026-07-31T11:00:00.000Z",
        }),
      ],
      "valve",
      "milk.air",
      Date.parse("2026-07-31T12:00:00.000Z"),
      400,
      Date.parse("2026-07-31T12:05:00.000Z")
    );
    assert.equal(held[0]!.v, 1);
    assert.equal(held[0]!.t, Date.parse("2026-07-31T12:00:00.000Z"));
    assert.equal(held.at(-1)!.v, 1);
    assert.equal(held.at(-1)!.t, Date.parse("2026-07-31T12:05:00.000Z"));
  });

  it("booleanStepSeries late pump ON starts at event time (not whole window)", () => {
    const since = Date.parse("2026-07-31T12:00:00.000Z");
    const onAt = Date.parse("2026-07-31T12:04:00.000Z");
    const now = Date.parse("2026-07-31T12:05:00.000Z");
    const steps = booleanStepSeries(
      [
        createLabEvent({
          kind: "pump",
          module: "milk",
          hwid: "dx.milk",
          name: "pump",
          value: true,
          at: new Date(onAt).toISOString(),
        }),
      ],
      "pump",
      "milk.pump",
      since,
      400,
      now
    );
    assert.ok(steps.length >= 2);
    assert.equal(steps[0]!.t, onAt, "must not invent ON at window start");
    assert.equal(steps[0]!.v, 1);
    assert.ok(
      steps.every((p) => p.t >= onAt),
      "no domain fill before the ON sample"
    );
    assert.equal(steps.at(-1)!.t, now);
    assert.equal(steps.at(-1)!.v, 1);

    // Prior OFF before window → OFF at since, then step ON at onAt
    const withBaseline = booleanStepSeries(
      [
        createLabEvent({
          kind: "pump",
          module: "coffee",
          hwid: "dx.coffee",
          name: "pump",
          value: false,
          at: "2026-07-31T11:59:00.000Z",
        }),
        createLabEvent({
          kind: "pump",
          module: "coffee",
          hwid: "dx.coffee",
          name: "pump",
          value: true,
          at: new Date(onAt).toISOString(),
        }),
      ],
      "pump",
      "coffee.pump",
      since,
      400,
      now
    );
    assert.equal(withBaseline[0]!.t, since);
    assert.equal(withBaseline[0]!.v, 0);
    const firstOn = withBaseline.find((p) => p.v === 1);
    assert.ok(firstOn);
    assert.equal(firstOn!.t, onAt);
  });

  it("sensorSeries short-holds then gaps at window end (no last-known flatline)", () => {
    const events = [
      createLabEvent({
        kind: "sensor",
        module: "milk",
        hwid: "dx.milk",
        name: "input",
        value: 20,
        at: "2026-07-31T11:59:00.000Z",
      }),
      createLabEvent({
        kind: "sensor",
        module: "milk",
        hwid: "dx.milk",
        name: "input",
        value: 22,
        at: "2026-07-31T12:01:00.000Z",
      }),
    ];
    const since = Date.parse("2026-07-31T12:00:00.000Z");
    const until = Date.parse("2026-07-31T12:05:00.000Z");
    const pts = sensorSeries(events, "milk.input", 2000, since, until);
    assert.equal(pts[0]!.t, since);
    assert.equal(pts[0]!.v, 20);
    const lastFinite = [...pts].reverse().find((p) => p.v != null);
    assert.equal(lastFinite?.v, 22);
    assert.ok(
      lastFinite!.t <= Date.parse("2026-07-31T12:01:00.000Z") + SENSOR_SERIES_HOLD_MS
    );
    assert.equal(pts.at(-1)!.t, until);
    assert.equal(pts.at(-1)!.v, null, "stale tail must be gap, not last reading");
  });

  it("sensorSeries keeps continuous hold when samples stay fresh", () => {
    const t0 = Date.parse("2026-07-31T12:00:00.000Z");
    const events = [
      createLabEvent({
        kind: "sensor",
        module: "milk",
        hwid: "dx.milk",
        name: "input",
        value: 21,
        at: new Date(t0).toISOString(),
      }),
      createLabEvent({
        kind: "sensor",
        module: "milk",
        hwid: "dx.milk",
        name: "input",
        value: 22,
        at: new Date(t0 + 3_000).toISOString(),
      }),
    ];
    const until = t0 + 5_000;
    const pts = sensorSeries(events, "milk.input", 2000, t0, until);
    assert.equal(pts.at(-1)!.t, until);
    assert.equal(pts.at(-1)!.v, 22);
  });

  it("sensorSeries breaks on explicit null gap events", () => {
    const events = [
      createLabEvent({
        kind: "sensor",
        module: "milk",
        hwid: "dx.milk",
        name: "input",
        value: 25,
        at: "2026-07-31T12:00:00.000Z",
      }),
      createLabEvent({
        kind: "sensor",
        module: "milk",
        hwid: "dx.milk",
        name: "input",
        value: null,
        detail: "nats gap",
        at: "2026-07-31T12:00:05.000Z",
      }),
      createLabEvent({
        kind: "sensor",
        module: "milk",
        hwid: "dx.milk",
        name: "input",
        value: 26,
        at: "2026-07-31T12:00:10.000Z",
      }),
    ];
    const pts = sensorSeries(events, "milk.input");
    assert.ok(pts.some((p) => p.v === null));
    assert.equal(pts[0]!.v, 25);
    assert.equal(pts.at(-1)!.v, 26);
  });

  it("extendSeriesEnd and DX sensor name helpers", () => {
    assert.equal(isDxSensorLocalName("pumpCurrent"), true);
    assert.equal(isDxSensorLocalName("pumpCurrentL"), true);
    assert.equal(isDxSensorLocalName("input"), false);
    const pts = extendSeriesEnd([{ t: 1000, v: 5 }], 1000 + SENSOR_SERIES_HOLD_MS + 5_000);
    assert.equal(pts.at(-1)!.v, null);
    assert.equal(pts.at(-1)!.t, 1000 + SENSOR_SERIES_HOLD_MS + 5_000);
  });

  it("chart meta, keys, snapshot, catalog", () => {
    assert.equal(seriesKey("milk", "input"), "milk.input");
    assert.deepEqual(parseSeriesKey("milk.pumpCurrent"), {
      module: "milk",
      name: "pumpCurrent",
    });
    assert.equal(chartSeriesMeta("milk.waterPressure").unit, "bar");
    assert.match(chartSeriesMeta("coffee.pumpCurrent").label, /coffee/);
    assert.equal(chartSeriesMeta("pumpCurrent").unit, "V");
    assert.equal(chartSinceMs("all"), null);
    assert.ok(complexSensorCatalog().includes("milk.pumpCurrent"));
    assert.ok(complexSensorCatalog().includes("water.heater1_pwm"));
    assert.ok(complexSensorCatalog().includes("water.heater2_pwm"));

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

  it("trims lab event ring buffer and chart sync prefers actuators", () => {
    assert.ok(LAB_EVENTS_MAX >= 750_000, "default cap must cover ≥12h telemetry");
    assert.ok(
      LAB_EVENTS_CHART_SYNC_MAX >= 60_000,
      "chart IPC sync must cover ≥~30 min at dual-poll rates (~33 evt/s)"
    );
    assert.ok(
      LAB_EVENTS_CHART_SYNC_MAX <= 120_000,
      "chart IPC sync must stay far below the ring buffer"
    );
    assert.ok(LAB_EVENTS_CHART_WINDOW_MAX > LAB_EVENTS_CHART_SYNC_MAX);
    assert.ok(LAB_EVENTS_CHART_WINDOW_MAX < LAB_EVENTS_MAX);
    assert.ok(LAB_EVENTS_CHART_SYNC_MAX < LAB_EVENTS_MAX);
    // Dual-poll ~33 evt/s → old 30k cap ≈ 15 min; raised sync must exceed that.
    const dualPollEvtPerSec = 33;
    const oldCapMinutes = 30_000 / dualPollEvtPerSec / 60;
    assert.ok(oldCapMinutes < 16, "documents the ~15 min freeze at 30k/33eps");
    assert.ok(
      LAB_EVENTS_CHART_SYNC_MAX / dualPollEvtPerSec / 60 >= 25,
      "sync slice ≥~25 min @ 33 evt/s"
    );
    const many = Array.from({ length: 5 }, (_, i) => i);
    assert.deepEqual(trimLabEvents(many, 3), [2, 3, 4]);
    assert.deepEqual(trimLabEvents(many, 10), many);
    assert.deepEqual(trimLabEvents(many, 0), []);

    const events = [
      createLabEvent({
        kind: "sensor",
        module: "milk",
        hwid: "dx.milk",
        name: "input",
        value: 1,
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
        value: 2,
        at: "2026-07-31T12:00:02.000Z",
      }),
      createLabEvent({
        kind: "pump",
        module: "milk",
        hwid: "dx.milk",
        name: "pump",
        value: false,
        at: "2026-07-31T12:00:03.000Z",
      }),
      createLabEvent({
        kind: "sensor",
        module: "milk",
        hwid: "dx.milk",
        name: "input",
        value: 3,
        at: "2026-07-31T12:00:04.000Z",
      }),
    ];
    // max=3, reserve=2 → keep last 2 actuators + 1 newest sensor
    const sync = trimLabEventsForChartSync(events, 3, 2);
    assert.equal(sync.length, 3);
    assert.ok(sync.some((e) => e.kind === "valve"));
    assert.ok(sync.some((e) => e.kind === "pump"));
    assert.ok(sync.some((e) => e.kind === "sensor" && e.value === 3));
    assert.ok(Date.parse(sync[0]!.at) <= Date.parse(sync[1]!.at));

    // Default sync must keep sensors (not let actuator reserve eat the whole budget).
    const defaultSync = trimLabEventsForChartSync(events);
    assert.ok(defaultSync.some((e) => e.kind === "sensor"));

    // Huge ring: trim still returns ≤ max and prefers newest sensors.
    const huge = Array.from({ length: 5_000 }, (_, i) =>
      createLabEvent({
        kind: "sensor",
        module: "milk",
        hwid: "dx.milk",
        name: "input",
        value: i,
        at: new Date(Date.parse("2026-07-31T12:00:00.000Z") + i * 1000).toISOString(),
      })
    );
    const trimmedHuge = trimLabEventsForChartSync(huge, 100, 10);
    assert.ok(trimmedHuge.length <= 100);
    assert.equal(trimmedHuge[trimmedHuge.length - 1]!.value, 4999);
  });

  it("mergeLabChartSyncEvents appends past sliding sync window", () => {
    const t0 = Date.parse("2026-07-31T12:00:00.000Z");
    const mk = (i: number) =>
      createLabEvent({
        kind: "sensor",
        module: "milk",
        hwid: "dx.milk",
        name: "input",
        value: i,
        at: new Date(t0 + i * 1000).toISOString(),
      });
    // First sync slice: events 0..4
    const slice1 = [0, 1, 2, 3, 4].map(mk);
    let local = mergeLabChartSyncEvents([], slice1, 10);
    assert.equal(local.length, 5);
    // Sliding sync of size 5 moved to 3..7 — merge must grow past sync cap
    const slice2 = [3, 4, 5, 6, 7].map(mk);
    local = mergeLabChartSyncEvents(local, slice2, 10);
    assert.deepEqual(
      local.map((e) => e.value),
      [0, 1, 2, 3, 4, 5, 6, 7]
    );
    // Duplicate sync — no growth
    local = mergeLabChartSyncEvents(local, slice2, 10);
    assert.equal(local.length, 8);
    // Local ring trim
    const slice3 = [8, 9, 10, 11].map(mk);
    local = mergeLabChartSyncEvents(local, slice3, 10);
    assert.equal(local.length, 10);
    assert.equal(local[0]!.value, 2);
    assert.equal(local[local.length - 1]!.value, 11);
    // Empty incoming = clear
    assert.deepEqual(mergeLabChartSyncEvents(local, [], 10), []);
    // Tiny incoming after large local = Modules clear
    const big = Array.from({ length: 1_200 }, (_, i) => mk(i));
    const cleared = mergeLabChartSyncEvents(big, [mk(9_999)], 10);
    assert.equal(cleared.length, 1);
    assert.equal(cleared[0]!.value, 9_999);
  });

  it("maxLabEventAtMs is stack-safe for chart window ring sizes", () => {
    const t0 = Date.parse("2026-07-31T12:00:00.000Z");
    const n = 150_000; // Math.max(...arr) throws RangeError around here
    const events = Array.from({ length: n }, (_, i) =>
      createLabEvent({
        kind: "sensor",
        module: "milk",
        hwid: "dx.milk",
        name: "input",
        value: i,
        at: new Date(t0 + i * 1000).toISOString(),
      })
    );
    assert.equal(maxLabEventAtMs(events), t0 + (n - 1) * 1000);
    assert.equal(maxLabEventAtMs([]), null);
    assert.ok(n > 130_000, "documents Math.max spread crash threshold");
  });

  it("series path/domain stay drawable across null gaps (no blank chart)", () => {
    const t0 = Date.parse("2026-07-31T12:00:00.000Z");
    const events = [
      createLabEvent({
        kind: "sensor",
        module: "milk",
        hwid: "dx.milk",
        name: "input",
        value: 20,
        at: new Date(t0).toISOString(),
      }),
      createLabEvent({
        kind: "sensor",
        module: "milk",
        hwid: "dx.milk",
        name: "input",
        value: null,
        detail: "nats gap",
        at: new Date(t0 + 4_000).toISOString(),
      }),
      createLabEvent({
        kind: "sensor",
        module: "milk",
        hwid: "dx.milk",
        name: "input",
        value: 22,
        at: new Date(t0 + 8_000).toISOString(),
      }),
    ];
    const until = t0 + 10_000;
    const pts = sensorSeries(events, "milk.input", 2000, t0, until);
    assert.ok(seriesHasDrawablePoints(pts));
    assert.ok(pts.some((p) => p.v === null));
    const domain = seriesYDomain(pts);
    assert.ok(Number.isFinite(domain.min) && Number.isFinite(domain.max));
    assert.notEqual(domain.min, domain.max);
    // all-null fallback
    assert.deepEqual(seriesYDomain([{ v: null }, { v: null }]), {
      min: 0,
      max: 1,
    });
    const d = seriesPathD(
      pts,
      (t) => t - t0,
      (v) => v
    );
    assert.match(d, /^M/);
    assert.match(d, /M/); // gap → second move after break
    assert.ok(!d.includes("null"));
    assert.ok(!d.includes("NaN"));
  });
});
