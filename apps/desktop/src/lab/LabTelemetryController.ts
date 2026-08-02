/**
 * Lab telemetry: один владелец опроса + pause на команды.
 *
 * Dual poll (always-on complex-wide charts — не только Big Wash):
 * - Active host ~800ms: valves + pump + heaters + status
 * - Other tracked hosts ~800ms: status/temps + valves + heaters + pumps
 * - Module track off → skip whole module NATS jobs (default track = all three)
 * - DX timer ~1s отдельно: pump_R/L_IS для всех хостов (не на NATS inFlight)
 * - valveHoldUntil: не затирать optimistic лампы
 * - pumps.*! ACK мгновенный (ERP); ток: DX UI, иначе extractPumpCurrent(status)
 */

import {
  DRINKX_HOSTS,
  HEATER_IDS,
  MODULE_VALVES,
  NATS_SUBJECTS,
  LAB_ACTIVE_POLL_MS,
  LAB_OTHER_STATUS_MS,
  applyDxPumpCurrents,
  applyLabStatusReplies,
  computeNatsHostHealth,
  emptyLabSnapshot,
  estimateHeaterPwmPercent,
  extractEnabledState,
  extractHeaterStatus,
  extractPumpPowerPercent,
  natsReplyIsError,
  heaterStatusSubject,
  planLabNatsPoll,
  pumpStatusSubject,
  seriesKey,
  timed,
  valveStatusSubject,
  type DrinkxHost,
  type LabSnapshot,
  type TempSensorKey,
  type TimedValue,
} from "@service-monitor/core";

export type LabTelemetryDeps = {
  getActiveHost: () => DrinkxHost;
  resolveHwid: (host: DrinkxHost) => string;
  getSessionMode: () => "remote" | "local" | null | undefined;
  valveHoldUntil?: Map<string, number>;
  /** Track off → drop whole module poll. Default: all on. */
  isModuleTracked?: (host: DrinkxHost) => boolean;
};

type NatsRes =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

async function natsReq(
  subject: string,
  payload: Record<string, unknown>,
  timeoutMs: number
): Promise<NatsRes> {
  try {
    return await window.desktop.natsRequest({
      subject,
      payload,
      timeoutMs,
      priority: "poll",
    });
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const DX_INTERVAL_MS = 1_000;
/** После bus/cmd не затирать msValve статусом DrinkX (часто устаревшим). */
const MILK_SYSTEM_HOLD_MS = 3_500;

export class LabTelemetryController {
  private snap: LabSnapshot = emptyLabSnapshot();
  private listeners = new Set<(s: LabSnapshot) => void>();
  private pauseCount = 0;
  private natsTimer: ReturnType<typeof setInterval> | null = null;
  private dxTimer: ReturnType<typeof setInterval> | null = null;
  private natsInFlight = false;
  private dxInFlight = false;
  private stopped = true;
  /** Abort in-flight NATS ticks (pause / host change). DX uses dxGeneration. */
  private natsGeneration = 0;
  private dxGeneration = 0;
  private tickN = 0;
  private milkSystemHoldUntil = 0;
  private lastOtherStatusAt = 0;
  private readonly deps: LabTelemetryDeps;

  // Plain field assignment, not a TS "parameter property" — Node's
  // --experimental-strip-types (used by `npm test`) can erase type
  // annotations but cannot execute parameter-property constructor syntax,
  // so `constructor(private readonly deps: ...)` fails to import at all
  // under the test runner. This was the reason this class had no unit
  // tests: it couldn't even be imported by them.
  constructor(deps: LabTelemetryDeps) {
    this.deps = deps;
  }

  getSnapshot(): LabSnapshot {
    return this.snap;
  }

  subscribe(cb: (s: LabSnapshot) => void): () => void {
    this.listeners.add(cb);
    cb(this.snap);
    return () => {
      this.listeners.delete(cb);
    };
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.natsTick();
    void this.dxTick();
    this.natsTimer = setInterval(() => void this.natsTick(), LAB_ACTIVE_POLL_MS);
    this.dxTimer = setInterval(() => void this.dxTick(), DX_INTERVAL_MS);
  }

  stop(): void {
    this.stopped = true;
    this.natsGeneration += 1;
    this.dxGeneration += 1;
    if (this.natsTimer) clearInterval(this.natsTimer);
    if (this.dxTimer) clearInterval(this.dxTimer);
    this.natsTimer = null;
    this.dxTimer = null;
    this.emit({ ...this.snap, pollInFlight: false, pollPaused: false });
  }

  /** Пауза только NATS (команды). DX ток продолжает — иначе R/L_IS залипают на START. */
  pause(): void {
    this.pauseCount += 1;
    this.natsGeneration += 1;
    this.emit({ ...this.snap, pollPaused: true, pollInFlight: false });
  }

  resume(): void {
    this.pauseCount = Math.max(0, this.pauseCount - 1);
    if (this.pauseCount === 0) {
      this.emit({ ...this.snap, pollPaused: false });
      window.setTimeout(() => {
        if (this.pauseCount === 0 && !this.stopped) {
          void this.natsTick();
          void this.dxTick();
        }
      }, 400);
    }
  }

  /** Внеочередной NATS tick. */
  kick(): void {
    if (this.pauseCount === 0 && !this.stopped) void this.natsTick();
  }

  /** Внеочередной DX ток — даже во время pause NATS (насос уже крутится). */
  kickDx(): void {
    if (!this.stopped) void this.dxTick();
  }

  setPumpPower(host: DrinkxHost, percent: number, on?: boolean): void {
    const at = Date.now();
    this.emit({
      ...this.snap,
      pumpPower: {
        ...this.snap.pumpPower,
        [host]: timed(percent, "cmd", at),
      },
      pumpOn: {
        ...this.snap.pumpOn,
        [host]: timed(on ?? percent > 0, "cmd", at),
      },
      lastTickAt: Math.max(this.snap.lastTickAt, at),
    });
  }

  setHeater(
    host: DrinkxHost,
    hid: "heater1" | "heater2",
    enabled: boolean,
    pwm?: number
  ): void {
    const at = Date.now();
    const heaters = {
      ...this.snap.heaters,
      [host]: {
        ...this.snap.heaters[host],
        [hid]: timed(enabled, "cmd", at),
      },
    };
    const heaterPwm = { ...this.snap.heaterPwm };
    heaterPwm[host] = {
      ...heaterPwm[host],
      [hid]: timed(enabled ? (pwm ?? 25) : 0, "cmd", at),
    };
    this.emit({
      ...this.snap,
      heaters,
      heaterPwm,
      lastTickAt: Math.max(this.snap.lastTickAt, at),
    });
  }

  /** Оптимистично / с bus: открытые msValve 1…6. */
  setMilkSystemOpen(openNumbers: number[], source: "cmd" | "nats" | "dx" = "cmd"): void {
    const at = Date.now();
    this.milkSystemHoldUntil = at + MILK_SYSTEM_HOLD_MS;
    this.emit({
      ...this.snap,
      milkSystemOpen: timed(openNumbers, source, at),
      lastTickAt: Math.max(this.snap.lastTickAt, at),
    });
  }

  /** Optimistic valve (hold делает ModulesPage). key = `milk.drain` / seriesKey. */
  setValve(key: string, enabled: boolean): void {
    const at = Date.now();
    this.emit({
      ...this.snap,
      valves: {
        ...this.snap.valves,
        [key]: timed(enabled, "cmd", at),
      },
      lastTickAt: Math.max(this.snap.lastTickAt, at),
    });
  }

  /**
   * Смена Lab host — не сбрасываем valves других модулей (график coffee/water
   * продолжает писать историю, пока UI на milk).
   */
  onHostChange(): void {
    this.natsGeneration += 1;
    this.emit({
      ...this.snap,
      pollInFlight: false,
    });
    if (!this.stopped && this.pauseCount === 0) {
      window.setTimeout(() => {
        if (!this.stopped && this.pauseCount === 0) void this.natsTick();
      }, 200);
    }
  }

  private emit(next: LabSnapshot): void {
    this.snap = next;
    for (const cb of this.listeners) {
      try {
        cb(next);
      } catch (e) {
        console.warn("[lab-telemetry] listener", e);
      }
    }
  }

  private natsAborted(gen: number): boolean {
    return (
      this.stopped || this.pauseCount > 0 || gen !== this.natsGeneration
    );
  }

  private dxAborted(gen: number): boolean {
    return this.stopped || gen !== this.dxGeneration;
  }

  /** NATS: active full ~800ms; other tracked: status+valves+heaters+pumps ~800ms. */
  private async natsTick(): Promise<void> {
    if (this.stopped || this.pauseCount > 0 || this.natsInFlight) return;
    this.natsInFlight = true;
    const gen = this.natsGeneration;
    const active = this.deps.getActiveHost();
    const isTracked = (h: DrinkxHost) =>
      this.deps.isModuleTracked?.(h) !== false;
    const at = Date.now();
    const plan = planLabNatsPoll({
      active,
      now: at,
      lastOtherStatusAt: this.lastOtherStatusAt,
      otherStatusMs: LAB_OTHER_STATUS_MS,
      isTracked,
    });
    if (plan.didOtherStatus) this.lastOtherStatusAt = at;

    const errors: string[] = [];
    this.tickN += 1;
    const tick = this.tickN;

    this.emit({
      ...this.snap,
      tick,
      pollInFlight: true,
      pollPaused: false,
    });

    let next: LabSnapshot = {
      ...this.snap,
      tick,
      errors: [],
      pollInFlight: true,
      pollPaused: false,
    };

    if (
      plan.fullHosts.length === 0 &&
      plan.statusHosts.length === 0 &&
      plan.actuatorHosts.length === 0 &&
      plan.pumpHosts.length === 0
    ) {
      this.emit({
        ...next,
        pollInFlight: false,
        lastTickAt: Date.now(),
      });
      this.natsInFlight = false;
      return;
    }

    try {
      // Valves/heaters/pumps: active every tick; other tracked on same ~800ms interval
      const valveJobs = plan.actuatorHosts.flatMap((mod) =>
        MODULE_VALVES[mod].map(async (baseId) => {
          const res = await natsReq(
            valveStatusSubject(mod, baseId),
            { hwid: this.deps.resolveHwid(mod) },
            700
          );
          return {
            mod,
            baseId,
            key: seriesKey(mod, baseId),
            enabled: res.ok ? extractEnabledState(res.data) : null,
          };
        })
      );

      const [facadeStatus, valveResults, pumpResults, heaterResults] =
        await Promise.all([
          plan.statusHosts.length > 0
            ? natsReq(NATS_SUBJECTS.status, { hwid: "dx" }, 1_200)
            : Promise.resolve({ ok: false as const, error: "skipped" }),
          Promise.all(valveJobs),
          Promise.all(
            plan.pumpHosts.map(async (mod) => {
              const res = await natsReq(
                pumpStatusSubject(mod),
                { hwid: this.deps.resolveHwid(mod) },
                700
              );
              return { mod, res };
            })
          ),
          Promise.all(
            plan.actuatorHosts.flatMap((mod) =>
              HEATER_IDS.map(async (hid) => {
                const res = await natsReq(
                  heaterStatusSubject(mod, hid),
                  { hwid: this.deps.resolveHwid(mod) },
                  700
                );
                return { mod, hid, res };
              })
            )
          ),
        ]);

      if (this.natsAborted(gen)) {
        this.emit({ ...this.snap, pollInFlight: false, pollPaused: this.pauseCount > 0 });
        return;
      }

      const prevTemps = this.snap.complexTemps;
      const prevPressure = this.snap.waterPressure;
      const prevPulses = this.snap.waterPulses;
      const prevRis = this.snap.pumpRis;

      // status / temps — facade {hwid:dx} → milkSensors/… + milkValves[]
      if (facadeStatus.ok && !natsReplyIsError(facadeStatus.data)) {
        next = applyLabStatusReplies(next, [facadeStatus.data], at, {
          milkSystemHoldUntil: this.milkSystemHoldUntil,
        });
      } else if (plan.statusHosts.length > 0) {
        const many = await window.desktop
          .natsRequestMany({
            subject: NATS_SUBJECTS.status,
            payload: {},
            timeoutMs: 900,
            priority: "poll",
          })
          .catch((e) => ({
            ok: false as const,
            error: errText(e),
            replies: [] as unknown[],
          }));
        const replies =
          many.ok && Array.isArray(many.replies) ? many.replies : [];
        if (replies.length > 0) {
          next = applyLabStatusReplies(next, replies, at, {
            milkSystemHoldUntil: this.milkSystemHoldUntil,
          });
        } else {
          const statusJobs = await Promise.all(
            plan.statusHosts.map(async (mod) => {
              const res = await natsReq(
                NATS_SUBJECTS.status,
                { hwid: this.deps.resolveHwid(mod) },
                1_000
              );
              return res.ok ? res.data : null;
            })
          );
          if (this.natsAborted(gen)) {
            this.emit({ ...this.snap, pollInFlight: false });
            return;
          }
          const okReplies = statusJobs.filter((x) => x != null);
          if (okReplies.length > 0) {
            next = applyLabStatusReplies(next, okReplies, at, {
              milkSystemHoldUntil: this.milkSystemHoldUntil,
            });
          } else {
            errors.push("status: no replies");
          }
        }
      }

      // Keep temps/currents for hosts not in this tick's status window
      {
        const statusSet = new Set(plan.statusHosts);
        const complexTemps = { ...next.complexTemps };
        for (const h of DRINKX_HOSTS) {
          if (!statusSet.has(h)) complexTemps[h] = prevTemps[h];
        }
        let waterPressure = next.waterPressure;
        let waterPulses = next.waterPulses;
        if (!statusSet.has("water")) {
          waterPressure = prevPressure;
          waterPulses = prevPulses;
        }
        const pumpRis = { ...next.pumpRis };
        for (const h of ["milk", "coffee", "water"] as const) {
          if (!statusSet.has(h) && prevRis[h]) pumpRis[h] = prevRis[h];
        }
        next = { ...next, complexTemps, waterPressure, waterPulses, pumpRis };
      }

      // valves — ключ seriesKey(mod, id); never apply null; respect hold
      {
        const hold = this.deps.valveHoldUntil;
        const now = Date.now();
        const valves = { ...next.valves };
        const liveValves = this.snap.valves;
        for (const { mod, baseId, key, enabled } of valveResults) {
          const holdUntil =
            hold?.get(key) ?? hold?.get(baseId) ?? 0;
          if (holdUntil > now) {
            if (liveValves[key]) valves[key] = liveValves[key]!;
            else if (liveValves[baseId] && mod === active) {
              valves[key] = liveValves[baseId]!;
            }
            continue;
          }
          if (enabled === null) continue;
          valves[key] = timed(enabled, "nats", at);
        }
        next = { ...next, valves };
      }

      // pumps power
      for (const { mod, res } of pumpResults) {
        if (!res.ok) {
          errors.push(`pump.${mod}: ${res.error}`);
          continue;
        }
        next = this.applyPumpStatus(next, mod, res.data, at);
      }

      // heaters + estimated PWM
      for (const { mod, hid, res } of heaterResults) {
        if (!res.ok) {
          errors.push(`heater.${mod}.${hid}: ${res.error}`);
          continue;
        }
        next = this.applyHeaterStatus(
          next,
          mod,
          hid as "heater1" | "heater2",
          res.data,
          at
        );
      }

      // Per-host NATS reachability
      {
        const pumpOk: Partial<Record<DrinkxHost, boolean>> = {};
        for (const { mod, res } of pumpResults) {
          pumpOk[mod] = res.ok && !natsReplyIsError(res.data);
        }
        const heaterOk: Partial<Record<DrinkxHost, boolean>> = {};
        for (const { mod, res } of heaterResults) {
          const ok = res.ok && !natsReplyIsError(res.data);
          heaterOk[mod] = heaterOk[mod] === undefined ? ok : heaterOk[mod]! || ok;
        }
        next = {
          ...next,
          hostHealth: computeNatsHostHealth(next.hostHealth, {
            pumpOk,
            heaterOk,
            complexTemps: next.complexTemps,
            at,
          }),
        };
      }

      if (this.natsAborted(gen)) {
        this.emit({ ...this.snap, pollInFlight: false });
        return;
      }

      next = this.rebaseAfterNats(next, this.snap);

      this.emit({
        ...next,
        errors,
        pollInFlight: false,
        lastTickAt: Date.now(),
      });
    } catch (e) {
      console.warn("[lab-telemetry] natsTick", e);
      this.emit({
        ...next,
        errors: [...errors, errText(e)],
        pollInFlight: false,
        lastTickAt: Date.now(),
      });
    } finally {
      this.natsInFlight = false;
      if (this.snap.pollInFlight) {
        this.emit({ ...this.snap, pollInFlight: false });
      }
    }
  }

  /** DX UI :8000 — только R/L_IS. Не блокируется pause NATS (ток на START насоса). */
  private async dxTick(): Promise<void> {
    if (this.stopped || this.dxInFlight) return;
    if (typeof window.desktop.dxUiPumpCurrents !== "function") {
      this.emit({
        ...this.snap,
        dxUiStatus: "перезапустите приложение (нет dxUiPumpCurrents API)",
      });
      return;
    }
    this.dxInFlight = true;
    const gen = this.dxGeneration;
    try {
      const dx = await window.desktop.dxUiPumpCurrents({
        mode: this.deps.getSessionMode() ?? null,
        timeoutMs: 3_500,
      });
      if (this.dxAborted(gen)) return;
      const at = Date.now();
      this.emit(this.applyDxCurrents(this.snap, dx, at));
    } catch (e) {
      if (!this.dxAborted(gen)) {
        this.emit({
          ...this.snap,
          dxUiStatus: `DX UI: ${errText(e)}`,
        });
      }
    } finally {
      this.dxInFlight = false;
    }
  }

  /**
   * После NATS await: сохранить DX токи и свежие cmd (START насоса/тэнов)
   * — иначе in-flight tick с power=0/enabled=false затирает optimistic UI.
   */
  private rebaseAfterNats(
    natsBuilt: LabSnapshot,
    live: LabSnapshot
  ): LabSnapshot {
    const now = Date.now();
    const CMD_GRACE_MS = 4_000;

    const prefer = <T,>(
      nats: TimedValue<T> | undefined,
      cmdOrLive: TimedValue<T> | undefined
    ) => {
      if (!cmdOrLive) return nats;
      if (!nats) return cmdOrLive;
      return cmdOrLive.updatedAt >= nats.updatedAt ? cmdOrLive : nats;
    };

    /** Свежий cmd ON не отдаём NATS OFF/0 (типичный mid-race после START). */
    const preferActuator = <T extends number | boolean>(
      nats: TimedValue<T> | undefined,
      liveTv: TimedValue<T> | undefined,
      isActiveCmd: (v: T) => boolean,
      isIdleNats: (v: T) => boolean
    ): TimedValue<T> | undefined => {
      if (
        liveTv?.source === "cmd" &&
        now - liveTv.updatedAt < CMD_GRACE_MS &&
        isActiveCmd(liveTv.value) &&
        (!nats || isIdleNats(nats.value))
      ) {
        return liveTv;
      }
      return prefer(nats, liveTv);
    };

    const pumpPower = { ...natsBuilt.pumpPower };
    const pumpOn = { ...natsBuilt.pumpOn };
    for (const host of ["milk", "coffee", "water"] as DrinkxHost[]) {
      pumpPower[host] = preferActuator(
        natsBuilt.pumpPower[host],
        live.pumpPower[host],
        (v) => v > 0,
        (v) => v === 0
      );
      pumpOn[host] = preferActuator(
        natsBuilt.pumpOn[host],
        live.pumpOn[host],
        (v) => v === true,
        (v) => v === false
      );
    }

    const heaters = { ...natsBuilt.heaters };
    const heaterPwm = { ...natsBuilt.heaterPwm };
    for (const host of ["milk", "coffee", "water"] as DrinkxHost[]) {
      heaters[host] = {
        ...natsBuilt.heaters[host],
        heater1: preferActuator(
          natsBuilt.heaters[host]?.heater1,
          live.heaters[host]?.heater1,
          (v) => v === true,
          (v) => v === false
        ),
        heater2: preferActuator(
          natsBuilt.heaters[host]?.heater2,
          live.heaters[host]?.heater2,
          (v) => v === true,
          (v) => v === false
        ),
      };
      heaterPwm[host] = {
        ...natsBuilt.heaterPwm[host],
        heater1: (() => {
          const livePwm = live.heaterPwm[host]?.heater1;
          if (
            livePwm?.source === "dx" &&
            now - livePwm.updatedAt < 3_500
          ) {
            return livePwm;
          }
          return preferActuator(
            natsBuilt.heaterPwm[host]?.heater1,
            livePwm,
            (v) => v > 0,
            (v) => v === 0
          );
        })(),
        heater2: (() => {
          const livePwm = live.heaterPwm[host]?.heater2;
          if (
            livePwm?.source === "dx" &&
            now - livePwm.updatedAt < 3_500
          ) {
            return livePwm;
          }
          return preferActuator(
            natsBuilt.heaterPwm[host]?.heater2,
            livePwm,
            (v) => v > 0,
            (v) => v === 0
          );
        })(),
      };
    }

    return {
      ...natsBuilt,
      // NATS never owns DX currents — always take live
      pumpRis: live.pumpRis,
      pumpLis: live.pumpLis,
      dxUiStatus: live.dxUiStatus || natsBuilt.dxUiStatus,
      hostHealth: (() => {
        const merged: LabSnapshot["hostHealth"] = {
          ...natsBuilt.hostHealth,
        };
        for (const mod of DRINKX_HOSTS) {
          const built = natsBuilt.hostHealth[mod];
          const liveH = live.hostHealth[mod];
          if (!built && !liveH) continue;
          merged[mod] = {
            natsOk: built?.natsOk ?? liveH?.natsOk ?? null,
            dxOk: liveH?.dxOk ?? built?.dxOk ?? null,
            updatedAt: Math.max(
              built?.updatedAt ?? 0,
              liveH?.updatedAt ?? 0
            ),
          };
        }
        return merged;
      })(),
      pumpPower,
      pumpOn,
      heaters,
      heaterPwm,
      milkSystemOpen: (() => {
        const liveMs = live.milkSystemOpen;
        const builtMs = natsBuilt.milkSystemOpen;
        if (now < this.milkSystemHoldUntil && liveMs) return liveMs;
        if (
          liveMs?.source === "cmd" &&
          now - liveMs.updatedAt < CMD_GRACE_MS
        ) {
          return liveMs;
        }
        return prefer(builtMs ?? undefined, liveMs ?? undefined) ?? null;
      })(),
    };
  }

  private applyPumpStatus(
    snap: LabSnapshot,
    host: DrinkxHost,
    data: unknown,
    at: number
  ): LabSnapshot {
    const enabled = extractEnabledState(data);
    const pow = extractPumpPowerPercent(data);
    const pumpOn = { ...snap.pumpOn };
    const pumpPower = { ...snap.pumpPower };
    const prevPow = snap.pumpPower[host];
    const prevOn = snap.pumpOn[host];
    const freshCmd =
      prevPow?.source === "cmd" && Date.now() - prevPow.updatedAt < 4_000;
    const cmdRunning = freshCmd && (prevPow?.value ?? 0) > 0;

    if (enabled !== null) {
      // Не гасить свежий START ложным enabled:false из in-flight status
      if (!(enabled === false && cmdRunning)) {
        pumpOn[host] = timed(enabled, "nats", at);
      } else if (prevOn) {
        pumpOn[host] = prevOn;
      }
    }

    if (pow != null) {
      if (pow === 0 && cmdRunning) {
        // status ещё не догнал ACK pumps.*! — оставить cmd %
      } else {
        pumpPower[host] = timed(pow, "nats", at);
      }
    } else if (enabled === false && !cmdRunning) {
      pumpPower[host] = timed(0, "nats", at);
    }
    // enabled true + null power → keep previous (cmd / last good)

    return { ...snap, pumpOn, pumpPower };
  }

  private applyHeaterStatus(
    snap: LabSnapshot,
    host: DrinkxHost,
    hid: "heater1" | "heater2",
    data: unknown,
    at: number
  ): LabSnapshot {
    const st = extractHeaterStatus(data);
    const prevEn = snap.heaters[host]?.[hid];
    const freshCmdOn =
      prevEn?.source === "cmd" &&
      prevEn.value === true &&
      Date.now() - prevEn.updatedAt < 4_000;

    // Не гасить свежий heaters.*! ложным enabled:false mid-race
    const keepCmd = st.enabled === false && freshCmdOn;
    const enabledForPwm = keepCmd ? true : st.enabled;

    const heaters = {
      ...snap.heaters,
      [host]: {
        ...snap.heaters[host],
        ...(st.enabled !== null
          ? { [hid]: keepCmd ? prevEn! : timed(st.enabled, "nats", at) }
          : {}),
      },
    };

    const sensorKey = (
      hid === "heater1" ? "heater1_out" : "heater2_out"
    ) as TempSensorKey;
    const tempFromSensors = snap.complexTemps[host]?.[sensorKey] ?? null;
    const pwm = estimateHeaterPwmPercent(
      enabledForPwm,
      st.target,
      st.temperature ?? tempFromSensors
    );

    const heaterPwm = { ...snap.heaterPwm };
    if (pwm != null) {
      // Не затирать cmd PWM нулём, пока status ещё OFF
      const prevPwm = snap.heaterPwm[host]?.[hid];
      if (
        pwm === 0 &&
        prevPwm?.source === "cmd" &&
        prevPwm.value > 0 &&
        Date.now() - prevPwm.updatedAt < 4_000
      ) {
        heaterPwm[host] = { ...heaterPwm[host], [hid]: prevPwm };
      } else if (
        // Live DX PID важнее оценки PidClassic.start (та часто залипает на 25%)
        prevPwm?.source === "dx" &&
        Date.now() - prevPwm.updatedAt < 3_500 &&
        enabledForPwm === true
      ) {
        heaterPwm[host] = { ...heaterPwm[host], [hid]: prevPwm };
      } else {
        heaterPwm[host] = {
          ...heaterPwm[host],
          [hid]: timed(pwm, "nats", at),
        };
      }
    }

    return { ...snap, heaters, heaterPwm };
  }

  private applyDxCurrents(
    snap: LabSnapshot,
    dx: Parameters<typeof applyDxPumpCurrents>[1],
    at: number
  ): LabSnapshot {
    return applyDxPumpCurrents(snap, dx, at);
  }
}

export type { LabSnapshot };
