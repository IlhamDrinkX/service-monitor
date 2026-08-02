/**
 * LabTelemetryController — unit tests (no Electron; window.desktop is mocked).
 *
 * Covers: pure optimistic setters, start/stop/pause/resume lifecycle, a full
 * natsTick() happy path (via kick()) with subject-level assertions, the
 * natsInFlight re-entrancy guard, pause() aborting an in-flight tick before it
 * applies stale data, and dxTick() (via kickDx()) happy/error/missing-API paths.
 *
 * Запуск: npm run test -w @service-monitor/desktop
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  heaterStatusSubject,
  pumpStatusSubject,
  seriesKey,
  valveStatusSubject,
  type DrinkxHost,
} from "@service-monitor/core";
import { LabTelemetryController, type LabTelemetryDeps } from "./LabTelemetryController.ts";

type NatsRes = { ok: true; data: unknown } | { ok: false; error: string };

/** Deferred promise — lets a test control exactly when a mocked call resolves. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type NatsCall = { subject: string; payload: unknown };

/** Minimal window.desktop stub — only the 3 methods LabTelemetryController calls. */
function installDesktopMock(opts?: {
  natsRoutes?: Map<string, NatsRes | (() => Promise<NatsRes>)>;
  dxResult?: () => Promise<unknown>;
  hasDxUi?: boolean;
}) {
  const natsCalls: NatsCall[] = [];
  const routes = opts?.natsRoutes ?? new Map<string, NatsRes | (() => Promise<NatsRes>)>();

  const natsRequest = async (input: {
    subject: string;
    payload?: unknown;
    timeoutMs?: number;
  }): Promise<NatsRes> => {
    natsCalls.push({ subject: input.subject, payload: input.payload });
    const route = routes.get(input.subject);
    if (!route) return { ok: true, data: {} };
    return typeof route === "function" ? route() : route;
  };

  const natsRequestMany = async (): Promise<
    { ok: true; replies: unknown[] } | { ok: false; error: string }
  > => ({ ok: false, error: "not stubbed" });

  const dxUiPumpCurrents =
    opts?.hasDxUi === false
      ? undefined
      : (async () => (opts?.dxResult ? await opts.dxResult() : { milk: {}, coffee: {}, water: {} })) as never;

  const desktop: Record<string, unknown> = {
    natsRequest,
    natsRequestMany,
  };
  if (dxUiPumpCurrents !== undefined) desktop.dxUiPumpCurrents = dxUiPumpCurrents;

  (globalThis as unknown as { window: { desktop: unknown } }).window = {
    desktop,
  };

  return { natsCalls };
}

function makeDeps(overrides?: Partial<LabTelemetryDeps>): LabTelemetryDeps {
  return {
    getActiveHost: () => "milk",
    resolveHwid: (h: DrinkxHost) => h,
    getSessionMode: () => "local",
    isModuleTracked: (h) => h === "milk",
    ...overrides,
  };
}

/** Wait for a controller's snapshot to reach a condition (poll, no timers assumed). */
async function waitFor(
  ctl: LabTelemetryController,
  predicate: (s: ReturnType<LabTelemetryController["getSnapshot"]>) => boolean,
  timeoutMs = 2_000
): Promise<void> {
  const start = Date.now();
  while (!predicate(ctl.getSnapshot())) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor: timed out");
    }
    await new Promise((r) => setTimeout(r, 5));
  }
}

const activeControllers: LabTelemetryController[] = [];
function track(ctl: LabTelemetryController): LabTelemetryController {
  activeControllers.push(ctl);
  return ctl;
}

afterEach(() => {
  // start() registers setInterval timers that keep the process alive — always
  // stop() every controller a test created, even on assertion failure.
  for (const ctl of activeControllers.splice(0)) {
    ctl.stop();
  }
});

describe("LabTelemetryController / optimistic setters (pure, no window.desktop)", () => {
  it("setPumpPower sets pumpPower + pumpOn with cmd source", () => {
    installDesktopMock();
    const ctl = track(new LabTelemetryController(makeDeps()));
    ctl.setPumpPower("milk", 55);
    const s = ctl.getSnapshot();
    assert.equal(s.pumpPower.milk?.value, 55);
    assert.equal(s.pumpPower.milk?.source, "cmd");
    assert.equal(s.pumpOn.milk?.value, true);

    ctl.setPumpPower("milk", 0);
    assert.equal(ctl.getSnapshot().pumpOn.milk?.value, false);
  });

  it("setHeater defaults PWM to 25 when enabling without an explicit value, 0 when disabling", () => {
    installDesktopMock();
    const ctl = track(new LabTelemetryController(makeDeps()));
    ctl.setHeater("coffee", "heater1", true);
    let s = ctl.getSnapshot();
    assert.equal(s.heaters.coffee?.heater1?.value, true);
    assert.equal(s.heaterPwm.coffee?.heater1?.value, 25);

    ctl.setHeater("coffee", "heater1", true, 60);
    assert.equal(ctl.getSnapshot().heaterPwm.coffee?.heater1?.value, 60);

    ctl.setHeater("coffee", "heater1", false);
    s = ctl.getSnapshot();
    assert.equal(s.heaters.coffee?.heater1?.value, false);
    assert.equal(s.heaterPwm.coffee?.heater1?.value, 0);
  });

  it("setValve + setMilkSystemOpen update the right keys with the given source", () => {
    installDesktopMock();
    const ctl = track(new LabTelemetryController(makeDeps()));
    ctl.setValve(seriesKey("milk", "drain"), true);
    assert.equal(ctl.getSnapshot().valves[seriesKey("milk", "drain")]?.value, true);

    ctl.setMilkSystemOpen([1, 3], "dx");
    const ms = ctl.getSnapshot().milkSystemOpen;
    assert.deepEqual(ms?.value, [1, 3]);
    assert.equal(ms?.source, "dx");
  });

  it("stop() before start() is a no-op; getSnapshot returns emptyLabSnapshot shape", () => {
    installDesktopMock();
    const ctl = track(new LabTelemetryController(makeDeps()));
    ctl.stop();
    const s = ctl.getSnapshot();
    assert.equal(s.tick, 0);
    assert.equal(s.pollInFlight, false);
  });
});

describe("LabTelemetryController / kick() natsTick happy path", () => {
  it("polls valves/pump/heaters for the active host + facade status, applies results", async () => {
    const routes = new Map<string, NatsRes | (() => Promise<NatsRes>)>();
    routes.set(valveStatusSubject("milk", "drain"), { ok: true, data: { enabled: true } });
    routes.set(valveStatusSubject("milk", "dump"), { ok: true, data: { enabled: false } });
    routes.set(pumpStatusSubject("milk"), { ok: true, data: { enabled: true, power: 63 } });
    routes.set(heaterStatusSubject("milk", "heater1"), {
      ok: true,
      data: { enabled: true, target: 45, temperature: 40 },
    });
    routes.set(heaterStatusSubject("milk", "heater2"), {
      ok: true,
      data: { enabled: false },
    });
    routes.set("coffeemachine.status", {
      ok: true,
      data: {
        format: "drinkx-1.0",
        milkSensors: [{ name: "milk_input", type: "temp", value: 21.5 }],
        milkValves: [1, 3],
      },
    });
    const { natsCalls } = installDesktopMock({ natsRoutes: routes });

    const ctl = track(new LabTelemetryController(makeDeps()));
    // kick()/kickDx() are no-ops while `stopped` (they're meant for "extra tick
    // between the normal timers" once running) — start() performs the actual
    // first tick and is what exercises natsTick() end to end here.
    ctl.start();
    await waitFor(ctl, (s) => s.tick > 0 && !s.pollInFlight);

    const s = ctl.getSnapshot();
    assert.equal(s.errors.length, 0, `unexpected errors: ${s.errors.join(", ")}`);
    assert.equal(s.valves[seriesKey("milk", "drain")]?.value, true);
    assert.equal(s.valves[seriesKey("milk", "dump")]?.value, false);
    assert.equal(s.pumpPower.milk?.value, 63);
    assert.equal(s.pumpOn.milk?.value, true);
    assert.equal(s.heaters.milk?.heater1?.value, true);
    assert.equal(s.heaters.milk?.heater2?.value, false);
    assert.equal(s.complexTemps.milk?.input, 21.5);
    assert.deepEqual(s.milkSystemOpen?.value, [1, 3]);

    // Only the active (tracked) host's valves/pump/heaters were polled — coffee/water
    // skipped (note: NATS_SUBJECTS.status is "coffeemachine.status" for *all* hosts,
    // so we check the per-host pump/heater subjects specifically, not a substring).
    assert.ok(!natsCalls.some((c) => c.subject === pumpStatusSubject("coffee")));
    assert.ok(!natsCalls.some((c) => c.subject === pumpStatusSubject("water")));
    assert.ok(!natsCalls.some((c) => c.subject === heaterStatusSubject("coffee", "heater1")));
    assert.ok(natsCalls.some((c) => c.subject === pumpStatusSubject("milk")));
  });

  it("records a per-host error string when a NATS call fails, without aborting the rest of the tick", async () => {
    const routes = new Map<string, NatsRes | (() => Promise<NatsRes>)>();
    routes.set(pumpStatusSubject("milk"), { ok: false, error: "timeout" });
    routes.set(heaterStatusSubject("milk", "heater1"), {
      ok: true,
      data: { enabled: true, target: 45, temperature: 30 },
    });
    installDesktopMock({ natsRoutes: routes });

    const ctl = track(new LabTelemetryController(makeDeps()));
    ctl.start();
    await waitFor(ctl, (s) => s.tick > 0 && !s.pollInFlight);

    const s = ctl.getSnapshot();
    assert.ok(s.errors.some((e) => e.startsWith("pump.milk:")), s.errors.join(","));
    // heater1 still applied even though pump failed
    assert.equal(s.heaters.milk?.heater1?.value, true);
  });

  it("does not start a second natsTick while one is already in flight (natsInFlight guard)", async () => {
    const gate = deferred<NatsRes>();
    const routes = new Map<string, NatsRes | (() => Promise<NatsRes>)>();
    routes.set(pumpStatusSubject("milk"), () => gate.promise);
    const { natsCalls } = installDesktopMock({ natsRoutes: routes });

    const ctl = track(new LabTelemetryController(makeDeps()));
    ctl.start();
    // Give the first tick a tick of the event loop to reach the in-flight NATS calls.
    await new Promise((r) => setTimeout(r, 10));
    const callsAfterFirstKick = natsCalls.length;

    ctl.kick(); // should be a no-op: natsInFlight is still true
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(natsCalls.length, callsAfterFirstKick, "second kick() should not issue new NATS calls");

    gate.resolve({ ok: true, data: { enabled: true, power: 10 } });
    await waitFor(ctl, (s) => s.tick > 0 && !s.pollInFlight);
    assert.equal(ctl.getSnapshot().pumpPower.milk?.value, 10);
  });
});

describe("LabTelemetryController / pause() aborts an in-flight tick", () => {
  it("does not apply results that resolve after pause() — only pollPaused flips", async () => {
    const gate = deferred<NatsRes>();
    const routes = new Map<string, NatsRes | (() => Promise<NatsRes>)>();
    routes.set(pumpStatusSubject("milk"), () => gate.promise);
    installDesktopMock({ natsRoutes: routes });

    const ctl = track(new LabTelemetryController(makeDeps()));
    ctl.start();
    await new Promise((r) => setTimeout(r, 10)); // let the tick reach the in-flight await
    assert.equal(ctl.getSnapshot().pollInFlight, true);

    ctl.pause();
    assert.equal(ctl.getSnapshot().pollPaused, true);
    assert.equal(ctl.getSnapshot().pollInFlight, false);

    // Resolve the stale request *after* pause — must not retroactively apply.
    gate.resolve({ ok: true, data: { enabled: true, power: 77 } });
    await new Promise((r) => setTimeout(r, 20));

    const s = ctl.getSnapshot();
    assert.equal(s.pumpPower.milk, undefined, "stale post-pause NATS result must not be applied");
    assert.equal(s.pollPaused, true);
  });
});

describe("LabTelemetryController / dxTick via kickDx()", () => {
  it("applies DX currents with source 'dx' and sets a status message", async () => {
    installDesktopMock({
      dxResult: async () => ({
        milk: { pump_R_IS: 0.42, pump_L_IS: 0.1 },
        coffee: { pump_R_IS: null, pump_L_IS: null },
        water: { pump_R_IS: null, pump_L_IS: null },
      }),
    });
    const ctl = track(new LabTelemetryController(makeDeps()));
    ctl.start();
    await waitFor(ctl, (s) => s.pumpRis.milk?.value === 0.42);

    const s = ctl.getSnapshot();
    assert.equal(s.pumpRis.milk?.source, "dx");
    assert.equal(s.pumpLis.milk?.value, 0.1);
    assert.match(s.dxUiStatus, /DX UI ток/);
  });

  it("sets a dxUiStatus error message when the DX call rejects", async () => {
    installDesktopMock({
      dxResult: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    const ctl = track(new LabTelemetryController(makeDeps()));
    ctl.start();
    await waitFor(ctl, (s) => s.dxUiStatus.includes("ECONNREFUSED"));
    assert.match(ctl.getSnapshot().dxUiStatus, /DX UI: ECONNREFUSED/);
  });

  it("reports the missing-API message when dxUiPumpCurrents is not exposed (stale preload)", async () => {
    installDesktopMock({ hasDxUi: false });
    const ctl = track(new LabTelemetryController(makeDeps()));
    ctl.start();
    await waitFor(ctl, (s) => s.dxUiStatus.length > 0);
    assert.match(ctl.getSnapshot().dxUiStatus, /перезапустите приложение/);
  });
});

describe("LabTelemetryController / start()/stop() lifecycle", () => {
  it("start() fires an immediate tick; stop() clears timers and resets in-flight flags", async () => {
    installDesktopMock();
    const ctl = track(new LabTelemetryController(makeDeps()));
    ctl.start();
    await waitFor(ctl, (s) => s.tick > 0);
    ctl.stop();
    const s = ctl.getSnapshot();
    assert.equal(s.pollInFlight, false);
    assert.equal(s.pollPaused, false);
  });

  it("start() is idempotent while already running (second call does not double-register timers)", () => {
    installDesktopMock();
    const ctl = track(new LabTelemetryController(makeDeps()));
    ctl.start();
    ctl.start(); // must not throw / must not create a second pair of intervals
    ctl.stop();
  });
});
