/**
 * Pure helpers for Modules Lab (host/storage/track/scenarioHint).
 * Запуск: npm test -w @service-monitor/desktop
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it, beforeEach, afterEach } from "node:test";
import { fileURLToPath } from "node:url";
import {
  defaultHwid,
  seriesKey,
  type LabScenario,
  type NatsMusterEntry,
} from "@service-monitor/core";
import { scenarioHint } from "./components/modules/scenarioHint.ts";
import {
  filterBuiltinPayloads,
  filterCustomPayloads,
  payloadPresetHint,
  resolvePayloadSelectValue,
  subjectPresetHint,
} from "./components/modules/labTerminalHelpers.ts";
import {
  buildComplexSensorRows,
  orderSensorRows,
  sensorReadoutOffline,
  visibleSensorModules,
} from "./components/modules/complexSensorsHelpers.ts";
import { hostHealthBadgeClass } from "./components/modules/modulesLabToolbarHelpers.ts";
import { brewLabPartsFromForm } from "./components/modules/brewLabHelpers.ts";
import { isScenarioButtonDisabled } from "./components/modules/labScenariosHelpers.ts";
import { milkValveOpenNumbers } from "./components/modules/milkSystemValvesHelpers.ts";
import { isValveRowDisabled } from "./components/modules/moduleValvesHelpers.ts";
import {
  estimatePwmForHeater,
  heaterOutletSensor,
  heaterShortId,
} from "./components/modules/moduleHeatersHelpers.ts";
import { isPumpRunning } from "./components/modules/modulePumpHelpers.ts";
import {
  flushOpenValve,
  isFoamTempValid,
} from "./components/modules/moduleServiceHelpers.ts";
import {
  averageFlowFactor,
  calibPulsesDelta,
  computeStepFlowFactor,
  initialCalibRows,
  isValidPulsesDelta,
  parseActualMl,
} from "./components/modules/flowCalibrationHelpers.ts";
import {
  availableChartSensorsFromEvents,
  buildLiveActuators,
  chartSensorNamesFromEvents,
  isCriticalLabSensor,
  labSensorDelta,
  labSensorDigits,
  labSensorHeartbeatMs,
  shouldPushLabSensorSample,
} from "./lab/modulesLab/labEventLogHelpers.ts";
import {
  matchMusterHwid,
  parseValvesSwitchedNumbers,
} from "./lab/modulesLab/modulesLabNatsHelpers.ts";
import {
  milkValvesMapFromOpen,
  milkValvesMapFromOpenList,
} from "./lab/modulesLab/modulesLabTelemetryHelpers.ts";
import {
  errText,
  pickHostFromMuster,
  resolveHwid,
} from "./lab/modulesLab/modulesLabHost.ts";
import {
  LAB_TRACK_KEY,
  TERM_CUSTOM_PAYLOADS_KEY,
  TERM_CUSTOM_SUBJECTS_KEY,
  TERM_CUSTOM_SUBJECTS_LEGACY,
  currentPayloadPickId,
  defaultLabTrack,
  isModuleTracked,
  isSensorTracked,
  loadCustomPayloads,
  loadCustomSubjects,
  loadLabTrack,
  normalizeCustomSubject,
  saveCustomPayloads,
  saveCustomSubjects,
  saveLabTrack,
} from "./lab/modulesLab/modulesLabStorage.ts";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
    removeItem(key: string) {
      map.delete(key);
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
  };
}

describe("desktop / modulesLabHost", () => {
  it("resolveHwid prefers muster match over default", () => {
    const modules: NatsMusterEntry[] = [
      { hwid: "custom-milk-01", role: "milk", raw: {} },
    ];
    assert.equal(resolveHwid("milk", modules), "custom-milk-01");
    assert.equal(resolveHwid("coffee", modules), defaultHwid("coffee"));
  });

  it("resolveHwid matches by hwid substring", () => {
    const modules: NatsMusterEntry[] = [
      { hwid: "board-water-xyz", role: "unknown", raw: {} },
    ];
    assert.equal(resolveHwid("water", modules), "board-water-xyz");
  });

  it("pickHostFromMuster keeps current when online or empty", () => {
    assert.equal(pickHostFromMuster([], "milk"), "milk");
    const milkOnline: NatsMusterEntry[] = [
      { hwid: defaultHwid("milk"), role: "milk", raw: {} },
    ];
    assert.equal(pickHostFromMuster(milkOnline, "milk"), "milk");
  });

  it("pickHostFromMuster prefers coffee → water → milk when current offline", () => {
    const waterOnly: NatsMusterEntry[] = [
      { hwid: defaultHwid("water"), role: "water", raw: {} },
    ];
    assert.equal(pickHostFromMuster(waterOnly, "milk"), "water");

    const coffeeAndWater: NatsMusterEntry[] = [
      { hwid: defaultHwid("water"), role: "water", raw: {} },
      { hwid: defaultHwid("coffee"), role: "coffee", raw: {} },
    ];
    assert.equal(pickHostFromMuster(coffeeAndWater, "milk"), "coffee");
  });

  it("errText unwraps Error and stringifies other values", () => {
    assert.equal(errText(new Error("boom")), "boom");
    assert.equal(errText("plain"), "plain");
  });
});

describe("desktop / modulesLabStorage", () => {
  const prevLocal = globalThis.localStorage;
  const prevSession = globalThis.sessionStorage;

  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: memoryStorage(),
    });
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: memoryStorage(),
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: prevLocal,
    });
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: prevSession,
    });
  });

  it("labTrack roundtrip + resets when all modules off", () => {
    const track = defaultLabTrack();
    track.modules.coffee = false;
    track.sensors[seriesKey("milk", "temp")] = false;
    saveLabTrack(track);
    const loaded = loadLabTrack();
    assert.equal(loaded.modules.coffee, false);
    assert.equal(loaded.modules.milk, true);
    assert.equal(loaded.sensors[seriesKey("milk", "temp")], false);

    saveLabTrack({
      modules: { milk: false, coffee: false, water: false },
      sensors: {},
    });
    assert.deepEqual(loadLabTrack(), defaultLabTrack());
  });

  it("loadLabTrack returns default when missing or corrupt", () => {
    assert.deepEqual(loadLabTrack(), defaultLabTrack());
    sessionStorage.setItem(LAB_TRACK_KEY, "{not-json");
    assert.deepEqual(loadLabTrack(), defaultLabTrack());
  });

  it("custom subjects/payloads roundtrip + legacy key + normalize", () => {
    assert.equal(normalizeCustomSubject(null), null);
    assert.equal(normalizeCustomSubject({ subject: "  " }), null);
    assert.deepEqual(
      normalizeCustomSubject({ subject: " a.b ", payloadIds: ["p1", 2] }),
      { subject: "a.b", label: "a.b", payloadIds: ["p1"] }
    );

    saveCustomSubjects([
      { subject: "x.y", label: "XY", payloadIds: ["p1"] },
    ]);
    assert.deepEqual(loadCustomSubjects(), [
      { subject: "x.y", label: "XY", payloadIds: ["p1"] },
    ]);

    localStorage.removeItem(TERM_CUSTOM_SUBJECTS_KEY);
    localStorage.setItem(
      TERM_CUSTOM_SUBJECTS_LEGACY,
      JSON.stringify([{ subject: "legacy.s", label: "L", payloadIds: [] }])
    );
    assert.equal(loadCustomSubjects()[0]?.subject, "legacy.s");

    saveCustomPayloads([
      {
        id: "1",
        label: "P",
        description: "d",
        payloadJson: '{"a":1}',
      },
    ]);
    assert.equal(loadCustomPayloads().length, 1);
    assert.equal(loadCustomPayloads()[0]?.id, "1");
    assert.equal(loadCustomPayloads()[0]?.payloadJson, '{"a":1}');
  });

  it("currentPayloadPickId resolves builtin / custom / match-by-json", () => {
    const customs = [
      {
        id: "abc",
        label: "A",
        description: "",
        payloadJson: '{"z":1}',
      },
    ];
    assert.equal(currentPayloadPickId("custom:abc", "{}", customs), "custom:abc");
    assert.equal(currentPayloadPickId("builtin", "{}", customs), "builtin");
    assert.equal(
      currentPayloadPickId("__custom__", '{"z":1}', customs),
      "custom:abc"
    );
    assert.equal(currentPayloadPickId("__custom__", "{}", customs), null);
  });

  it("track helpers: module off gates sensors; missing key = on", () => {
    const track = defaultLabTrack();
    assert.equal(isModuleTracked(track, "milk"), true);
    assert.equal(isSensorTracked(track, "milk", "T1"), true);

    track.modules.milk = false;
    assert.equal(isModuleTracked(track, "milk"), false);
    assert.equal(isSensorTracked(track, "milk", "T1"), false);

    track.modules.milk = true;
    track.sensors[seriesKey("milk", "T1")] = false;
    assert.equal(isSensorTracked(track, "milk", "T1"), false);
    assert.equal(isSensorTracked(track, "milk", "T2"), true);
  });
});

describe("desktop / scenarioHint", () => {
  function sc(
    partial: Partial<LabScenario> & Pick<LabScenario, "id" | "subject">
  ): LabScenario {
    return {
      label: partial.label ?? partial.id,
      helpId: partial.helpId ?? "lab.scenarios",
      risk: partial.risk ?? "read",
      buildPayload: partial.buildPayload ?? (() => ({})),
      ...partial,
    };
  }

  it("returns known Russian hints and falls back to subject", () => {
    assert.match(
      scenarioHint(sc({ id: "status-module", subject: "coffeemachine.status" })),
      /безопасно/
    );
    assert.match(
      scenarioHint(sc({ id: "milkrinse-micro", subject: "x" })),
      /Micro-rinse/
    );
    assert.match(
      scenarioHint(sc({ id: "milkrinse-long", subject: "x" })),
      /tubesLength/
    );
    assert.match(scenarioHint(sc({ id: "stop-cm", subject: "x" })), /Оборвать/);
    assert.equal(
      scenarioHint(sc({ id: "other" as LabScenario["id"], subject: "foo.bar" })),
      "foo.bar"
    );
  });
});

describe("desktop / labTerminalHelpers", () => {
  it("filters payloads by linked ids and resolves select value", () => {
    const linked = ["empty", "custom:abc"];
    const builtins = filterBuiltinPayloads(linked);
    assert.ok(builtins.some((p) => p.id === "empty"));
    assert.equal(
      filterCustomPayloads(linked, [
        { id: "abc", label: "A", description: "d", payloadJson: "{}" },
        { id: "zzz", label: "Z", description: "", payloadJson: "{}" },
      ]).map((p) => p.id).join(","),
      "abc"
    );
    assert.equal(
      resolvePayloadSelectValue("missing", builtins, [{ id: "abc" }]),
      builtins[0]?.id ?? "custom:abc"
    );
    assert.equal(
      resolvePayloadSelectValue("__custom__", builtins, [{ id: "abc" }]),
      "__custom__"
    );
  });

  it("builds subject/payload hint strings", () => {
    assert.match(subjectPresetHint("custom:x.y", ["a", "b"]), /связанных payload: 2/);
    assert.match(subjectPresetHint("cm-status", []), /payload:/);
    assert.equal(
      payloadPresetHint("custom:missing", []),
      "Свой сохранённый payload"
    );
    assert.equal(
      payloadPresetHint("custom:1", [
        { id: "1", label: "L", description: "hint-here", payloadJson: "{}" },
      ]),
      "hint-here"
    );
  });
});

describe("desktop / complexSensorsHelpers", () => {
  it("orders muted rows last and filters visible modules", () => {
    assert.deepEqual(
      visibleSensorModules({ milk: true, coffee: false, water: true }),
      ["milk", "water"]
    );
    const ordered = orderSensorRows([
      { key: "a", label: "A", value: "1", muted: true, stale: false },
      { key: "b", label: "B", value: "2", muted: false, stale: true },
    ]);
    assert.deepEqual(
      ordered.map((r) => r.key),
      ["b", "a"]
    );
  });

  it("builds water rows with pressure/pulses and milk pump power fallback", () => {
    const water = buildComplexSensorRows({
      mod: "water",
      complexTemps: { water: { waterTemp: 42.5 } as never },
      mutedSensorKeys: [],
      pollStale: false,
      actStale: false,
      waterPressure: 1.25,
      waterPulses: 900,
      pumpCurrentByHost: { water: 0.111 },
      pumpCurrentLByHost: { water: 0.222 },
      pumpPowerByHost: { water: 55 },
      heaterPwmByHost: { water: { heater1: 10, heater2: 20 } },
      host: "water",
      pumpOn: true,
      pumpPower: 100,
    });
    assert.ok(water.some((r) => r.label === "Давление" && r.value.includes("1.25")));
    assert.ok(water.some((r) => r.label === "Total pulses" && r.value === "900"));

    const milk = buildComplexSensorRows({
      mod: "milk",
      complexTemps: {},
      mutedSensorKeys: [],
      pollStale: false,
      actStale: false,
      waterPressure: null,
      waterPulses: null,
      pumpCurrentByHost: {},
      pumpCurrentLByHost: {},
      pumpPowerByHost: {},
      heaterPwmByHost: {},
      host: "milk",
      pumpOn: true,
      pumpPower: 77,
    });
    assert.ok(
      milk.some((r) => r.label === "Насос мощность" && r.value === "77 %")
    );
  });

  it("shows dash instead of last-known when NATS/DX fail or stale", () => {
    assert.equal(
      sensorReadoutOffline({
        localName: "input",
        pollStale: false,
        actStale: false,
        natsOk: false,
      }),
      true
    );
    assert.equal(
      sensorReadoutOffline({
        localName: "pumpCurrent",
        pollStale: false,
        actStale: false,
        dxOk: false,
      }),
      true
    );
    assert.equal(
      sensorReadoutOffline({
        localName: "input",
        pollStale: false,
        actStale: false,
        natsOk: true,
        dxOk: true,
      }),
      false
    );

    const milk = buildComplexSensorRows({
      mod: "milk",
      complexTemps: { milk: { input: 22 } as never },
      mutedSensorKeys: [],
      pollStale: false,
      actStale: false,
      natsOk: false,
      dxOk: true,
      waterPressure: null,
      waterPulses: null,
      pumpCurrentByHost: { milk: 0.5 },
      pumpCurrentLByHost: { milk: 0.4 },
      pumpPowerByHost: { milk: 40 },
      heaterPwmByHost: {},
      host: "milk",
      pumpOn: true,
      pumpPower: 40,
    });
    assert.ok(milk.some((r) => r.label === "Input" && r.value === "—"));
    assert.ok(milk.some((r) => r.label === "Насос мощность" && r.value === "—"));
    assert.ok(
      milk.some((r) => r.label === "Насос R_IS" && r.value.includes("0.500")),
      "DX still ok → keep current"
    );

    const dxFail = buildComplexSensorRows({
      mod: "milk",
      complexTemps: { milk: { input: 22 } as never },
      mutedSensorKeys: [],
      pollStale: false,
      actStale: false,
      natsOk: true,
      dxOk: false,
      waterPressure: null,
      waterPulses: null,
      pumpCurrentByHost: { milk: 0.5 },
      pumpCurrentLByHost: {},
      pumpPowerByHost: { milk: 40 },
      heaterPwmByHost: {},
      host: "milk",
      pumpOn: false,
      pumpPower: 0,
    });
    assert.ok(dxFail.some((r) => r.label === "Насос R_IS" && r.value === "—"));
    assert.ok(
      dxFail.some((r) => r.label === "Input" && r.value.includes("22.0")),
      "NATS ok → keep temp"
    );
  });
});

describe("desktop / ModulesLabToolbar helpers", () => {
  it("picks host health badge class by nats/dx flags", () => {
    assert.equal(hostHealthBadgeClass(true, true), "badge on");
    assert.equal(hostHealthBadgeClass(false, true), "badge danger");
    assert.equal(hostHealthBadgeClass(true, false), "badge danger");
    assert.equal(hostHealthBadgeClass(undefined, undefined), "badge");
  });
});

describe("desktop / brewLabHelpers", () => {
  it("builds single part and optional milk part", () => {
    assert.deepEqual(
      brewLabPartsFromForm({
        type: "coffee",
        qtyMs: 2000,
        tempC: 65,
        addMilk: false,
        milkQtyMs: 8000,
        milkTempC: 60,
      }),
      [{ type: "coffee", qtyMs: 2000, tempC: 65, productionOrder: 1 }]
    );
    const withMilk = brewLabPartsFromForm({
      type: "water",
      qtyMs: 1000,
      tempC: 70,
      addMilk: true,
      milkQtyMs: 5000,
      milkTempC: 55,
    });
    assert.equal(withMilk.length, 2);
    assert.equal(withMilk[1]?.type, "milk");
    assert.equal(withMilk[1]?.productionOrder, 2);
  });
});

describe("desktop / labScenariosHelpers", () => {
  it("keeps Stop CM clickable while other scenario busy", () => {
    assert.equal(isScenarioButtonDisabled("milkrinse", "scenario-milkrinse", false), true);
    assert.equal(isScenarioButtonDisabled("stop-cm", "scenario-milkrinse", false), false);
    assert.equal(isScenarioButtonDisabled("stop-cm", "scenario-stop-cm", false), true);
    assert.equal(isScenarioButtonDisabled("status", null, true), true);
  });
});

describe("desktop / milkSystemValvesHelpers", () => {
  it("computes open valve numbers after optimistic toggle", () => {
    assert.deepEqual(milkValveOpenNumbers({ "1": true, "2": false }, 2, true), [
      1, 2,
    ]);
    assert.deepEqual(milkValveOpenNumbers({ "1": true, "3": true }, 1, false), [
      3,
    ]);
  });
});

describe("desktop / moduleValvesHelpers", () => {
  it("disables row for live/busy valve/all/pkg", () => {
    assert.equal(isValveRowDisabled("drain", true, null), false);
    assert.equal(isValveRowDisabled("drain", false, null), true);
    assert.equal(isValveRowDisabled("drain", true, "valve-drain"), true);
    assert.equal(isValveRowDisabled("drain", true, "valves-all"), true);
    assert.equal(isValveRowDisabled("drain", true, "valve-pkg"), true);
  });
});

describe("desktop / moduleHeatersHelpers", () => {
  it("maps heater ids to outlet sensor and short id", () => {
    assert.equal(heaterOutletSensor("heater1"), "heater1_out");
    assert.equal(heaterOutletSensor("heater2"), "heater2_out");
    assert.equal(heaterOutletSensor("other"), null);
    assert.equal(heaterShortId("heater1"), "heater1");
    assert.equal(heaterShortId("x"), null);
  });

  it("estimates PWM with 25% fallback when temp unknown", () => {
    assert.equal(estimatePwmForHeater(true, 60, null), 25);
    assert.equal(estimatePwmForHeater(true, 60, 40), 30);
    assert.equal(estimatePwmForHeater(true, 50, 55), 0);
  });
});

describe("desktop / modulePumpHelpers", () => {
  it("treats power/busy as running for STOP label", () => {
    assert.equal(isPumpRunning(null, null, null), false);
    assert.equal(isPumpRunning(true, 0, null), true);
    assert.equal(isPumpRunning(false, 40, null), true);
    assert.equal(isPumpRunning(false, 0, "pump"), true);
  });
});

describe("desktop / moduleServiceHelpers", () => {
  it("picks flush open valve by host/kind", () => {
    assert.equal(flushOpenValve("milk", "milk"), "milkInput");
    assert.equal(flushOpenValve("milk", "water"), "waterInput");
    assert.equal(flushOpenValve("coffee", "water"), "waterInput");
    // water host catalog has no waterInput → milkInput fallback
    assert.equal(flushOpenValve("water", "water"), "milkInput");
    assert.equal(flushOpenValve("water", "milk"), "milkInput");
  });

  it("validates foam temp range", () => {
    assert.equal(isFoamTempValid(19), false);
    assert.equal(isFoamTempValid(20), true);
    assert.equal(isFoamTempValid(95), true);
    assert.equal(isFoamTempValid(96), false);
  });
});

describe("desktop / flowCalibrationHelpers", () => {
  it("parses actual ml and computes factors", () => {
    assert.equal(parseActualMl("250"), 250);
    assert.equal(parseActualMl("12,5"), 12.5);
    assert.equal(parseActualMl("0"), null);
    assert.equal(parseActualMl("x"), null);
    assert.equal(computeStepFlowFactor(500, 250), 2);
    assert.equal(averageFlowFactor([2, 4]), 3);
    assert.equal(Number.isNaN(averageFlowFactor([])), true);
  });

  it("computes pulses delta with counter reset", () => {
    assert.equal(
      calibPulsesDelta({
        startPulses: 1000,
        endPulses: 1300,
        detectedReset: false,
        maxAfterReset: Number.NaN,
      }),
      300
    );
    assert.equal(
      calibPulsesDelta({
        startPulses: 1000,
        endPulses: 50,
        detectedReset: true,
        maxAfterReset: 420,
      }),
      420
    );
    assert.equal(isValidPulsesDelta(1), true);
    assert.equal(isValidPulsesDelta(0), false);
    assert.equal(initialCalibRows().map((r) => r.qty).join(","), "100,200,300,400");
  });
});

describe("desktop / labEventLogHelpers", () => {
  it("classifies critical sensors and sample gating", () => {
    assert.equal(isCriticalLabSensor("pumpCurrent"), true);
    assert.equal(isCriticalLabSensor("boilerTemp"), false);
    assert.equal(labSensorDelta("pumpCurrent", 0.15), 0.005);
    assert.equal(labSensorDelta("waterTotalPulses", 5), 1);
    assert.equal(labSensorHeartbeatMs("waterPressure", true), 1_500);
    assert.equal(labSensorHeartbeatMs("pumpCurrent", true), 1_200);
    assert.equal(labSensorHeartbeatMs("boilerTemp", false), 5_000);
    assert.equal(labSensorDigits("pumpCurrentL"), 3);
    assert.equal(
      shouldPushLabSensorSample({
        name: "boilerTemp",
        value: 40,
        tracked: false,
        prevValue: undefined,
        prevAt: undefined,
      }),
      false
    );
    assert.equal(
      shouldPushLabSensorSample({
        name: "pumpPower",
        value: 10,
        tracked: false,
        prevValue: undefined,
        prevAt: undefined,
      }),
      true
    );
    assert.equal(
      shouldPushLabSensorSample({
        name: "pumpPower",
        value: 10.2,
        minDelta: 0.5,
        tracked: true,
        prevValue: 10,
        prevAt: Date.now(),
        now: Date.now(),
      }),
      false
    );
  });

  it("builds chart sensor lists and live actuators", () => {
    const events = [
      {
        at: "2026-01-01T00:00:00.000Z",
        kind: "sensor" as const,
        module: "milk" as const,
        hwid: "x",
        name: "customSense",
        value: 1,
      },
      {
        at: "2026-01-01T00:00:01.000Z",
        kind: "valve" as const,
        module: "milk" as const,
        hwid: "x",
        name: "valve1",
        value: true,
      },
    ];
    const available = availableChartSensorsFromEvents(events);
    assert.ok(available.includes(seriesKey("milk", "customSense")));
    const names = chartSensorNamesFromEvents(events);
    assert.ok(names.includes(seriesKey("milk", "customSense")));
    const live = buildLiveActuators({
      host: "milk",
      labSnap: {
        lastTickAt: 1,
        valves: { [seriesKey("coffee", "valve2")]: { value: true, source: "nats", at: 1 } },
        pumpOn: { coffee: { value: true, source: "nats", at: 1 } },
        heaters: {},
        heaterPwm: {},
        pumpPower: {},
        pumpRis: {},
        pumpLis: {},
        complexTemps: {},
        hostHealth: {},
      } as never,
      valves: { valve1: true },
      milkValves: { "1": true, "2": false },
      pumpOn: false,
      labEvents: events,
    });
    assert.equal(live.valves[seriesKey("milk", "valve1")], true);
    assert.equal(live.valves[seriesKey("milk", "msValve1")], true);
    assert.equal(live.pumps.milk, false);
    assert.equal(live.pumps.coffee, true);
  });
});

describe("desktop / modulesLabNatsHelpers", () => {
  it("matches muster hwid and parses valves.switched payload", () => {
    const modules: NatsMusterEntry[] = [
      { hwid: "custom-water-9", role: "water", raw: {} },
    ];
    assert.equal(matchMusterHwid(modules, "water"), "custom-water-9");
    assert.equal(matchMusterHwid(modules, "milk"), undefined);
    assert.deepEqual(parseValvesSwitchedNumbers({ valves: [1, "2", "x"] }), [
      1, 2,
    ]);
    assert.deepEqual(parseValvesSwitchedNumbers(null), []);
  });
});

describe("desktop / modulesLabTelemetryHelpers", () => {
  it("maps milk-system open numbers to EnabledMap", () => {
    assert.deepEqual(milkValvesMapFromOpen([1, 3], { "9": true }), {
      "9": true,
      "1": true,
      "2": false,
      "3": true,
      "4": false,
      "5": false,
      "6": false,
    });
    assert.deepEqual(milkValvesMapFromOpenList([2]), {
      "1": false,
      "2": true,
      "3": false,
      "4": false,
      "5": false,
      "6": false,
    });
  });
});

describe("desktop / ModulesLabCharts TDZ guard", () => {
  it("declares allSensors/valvesMap before syncLatest ref", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
      join(here, "components", "ModulesLabCharts.tsx"),
      "utf8"
    );
    const fn = src.slice(src.indexOf("export function ModulesLabCharts"));
    const valvesIdx = fn.indexOf("const valvesMap = useMemo");
    const sensorsIdx = fn.indexOf("const allSensors = useMemo");
    const syncIdx = fn.indexOf("const syncLatest = useRef");
    assert.ok(valvesIdx > 0, "valvesMap useMemo missing");
    assert.ok(sensorsIdx > 0, "allSensors useMemo missing");
    assert.ok(syncIdx > 0, "syncLatest useRef missing");
    assert.ok(
      valvesIdx < syncIdx && sensorsIdx < syncIdx,
      "syncLatest must not read allSensors/valvesMap before initialization (TDZ crash)"
    );
  });
});
