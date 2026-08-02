/**
 * Shared Modules Lab shell APIs for feature panels.
 * Single owner of telemetry/lock/log lives in ModulesPage; context only exposes them.
 */

import {
  createContext,
  useContext,
  type Dispatch,
  type MutableRefObject,
  type ReactNode,
  type SetStateAction,
} from "react";
import type {
  DrinkxHost,
  LabEvent,
  LabSnapshot,
  NatsMusterEntry,
  TempSensorKey,
} from "@service-monitor/core";
import type { LabTelemetryController } from "../LabTelemetryController";
import type { EnabledMap } from "./modulesLabTypes";

export type ModulesLabToast = { text: string; error?: boolean };

export type ModulesLabReq = (
  subject: string,
  payload?: Record<string, unknown>,
  timeoutMs?: number,
  priority?: "command" | "poll"
) => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>;

export type ModulesLabPushSensorSample = (
  mod: DrinkxHost,
  name: string,
  value: number | null,
  minDelta?: number,
  opts?: { force?: boolean; heartbeatMs?: number; digits?: number; detail?: string }
) => void;

export type ModulesLabContextValue = {
  live: boolean;
  unlocked: boolean;
  controlsDisabled: boolean;
  busy: string | null;
  setBusy: Dispatch<SetStateAction<string | null>>;
  setToast: Dispatch<SetStateAction<ModulesLabToast | null>>;
  host: DrinkxHost;
  setHost: Dispatch<SetStateAction<DrinkxHost>>;
  hwid: string;
  modules: NatsMusterEntry[];
  hostRef: MutableRefObject<DrinkxHost>;
  hwidRef: MutableRefObject<string>;
  modulesRef: MutableRefObject<NatsMusterEntry[]>;
  valves: EnabledMap;
  setValves: Dispatch<SetStateAction<EnabledMap>>;
  milkValves: EnabledMap;
  setMilkValves: Dispatch<SetStateAction<EnabledMap>>;
  pumpOn: boolean | null;
  setPumpOn: Dispatch<SetStateAction<boolean | null>>;
  heaters: EnabledMap;
  setHeaters: Dispatch<SetStateAction<EnabledMap>>;
  temps: Partial<Record<TempSensorKey, number>>;
  setTemps: Dispatch<SetStateAction<Partial<Record<TempSensorKey, number>>>>;
  complexTemps: Partial<
    Record<DrinkxHost, Partial<Record<TempSensorKey, number>>>
  >;
  heaterPwmByHost: Partial<
    Record<"milk" | "coffee" | "water", Partial<Record<string, number>>>
  >;
  setHeaterPwmByHost: Dispatch<
    SetStateAction<
      Partial<
        Record<"milk" | "coffee" | "water", Partial<Record<string, number>>>
      >
    >
  >;
  pumpPowerByHost: Partial<Record<DrinkxHost, number | null>>;
  setPumpPowerByHost: Dispatch<
    SetStateAction<Partial<Record<DrinkxHost, number | null>>>
  >;
  pumpCurrentByHost: Partial<
    Record<"milk" | "coffee" | "water", number | null>
  >;
  pumpCurrentLByHost: Partial<
    Record<"milk" | "coffee" | "water", number | null>
  >;
  dxUiStatus: string;
  waterPulses: number | null;
  waterPressure: number | null;
  /** Shared so pump UI can show «+ тены @ N°C». */
  heaterTarget: number;
  setHeaterTarget: Dispatch<SetStateAction<number>>;
  labSnap: LabSnapshot;
  labTelemetryRef: MutableRefObject<LabTelemetryController | null>;
  valveHoldUntil: MutableRefObject<Map<string, number>>;
  lastValveLog: MutableRefObject<Record<string, boolean>>;
  valvePkgAbort: MutableRefObject<AbortController | null>;
  warmupAbort: MutableRefObject<AbortController | null>;
  heaterTimers: MutableRefObject<Map<string, ReturnType<typeof setTimeout>>>;
  pollPaused: MutableRefObject<boolean>;
  pollGeneration: MutableRefObject<number>;
  scenarioBusyToken: MutableRefObject<object | null>;
  pushLab: (
    kind: LabEvent["kind"],
    name: string,
    value: LabEvent["value"],
    detail?: string,
    moduleOverride?: DrinkxHost | string
  ) => void;
  pushSensorSample: ModulesLabPushSensorSample;
  req: ModulesLabReq;
  withCommandLock: <T>(fn: () => Promise<T>) => Promise<T>;
  ensureValve: (
    baseId: string,
    enabled: boolean
  ) => Promise<{ ok: boolean; enabled?: boolean; error?: string }>;
  withHwid: (payload?: Record<string, unknown>) => Record<string, unknown>;
  refreshDevices: () => void;
  pollDxPumpCurrents: () => void;
  requireLabUnlock: () => boolean;
  setShowCharts: Dispatch<SetStateAction<boolean>>;
  setShowSensorCharts: Dispatch<SetStateAction<boolean>>;
  /** Pump API (registered by ModulePumpPanel). */
  startPump: (
    direction?: "forward" | "reverse",
    opts?: { durationMs?: number }
  ) => Promise<void>;
  registerStartPump: (
    fn: (
      direction?: "forward" | "reverse",
      opts?: { durationMs?: number }
    ) => Promise<void>
  ) => void;
  /** Heaters→pump coupling (registered by ModuleHeatersPanel). */
  startHeatersForPump: (
    session: number,
    isSessionCurrent: () => boolean
  ) => Promise<void>;
  registerStartHeatersForPump: (
    fn: (
      session: number,
      isSessionCurrent: () => boolean
    ) => Promise<void>
  ) => void;
};

const ModulesLabContext = createContext<ModulesLabContextValue | null>(null);

export function ModulesLabProvider(props: {
  value: ModulesLabContextValue;
  children: ReactNode;
}) {
  return (
    <ModulesLabContext.Provider value={props.value}>
      {props.children}
    </ModulesLabContext.Provider>
  );
}

export function useModulesLab(): ModulesLabContextValue {
  const ctx = useContext(ModulesLabContext);
  if (!ctx) {
    throw new Error("useModulesLab must be used within ModulesLabProvider");
  }
  return ctx;
}
