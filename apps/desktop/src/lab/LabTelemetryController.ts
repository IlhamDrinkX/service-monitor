/**
 * Lab telemetry: один владелец опроса + pause на команды.
 *
 * Модель как в git HEAD (надёжная), плюс snapshot/stale:
 * - NATS tick ~1.1s: status + valves ALL hosts + pumps milk/coffee/water + heaters
 * - DX timer ~1.5s ОТДЕЛЬНО: только pump_R/L_IS (не на NATS inFlight)
 * - valveHoldUntil: не затирать optimistic лампы
 * - pumps.*! ACK мгновенный (ERP); ток только из DX UI, не из NATS status
 */

import {
  DRINKX_HOSTS,
  HEATER_IDS,
  MODULE_VALVES,
  NATS_SUBJECTS,
  emptyLabSnapshot,
  estimateHeaterPwmPercent,
  extractEnabledState,
  extractHeaterStatus,
  extractPumpPowerPercent,
  extractTempMap,
  extractWaterPressure,
  extractWaterTotalPulses,
  extractOpenValveNumbers,
  mergeOpenValveNumbers,
  natsReplyIsError,
  heaterStatusSubject,
  parseComplexStatusTuple,
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

const NATS_INTERVAL_MS = 1_100;
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

  constructor(private readonly deps: LabTelemetryDeps) {}

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
    this.natsTimer = setInterval(() => void this.natsTick(), NATS_INTERVAL_MS);
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

  /** NATS: status + all valves + pumps + heaters — parallel like git HEAD. */
  private async natsTick(): Promise<void> {
    if (this.stopped || this.pauseCount > 0 || this.natsInFlight) return;
    this.natsInFlight = true;
    const gen = this.natsGeneration;
    const active = this.deps.getActiveHost();
    const errors: string[] = [];
    this.tickN += 1;
    const tick = this.tickN;
    const at = Date.now();

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

    try {
      // Клапаны ВСЕХ модулей — график coffee/water не зависит от active Lab host.
      const valveJobs = DRINKX_HOSTS.flatMap((mod) =>
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
      const heaterHosts: DrinkxHost[] = [active];
      // ШИМ тэнов на всех модулях (water тоже PID/PWM, не только ON/OFF)
      for (const h of DRINKX_HOSTS) {
        if (!heaterHosts.includes(h)) heaterHosts.push(h);
      }

      const [facadeStatus, valveResults, pumpResults, heaterResults] =
        await Promise.all([
          natsReq(NATS_SUBJECTS.status, { hwid: "dx" }, 1_200),
          Promise.all(valveJobs),
          Promise.all(
            (["milk", "coffee", "water"] as const).map(async (mod) => {
              const res = await natsReq(
                pumpStatusSubject(mod),
                { hwid: this.deps.resolveHwid(mod) },
                700
              );
              return { mod, res };
            })
          ),
          Promise.all(
            heaterHosts.flatMap((mod) =>
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

      // status / temps — facade {hwid:dx} → milkSensors/… + milkValves[]
      if (facadeStatus.ok && !natsReplyIsError(facadeStatus.data)) {
        next = this.applyStatusReplies(next, [facadeStatus.data], at);
      } else {
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
          next = this.applyStatusReplies(next, replies, at);
        } else {
          const one = await natsReq(NATS_SUBJECTS.status, {}, 1_000);
          if (this.natsAborted(gen)) {
            this.emit({ ...this.snap, pollInFlight: false });
            return;
          }
          if (one.ok) next = this.applyStatusReplies(next, [one.data], at);
          else errors.push(`status: ${one.error}`);
        }
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

      // heaters + estimated PWM (не из status *_heater*_power — это дубль temp)
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

      // Per-host NATS reachability (pump reply and/or temps from status)
      {
        const hostHealth: LabSnapshot["hostHealth"] = { ...next.hostHealth };
        const pumpOk = new Map<DrinkxHost, boolean>();
        for (const { mod, res } of pumpResults) {
          pumpOk.set(mod, res.ok && !natsReplyIsError(res.data));
        }
        const heaterOk = new Map<DrinkxHost, boolean>();
        for (const { mod, res } of heaterResults) {
          const prev = heaterOk.get(mod);
          const ok = res.ok && !natsReplyIsError(res.data);
          heaterOk.set(mod, prev === undefined ? ok : prev || ok);
        }
        for (const mod of DRINKX_HOSTS) {
          const temps = next.complexTemps[mod];
          const hasTemps = !!temps && Object.keys(temps).length > 0;
          const natsReach =
            pumpOk.get(mod) === true ||
            heaterOk.get(mod) === true ||
            hasTemps;
          const natsFail =
            pumpOk.get(mod) === false &&
            heaterOk.get(mod) !== true &&
            !hasTemps;
          const prev = hostHealth[mod];
          const natsOk: boolean | null = natsReach
            ? true
            : natsFail
              ? false
              : (prev?.natsOk ?? null);
          hostHealth[mod] = {
            natsOk,
            dxOk: prev?.dxOk ?? null,
            updatedAt: at,
          };
        }
        next = { ...next, hostHealth };
      }

      if (this.natsAborted(gen)) {
        this.emit({ ...this.snap, pollInFlight: false });
        return;
      }

      // Rebase: DX / newer cmd updates that landed during await must not be wiped.
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

  private applyStatusReplies(
    snap: LabSnapshot,
    replies: unknown[],
    at: number
  ): LabSnapshot {
    const tuple = parseComplexStatusTuple(replies);
    const complexTemps: LabSnapshot["complexTemps"] = {
      ...snap.complexTemps,
    };
    let waterPressure = snap.waterPressure;
    let waterPulses = snap.waterPulses;
    const openLists: number[][] = [];
    let valveFieldSeen = false;

    for (const host of ["milk", "coffee", "water"] as DrinkxHost[]) {
      const h = tuple.hosts[host];
      if (!h || h.sensorCount === 0) continue;
      complexTemps[host] = { ...complexTemps[host], ...h.temps };
      if (host === "water") {
        if (h.waterPressure != null) {
          waterPressure = timed(h.waterPressure, "nats", at);
        }
        if (h.waterPulses != null) {
          waterPulses = timed(h.waterPulses, "nats", at);
        }
      }
    }

    for (const raw of replies) {
      const open = extractOpenValveNumbers(raw);
      if (open !== null) {
        valveFieldSeen = true;
        openLists.push(open);
      }
      // Facade: milkValves + coffeeValves могут быть оба в одном payload
      if (raw && typeof raw === "object") {
        const r = raw as Record<string, unknown>;
        const result =
          r.result && typeof r.result === "object"
            ? (r.result as Record<string, unknown>)
            : r;
        for (const key of ["milkValves", "coffeeValves", "waterValves"] as const) {
          const v = result[key];
          if (Array.isArray(v)) {
            valveFieldSeen = true;
            openLists.push(
              v.map((x) => Number(x)).filter((n) => Number.isFinite(n))
            );
          }
        }
      }
    }

    if (
      Object.keys(complexTemps).every((k) => !complexTemps[k as DrinkxHost])
    ) {
      for (const raw of replies) {
        for (const host of ["milk", "coffee", "water"] as DrinkxHost[]) {
          const map = extractTempMap(raw, host);
          if (Object.keys(map).length === 0) continue;
          complexTemps[host] = { ...complexTemps[host], ...map };
        }
        const p = extractWaterPressure(raw);
        if (p != null) waterPressure = timed(p, "nats", at);
        const pulses = extractWaterTotalPulses(raw);
        if (pulses != null) waterPulses = timed(pulses, "nats", at);
      }
    }

    // DrinkX getStatus часто без valves → не трогаем. Явный [] = все закрыты.
    // После bus/cmd — hold, иначе status залипает на устаревшем списке.
    let milkSystemOpen = snap.milkSystemOpen;
    if (Date.now() < this.milkSystemHoldUntil) {
      // keep bus/cmd
    } else if (valveFieldSeen) {
      milkSystemOpen = timed(mergeOpenValveNumbers(...openLists), "nats", at);
    }

    return {
      ...snap,
      complexTemps,
      tempsUpdatedAt: at,
      waterPressure,
      waterPulses,
      milkSystemOpen,
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
    dx: {
      ok?: boolean;
      milk: {
        pump_R_IS: number | null;
        pump_L_IS: number | null;
        heater1_pwm?: number | null;
        heater2_pwm?: number | null;
        error?: string;
        via?: string;
      };
      coffee: {
        pump_R_IS: number | null;
        pump_L_IS: number | null;
        heater1_pwm?: number | null;
        heater2_pwm?: number | null;
        error?: string;
        via?: string;
      };
      water?: {
        pump_R_IS: number | null;
        pump_L_IS: number | null;
        heater1_pwm?: number | null;
        heater2_pwm?: number | null;
        error?: string;
        via?: string;
      };
    },
    at: number
  ): LabSnapshot {
    const pumpRis = { ...snap.pumpRis };
    const pumpLis = { ...snap.pumpLis };
    const heaterPwm = { ...snap.heaterPwm };

    for (const mod of ["milk", "coffee", "water"] as const) {
      const s = dx[mod];
      if (!s) continue;
      if (s.pump_R_IS != null) pumpRis[mod] = timed(s.pump_R_IS, "dx", at);
      if (s.pump_L_IS != null) pumpLis[mod] = timed(s.pump_L_IS, "dx", at);

      if (mod === "water") continue;
      const h = snap.heaters[mod];
      const nextHost = { ...heaterPwm[mod] };
      if (h?.heater1?.value === true && s.heater1_pwm != null) {
        nextHost.heater1 = timed(s.heater1_pwm, "dx", at);
      }
      if (h?.heater2?.value === true && s.heater2_pwm != null) {
        nextHost.heater2 = timed(s.heater2_pwm, "dx", at);
      }
      heaterPwm[mod] = nextHost;
    }

    const via = (m: "milk" | "coffee" | "water") =>
      dx[m]?.via ? `/${dx[m]!.via}` : "";
    const errs = [
      dx.milk?.error ? `milk: ${dx.milk.error}` : null,
      dx.coffee?.error ? `coffee: ${dx.coffee.error}` : null,
      dx.water?.error ? `water: ${dx.water.error}` : null,
    ].filter(Boolean);
    const has =
      dx.milk?.pump_R_IS != null ||
      dx.coffee?.pump_R_IS != null ||
      dx.water?.pump_R_IS != null;
    const dxUiStatus = has
      ? `DX UI ток · milk R=${dx.milk?.pump_R_IS?.toFixed(3) ?? "—"} L=${dx.milk?.pump_L_IS?.toFixed(3) ?? "—"}${via("milk")} · coffee R=${dx.coffee?.pump_R_IS?.toFixed(3) ?? "—"} L=${dx.coffee?.pump_L_IS?.toFixed(3) ?? "—"}${via("coffee")} · water R=${dx.water?.pump_R_IS?.toFixed(3) ?? "—"}${via("water")}`
      : errs.length
        ? `DX UI пусто: ${errs.join("; ")} · эталон milk=.44 coffee=.45 water=.46 (не .33)`
        : "DX UI: нет pump_R_IS · проверьте IP milk=.44 coffee=.45 water=.46 (не .33)";

    const hostHealth: LabSnapshot["hostHealth"] = { ...snap.hostHealth };
    for (const mod of ["milk", "coffee", "water"] as const) {
      const s = dx[mod];
      const prev = hostHealth[mod];
      let dxOk: boolean | null = prev?.dxOk ?? null;
      if (s?.pump_R_IS != null || s?.pump_L_IS != null) {
        dxOk = true;
      } else if (s?.error) {
        dxOk = false;
      }
      hostHealth[mod] = {
        natsOk: prev?.natsOk ?? null,
        dxOk,
        updatedAt: at,
      };
    }

    return {
      ...snap,
      pumpRis,
      pumpLis,
      heaterPwm,
      hostHealth,
      dxUiStatus,
      lastTickAt: has ? Math.max(snap.lastTickAt, at) : snap.lastTickAt,
    };
  }
}

export type { LabSnapshot };
