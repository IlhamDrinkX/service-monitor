/**
 * Apply LabTelemetryController snapshot + valves bus → UI mirrors / lab log.
 * Single bus subscribe owner (do not duplicate in panels).
 */

import { useEffect, useState, type MutableRefObject } from "react";
import {
  COMPLEXOS_SUBJECTS,
  DRINKX_HOSTS,
  MODULE_VALVES,
  expectedTempKeys,
  mergeOpenValveNumbers,
  milkSystemValveId,
  parseSeriesKey,
  seriesKey,
  type DrinkxHost,
  type LabEvent,
  type LabSnapshot,
  type TempSensorKey,
} from "@service-monitor/core";
import type { LabTelemetryController } from "../LabTelemetryController";
import type { EnabledMap } from "./modulesLabTypes";
import type { ModulesLabPushSensorSample } from "./ModulesLabContext";
import {
  milkValvesMapFromOpen,
  milkValvesMapFromOpenList,
} from "./modulesLabTelemetryHelpers";
import { parseValvesSwitchedNumbers } from "./modulesLabNatsHelpers";

export function useModulesLabTelemetryBridge(opts: {
  live: boolean;
  labSnap: LabSnapshot;
  hostRef: MutableRefObject<DrinkxHost>;
  valveHoldUntil: MutableRefObject<Map<string, number>>;
  lastValveLog: MutableRefObject<Record<string, boolean>>;
  labTelemetryRef: MutableRefObject<LabTelemetryController | null>;
  pushLab: (
    kind: LabEvent["kind"],
    name: string,
    value: LabEvent["value"],
    detail?: string,
    moduleOverride?: DrinkxHost | string
  ) => void;
  pushSensorSample: ModulesLabPushSensorSample;
}) {
  const [valves, setValves] = useState<EnabledMap>({});
  const [pumpOn, setPumpOn] = useState<boolean | null>(null);
  const [heaters, setHeaters] = useState<EnabledMap>({});
  const [milkValves, setMilkValves] = useState<EnabledMap>({});
  const [temps, setTemps] = useState<Partial<Record<TempSensorKey, number>>>(
    {}
  );
  const [complexTemps, setComplexTemps] = useState<
    Partial<Record<DrinkxHost, Partial<Record<TempSensorKey, number>>>>
  >({});
  const [pumpCurrentByHost, setPumpCurrentByHost] = useState<
    Partial<Record<"milk" | "coffee" | "water", number | null>>
  >({});
  const [pumpCurrentLByHost, setPumpCurrentLByHost] = useState<
    Partial<Record<"milk" | "coffee" | "water", number | null>>
  >({});
  const [heaterPwmByHost, setHeaterPwmByHost] = useState<
    Partial<Record<"milk" | "coffee" | "water", Partial<Record<string, number>>>>
  >({});
  const [dxUiStatus, setDxUiStatus] = useState<string>("");
  const [pumpPowerByHost, setPumpPowerByHost] = useState<
    Partial<Record<DrinkxHost, number | null>>
  >({});
  const [waterPulses, setWaterPulses] = useState<number | null>(null);
  const [waterPressure, setWaterPressure] = useState<number | null>(null);

  const {
    live,
    labSnap,
    hostRef,
    valveHoldUntil,
    lastValveLog,
    labTelemetryRef,
    pushLab,
    pushSensorSample,
  } = opts;

  /** Применить снимок телеметрии → UI + графики. */
  useEffect(() => {
    if (!live || labSnap.lastTickAt === 0) return;
    const active = hostRef.current;

    const natsDown = (mod: DrinkxHost) =>
      labSnap.hostHealth[mod]?.natsOk === false;
    const dxDown = (mod: DrinkxHost) =>
      labSnap.hostHealth[mod]?.dxOk === false;

    // Temps / water — только при живом NATS (иначе не реанимируем last-known).
    const nextComplex = { ...labSnap.complexTemps };
    for (const mod of DRINKX_HOSTS) {
      if (natsDown(mod)) delete nextComplex[mod];
    }
    setComplexTemps(nextComplex);
    if (!natsDown(active) && nextComplex[active]) {
      setTemps(nextComplex[active] ?? {});
    } else if (natsDown(active)) {
      setTemps({});
    }

    if (!natsDown("water") && labSnap.waterPressure) {
      setWaterPressure(labSnap.waterPressure.value);
      pushSensorSample(
        "water",
        "waterPressure",
        labSnap.waterPressure.value,
        0.02
      );
    }
    if (!natsDown("water") && labSnap.waterPulses) {
      setWaterPulses(labSnap.waterPulses.value);
      pushSensorSample(
        "water",
        "waterTotalPulses",
        labSnap.waterPulses.value,
        1
      );
    }
    if (natsDown("water")) {
      setWaterPressure(null);
      setWaterPulses(null);
    }

    for (const mod of DRINKX_HOSTS) {
      if (natsDown(mod)) continue;
      const tempsMod = labSnap.complexTemps[mod];
      if (!tempsMod) continue;
      for (const [key, val] of Object.entries(tempsMod)) {
        if (typeof val === "number") pushSensorSample(mod, key, val);
      }
    }

    const pumpTv = labSnap.pumpOn[active];
    if (pumpTv) setPumpOn(pumpTv.value);

    // Насосы всех модулей → история ON/OFF для графиков (как клапаны)
    for (const mod of DRINKX_HOSTS) {
      if (natsDown(mod)) continue;
      const tv = labSnap.pumpOn[mod];
      if (!tv) continue;
      const logKey = seriesKey(mod, "pump");
      const prev = lastValveLog.current[logKey];
      if (prev === tv.value) continue;
      lastValveLog.current[logKey] = tv.value;
      pushLab("pump", "pump", tv.value, `poll ${tv.source}`, mod);
    }

    setPumpPowerByHost((prev) => {
      const next = { ...prev };
      for (const mod of DRINKX_HOSTS) {
        if (natsDown(mod)) {
          next[mod] = null;
          continue;
        }
        const p = labSnap.pumpPower[mod];
        if (p) next[mod] = p.value;
      }
      return next;
    });
    for (const mod of DRINKX_HOSTS) {
      if (natsDown(mod)) continue;
      const p = labSnap.pumpPower[mod];
      if (p) pushSensorSample(mod, "pumpPower", p.value, 0.5);
    }

    setHeaters((prev) => {
      const next = { ...prev };
      const hh = labSnap.heaters[active];
      if (hh?.heater1) next.heater1 = hh.heater1.value;
      if (hh?.heater2) next.heater2 = hh.heater2.value;
      return next;
    });

    setHeaterPwmByHost((prev) => {
      const next = { ...prev };
      for (const mod of DRINKX_HOSTS) {
        if (natsDown(mod)) {
          next[mod] = {};
          continue;
        }
        const pwm = labSnap.heaterPwm[mod];
        if (!pwm) continue;
        next[mod] = {
          ...next[mod],
          ...(pwm.heater1 ? { heater1: pwm.heater1.value } : {}),
          ...(pwm.heater2 ? { heater2: pwm.heater2.value } : {}),
        };
      }
      return next;
    });
    for (const mod of DRINKX_HOSTS) {
      if (natsDown(mod)) continue;
      const pwm = labSnap.heaterPwm[mod];
      if (!pwm) continue;
      if (pwm.heater1) pushSensorSample(mod, "heater1_pwm", pwm.heater1.value, 0.5);
      if (pwm.heater2) pushSensorSample(mod, "heater2_pwm", pwm.heater2.value, 0.5);
    }

    setPumpCurrentByHost((prev) => {
      const next = { ...prev };
      for (const mod of ["milk", "coffee", "water"] as const) {
        if (dxDown(mod)) {
          next[mod] = null;
          continue;
        }
        const v = labSnap.pumpRis[mod];
        if (v) next[mod] = v.value;
      }
      return next;
    });
    setPumpCurrentLByHost((prev) => {
      const next = { ...prev };
      for (const mod of ["milk", "coffee", "water"] as const) {
        if (dxDown(mod)) {
          next[mod] = null;
          continue;
        }
        const v = labSnap.pumpLis[mod];
        if (v) next[mod] = v.value;
      }
      return next;
    });
    for (const mod of ["milk", "coffee", "water"] as const) {
      if (dxDown(mod)) continue;
      const r = labSnap.pumpRis[mod];
      const l = labSnap.pumpLis[mod];
      if (r) pushSensorSample(mod, "pumpCurrent", r.value, 0.01);
      if (l) pushSensorSample(mod, "pumpCurrentL", l.value, 0.01);
    }

    if (labSnap.dxUiStatus) setDxUiStatus(labSnap.dxUiStatus);

    // DX клапаны всех модулей → UI активного + история ON/OFF для графиков
    setValves((prev) => {
      const next = { ...prev };
      const now = Date.now();
      const host = hostRef.current;
      for (const baseId of MODULE_VALVES[host]) {
        const key = seriesKey(host, baseId);
        const tv = labSnap.valves[key] ?? labSnap.valves[baseId];
        if (!tv) continue;
        const hold =
          valveHoldUntil.current.get(key) ??
          valveHoldUntil.current.get(baseId) ??
          0;
        if (hold > now) continue;
        next[baseId] = tv.value;
      }
      return next;
    });
    for (const [key, tv] of Object.entries(labSnap.valves)) {
      if (!tv) continue;
      const parsed = parseSeriesKey(key);
      const mod =
        parsed.module === "milk" ||
        parsed.module === "coffee" ||
        parsed.module === "water"
          ? parsed.module
          : hostRef.current;
      const baseId = parsed.module ? parsed.name : key;
      const logKey = seriesKey(mod, baseId);
      const prev = lastValveLog.current[logKey];
      if (prev === tv.value) continue;
      lastValveLog.current[logKey] = tv.value;
      pushLab("valve", baseId, tv.value, `poll ${tv.source}`, mod);
    }

    // Молочные клапана холодильника (1…6)
    if (labSnap.milkSystemOpen) {
      const open = new Set(labSnap.milkSystemOpen.value);
      setMilkValves((prev) => milkValvesMapFromOpen(open, prev));
      for (let n = 1; n <= 6; n++) {
        const id = milkSystemValveId(n)!;
        const on = open.has(n);
        const logKey = seriesKey("milk", id);
        if (lastValveLog.current[logKey] === on) continue;
        lastValveLog.current[logKey] = on;
        pushLab("valve", id, on, `ms ${labSnap.milkSystemOpen.source}`, "milk");
      }
    }

    // Явные gap-маркеры в лог (кривая рвётся; readout → «—»).
    for (const mod of DRINKX_HOSTS) {
      if (natsDown(mod)) {
        for (const key of expectedTempKeys(mod)) {
          pushSensorSample(mod, key, null, 0, { detail: "nats gap" });
        }
        pushSensorSample(mod, "pumpPower", null, 0, { detail: "nats gap" });
        pushSensorSample(mod, "heater1_pwm", null, 0, { detail: "nats gap" });
        pushSensorSample(mod, "heater2_pwm", null, 0, { detail: "nats gap" });
        if (mod === "water") {
          pushSensorSample("water", "waterPressure", null, 0, {
            detail: "nats gap",
          });
          pushSensorSample("water", "waterTotalPulses", null, 0, {
            detail: "nats gap",
          });
        }
      }
      if (dxDown(mod)) {
        pushSensorSample(mod, "pumpCurrent", null, 0, { detail: "dx gap" });
        pushSensorSample(mod, "pumpCurrentL", null, 0, { detail: "dx gap" });
      }
    }
  }, [
    live,
    labSnap,
    pushSensorSample,
    pushLab,
    hostRef,
    valveHoldUntil,
    lastValveLog,
  ]);

  // complexos.valves.switched — live во время brew с киоска
  useEffect(() => {
    if (!live) {
      void window.desktop.natsUnsubscribeBus?.("lab");
      return;
    }
    let cancelled = false;
    void window.desktop
      .natsSubscribeBus?.([COMPLEXOS_SUBJECTS.valvesSwitched], "lab")
      .catch((e) => console.warn("[modules] valves bus", e));
    const off =
      typeof window.desktop.onNatsBus === "function"
        ? window.desktop.onNatsBus((msg) => {
            if (cancelled) return;
            if (msg.subject !== COMPLEXOS_SUBJECTS.valvesSwitched) return;
            const data = msg.data as { valves?: unknown; nozzleId?: unknown };
            const raw = parseValvesSwitchedNumbers(data);
            const open = mergeOpenValveNumbers(raw);
            labTelemetryRef.current?.setMilkSystemOpen(open, "nats");
            // Immediate UI (snap tick may lag)
            setMilkValves(() => milkValvesMapFromOpenList(open));
            for (let n = 1; n <= 6; n++) {
              const id = milkSystemValveId(n)!;
              const on = open.includes(n);
              const logKey = seriesKey("milk", id);
              if (lastValveLog.current[logKey] === on) continue;
              lastValveLog.current[logKey] = on;
              pushLab(
                "valve",
                id,
                on,
                `bus nozzle=${String(data?.nozzleId ?? "?")}`,
                "milk"
              );
            }
          })
        : () => undefined;
    return () => {
      cancelled = true;
      off();
      void window.desktop.natsUnsubscribeBus?.("lab");
    };
  }, [live, pushLab, labTelemetryRef, lastValveLog]);

  return {
    valves,
    setValves,
    pumpOn,
    setPumpOn,
    heaters,
    setHeaters,
    milkValves,
    setMilkValves,
    temps,
    setTemps,
    complexTemps,
    setComplexTemps,
    pumpCurrentByHost,
    setPumpCurrentByHost,
    pumpCurrentLByHost,
    setPumpCurrentLByHost,
    heaterPwmByHost,
    setHeaterPwmByHost,
    dxUiStatus,
    setDxUiStatus,
    pumpPowerByHost,
    setPumpPowerByHost,
    waterPulses,
    setWaterPulses,
    waterPressure,
    setWaterPressure,
  };
}
