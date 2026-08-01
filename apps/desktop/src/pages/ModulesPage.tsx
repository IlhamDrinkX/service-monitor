/**
 * Встроенный Industrial Service Control (без отдельного окна module_test).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DRINKX_HOSTS,
  FLOW_CALIBRATION_BREW_TIMEOUT_MS,
  FLOW_CALIBRATION_PULSES_POLL_MS,
  FLOW_CALIBRATION_QTYS,
  FLOW_CALIBRATION_SWITCH_DELAY_MS,
  HEATER_IDS,
  HEATER_AUTO_STOP_MS,
  HEATER_LABELS,
  HEATER_TARGET_C,
  HEATER_WARMUP_DEFAULTS,
  MODULE_VALVES,
  NATS_SUBJECTS,
  TEMP_SENSOR_LABELS,
  VALVE_LABELS,
  VALVE_PACKAGES,
  chartSeriesMeta,
  complexSensorCatalog,
  complexTupleSummary,
  createLabEvent,
  defaultHwid,
  expectedTempKeys,
  extractEnabledState,
  extractPumpCurrent,
  extractTempMap,
  extractWaterPressure,
  extractWaterTotalPulses,
  estimateHeaterPwmPercent,
  formatLabTerminalLine,
  getValvePackage,
  heaterCommandSubject,
  heaterStopSubject,
  isTelemetryStale,
  labEventsToCsv,
  milkSystemValveNumbers,
  parseComplexStatusTuple,
  pumpCommandPayload,
  pumpCommandSubject,
  pumpStopSubject,
  seriesKey,
  STALE_MS,
  valveCommandSubject,
  valveStatusSubject,
  warmupOverheatKey,
  warmupSensorKey,
  TERMINAL_PAYLOAD_PRESETS,
  TERMINAL_PAYLOAD_RULES,
  TERMINAL_SUBJECT_PRESETS,
  associatedPayloadIds,
  findSubjectPresetFor,
  BREW_LAB_DEFAULTS,
  buildBrewLabPayload,
  scenariosForHost,
  type BrewLabPartType,
  type DrinkxHost,
  type LabEvent,
  type LabScenario,
  type NatsConnectionInfo,
  type NatsMusterEntry,
  type TempSensorKey,
  type ValvePackageId,
} from "@service-monitor/core";
import { ActionButton } from "../components/ActionButton";
import { HelpTip } from "../components/HelpTip";
import { ModulesLabCharts } from "../components/ModulesLabCharts";
import { useLabTelemetry } from "../lab/useLabTelemetry";
import { onEnterNavigate } from "../lib/form-nav";
import { smLog } from "../lib/sm-log";
import { useComplexSession } from "../state/useComplexSession";

type EnabledMap = Record<string, boolean | null>;

type CalibRow = {
  qty: number;
  pulses?: number;
  actualMl?: number;
  flowFactor?: number;
};

type LabTrackState = {
  modules: Record<DrinkxHost, boolean>;
  /** false = выключен; отсутствие ключа = включен */
  sensors: Record<string, boolean>;
};

const LAB_TRACK_KEY = "sm.labTrack.v1";
const TERM_CUSTOM_SUBJECTS_KEY = "sm.term.customSubjects.v2";
const TERM_CUSTOM_PAYLOADS_KEY = "sm.term.customPayloads.v2";
const TERM_CUSTOM_SUBJECTS_LEGACY = "sm.term.customSubjects.v1";
const TERM_CUSTOM_PAYLOADS_LEGACY = "sm.term.customPayloads.v1";

type CustomSubject = {
  subject: string;
  label: string;
  /** builtin payload id или `custom:<id>` */
  payloadIds: string[];
};
type CustomPayload = {
  id: string;
  label: string;
  description: string;
  payloadJson: string;
};

function normalizeCustomSubject(raw: unknown): CustomSubject | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.subject !== "string" || !o.subject.trim()) return null;
  const payloadIds = Array.isArray(o.payloadIds)
    ? o.payloadIds.filter((x): x is string => typeof x === "string")
    : [];
  return {
    subject: o.subject.trim(),
    label: typeof o.label === "string" && o.label ? o.label : o.subject.trim(),
    payloadIds,
  };
}

function loadCustomSubjects(): CustomSubject[] {
  try {
    const raw =
      localStorage.getItem(TERM_CUSTOM_SUBJECTS_KEY) ??
      localStorage.getItem(TERM_CUSTOM_SUBJECTS_LEGACY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeCustomSubject)
      .filter((x): x is CustomSubject => x != null)
      .slice(0, 40);
  } catch {
    return [];
  }
}

function saveCustomSubjects(list: CustomSubject[]) {
  localStorage.setItem(TERM_CUSTOM_SUBJECTS_KEY, JSON.stringify(list.slice(0, 40)));
}

function loadCustomPayloads(): CustomPayload[] {
  try {
    const raw =
      localStorage.getItem(TERM_CUSTOM_PAYLOADS_KEY) ??
      localStorage.getItem(TERM_CUSTOM_PAYLOADS_LEGACY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CustomPayload[];
    return Array.isArray(parsed) ? parsed.slice(0, 40) : [];
  } catch {
    return [];
  }
}

function saveCustomPayloads(list: CustomPayload[]) {
  localStorage.setItem(TERM_CUSTOM_PAYLOADS_KEY, JSON.stringify(list.slice(0, 40)));
}

function currentPayloadPickId(
  termPayloadPick: string,
  termCmd: string,
  customPayloads: CustomPayload[]
): string | null {
  if (termPayloadPick.startsWith("custom:")) return termPayloadPick;
  if (termPayloadPick !== "__custom__" && termPayloadPick) return termPayloadPick;
  const raw = termCmd.trim() || "{}";
  const found = customPayloads.find((p) => p.payloadJson.trim() === raw);
  return found ? `custom:${found.id}` : null;
}

function defaultLabTrack(): LabTrackState {
  return {
    modules: { milk: true, coffee: true, water: true },
    sensors: {},
  };
}

function loadLabTrack(): LabTrackState {
  try {
    const raw = sessionStorage.getItem(LAB_TRACK_KEY);
    if (!raw) return defaultLabTrack();
    const parsed = JSON.parse(raw) as LabTrackState;
    const modules = { ...defaultLabTrack().modules, ...parsed.modules };
    // Если всё выключено — сброс (иначе пустые датчики/лог).
    if (!modules.milk && !modules.coffee && !modules.water) {
      return defaultLabTrack();
    }
    return {
      modules,
      sensors: parsed.sensors ?? {},
    };
  } catch {
    return defaultLabTrack();
  }
}

function saveLabTrack(t: LabTrackState): void {
  try {
    sessionStorage.setItem(LAB_TRACK_KEY, JSON.stringify(t));
  } catch {
    // ignore
  }
}

function resolveHwid(
  target: DrinkxHost,
  modules: NatsMusterEntry[]
): string {
  const match = modules.find(
    (m) =>
      m.hwid === defaultHwid(target) ||
      m.role === target ||
      (m.hwid ?? "").includes(target)
  );
  return match?.hwid || defaultHwid(target);
}

/** Если текущий модуль не в muster — берём первый онлайн (coffee → water → milk). */
function pickHostFromMuster(
  modules: NatsMusterEntry[],
  current: DrinkxHost
): DrinkxHost {
  const online = new Set<DrinkxHost>();
  for (const m of modules) {
    for (const h of DRINKX_HOSTS) {
      if (
        m.role === h ||
        m.hwid === defaultHwid(h) ||
        (m.hwid ?? "").toLowerCase().includes(h)
      ) {
        online.add(h);
      }
    }
  }
  if (online.size === 0 || online.has(current)) return current;
  for (const h of ["coffee", "water", "milk"] as DrinkxHost[]) {
    if (online.has(h)) return h;
  }
  return current;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function ModulesPage() {
  const { session, warn } = useComplexSession();
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(
    null
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [nats, setNats] = useState<NatsConnectionInfo>({
    connected: false,
    server: null,
    message: "NATS не подключён",
  });
  const [host, setHost] = useState<DrinkxHost>("milk");
  const [hwid, setHwid] = useState(defaultHwid("milk"));
  const [modules, setModules] = useState<NatsMusterEntry[]>([]);
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
    Partial<Record<"milk" | "coffee", number | null>>
  >({});
  const [pumpCurrentLByHost, setPumpCurrentLByHost] = useState<
    Partial<Record<"milk" | "coffee", number | null>>
  >({});
  const [heaterPwmByHost, setHeaterPwmByHost] = useState<
    Partial<Record<"milk" | "coffee" | "water", Partial<Record<string, number>>>>
  >({});
  const [dxUiStatus, setDxUiStatus] = useState<string>("");
  const [pumpPowerByHost, setPumpPowerByHost] = useState<
    Partial<Record<DrinkxHost, number | null>>
  >({});
  const [sensorModulesVisible, setSensorModulesVisible] = useState<
    Record<DrinkxHost, boolean>
  >({ milk: true, coffee: true, water: true });
  const [mutedSensorKeys, setMutedSensorKeys] = useState<string[]>([]);
  const [waterPulses, setWaterPulses] = useState<number | null>(null);
  const [waterPressure, setWaterPressure] = useState<number | null>(null);
  const [pumpDuration, setPumpDuration] = useState(3000);
  const [pumpPower, setPumpPower] = useState(100);
  const [pumpWithHeaters, setPumpWithHeaters] = useState(true);
  const [heaterTarget, setHeaterTarget] = useState(HEATER_TARGET_C);
  const [heaterAutoStopSec, setHeaterAutoStopSec] = useState(
    HEATER_AUTO_STOP_MS / 1000
  );
  const [valvePackageId, setValvePackageId] =
    useState<ValvePackageId>("sequential_cycle");
  const [warmupMaxOut, setWarmupMaxOut] = useState(
    HEATER_WARMUP_DEFAULTS.maxOutC
  );
  const [warmupStatus, setWarmupStatus] = useState("");
  const [foamTemp, setFoamTemp] = useState(65);
  const [foamAir, setFoamAir] = useState(35);
  const [brewHwid, setBrewHwid] = useState<string>("dx");
  const [brewType, setBrewType] = useState<BrewLabPartType>("coffee");
  const [brewQtyMs, setBrewQtyMs] = useState(BREW_LAB_DEFAULTS.qtyMs);
  const [brewTempC, setBrewTempC] = useState(BREW_LAB_DEFAULTS.tempC);
  const [brewAddMilk, setBrewAddMilk] = useState(false);
  const [brewMilkQtyMs, setBrewMilkQtyMs] = useState(8000);
  const [brewMilkTempC, setBrewMilkTempC] = useState(65);
  const [calibRows, setCalibRows] = useState<CalibRow[]>(
    FLOW_CALIBRATION_QTYS.map((qty) => ({ qty }))
  );
  const [calibLog, setCalibLog] = useState("");
  const [calibStatus, setCalibStatus] = useState("");
  const [labEvents, setLabEvents] = useState<LabEvent[]>([]);
  const [showCharts, setShowCharts] = useState(false);
  const [showSensorCharts, setShowSensorCharts] = useState(false);
  const [labTrack, setLabTrack] = useState<LabTrackState>(() => loadLabTrack());
  const [showTrackPanel, setShowTrackPanel] = useState(false);
  const [termCmd, setTermCmd] = useState("{}");
  const [termSubject, setTermSubject] = useState(NATS_SUBJECTS.status);
  const [termSubjectPick, setTermSubjectPick] = useState("cm-status");
  const [termPayloadPick, setTermPayloadPick] = useState("empty");
  const [customSubjects, setCustomSubjects] = useState<CustomSubject[]>(() =>
    typeof localStorage !== "undefined" ? loadCustomSubjects() : []
  );
  const [customPayloads, setCustomPayloads] = useState<CustomPayload[]>(() =>
    typeof localStorage !== "undefined" ? loadCustomPayloads() : []
  );
  const [showPayloadRules, setShowPayloadRules] = useState(false);
  const terminalRef = useRef<HTMLPreElement | null>(null);
  const termStickBottomRef = useRef(true);
  const termSubjectInputRef = useRef<HTMLInputElement | null>(null);
  const termPayloadInputRef = useRef<HTMLTextAreaElement | null>(null);
  const termSendBtnRef = useRef<HTMLButtonElement | null>(null);
  const pumpPowerRef = useRef<HTMLInputElement | null>(null);
  const heaterTargetRef = useRef<HTMLInputElement | null>(null);
  const heaterMaxOutRef = useRef<HTMLInputElement | null>(null);
  const heaterAutoStopRef = useRef<HTMLInputElement | null>(null);
  const warmupBtnRef = useRef<HTMLButtonElement | null>(null);
  const pollPaused = useRef(false);
  const pollGeneration = useRef(0);
  const scenarioBusyToken = useRef<object | null>(null);
  const autoNatsTried = useRef(false);
  const heaterTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );
  /** Инкремент отменяет in-flight startPump (STOP во время тэнов). */
  const pumpSessionRef = useRef(0);
  const pumpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commandLock = useRef(Promise.resolve());
  const lastSensorLog = useRef<Record<string, number>>({});
  const valvePkgAbort = useRef<AbortController | null>(null);
  const warmupAbort = useRef<AbortController | null>(null);
  /** Не затирать состояние клапана опросом сразу после команды. */
  const valveHoldUntil = useRef<Map<string, number>>(new Map());
  const hwidRef = useRef(hwid);
  hwidRef.current = hwid;
  const hostRef = useRef(host);
  hostRef.current = host;
  const modulesRef = useRef(modules);
  modulesRef.current = modules;
  const labTrackRef = useRef(labTrack);
  labTrackRef.current = labTrack;

  const isModuleTracked = useCallback((mod: DrinkxHost) => {
    return labTrackRef.current.modules[mod] !== false;
  }, []);

  const isSensorTracked = useCallback((mod: DrinkxHost, name: string) => {
    if (!isModuleTracked(mod)) return false;
    const key = seriesKey(mod, name);
    return labTrackRef.current.sensors[key] !== false;
  }, [isModuleTracked]);

  const updateLabTrack = useCallback((next: LabTrackState) => {
    setLabTrack(next);
    saveLabTrack(next);
  }, []);

  const pushLab = useCallback(
    (
      kind: LabEvent["kind"],
      name: string,
      value: LabEvent["value"],
      detail?: string,
      moduleOverride?: DrinkxHost | string
    ) => {
      const mod = moduleOverride ?? hostRef.current;
      const ev = createLabEvent({
        kind,
        module: mod,
        hwid:
          typeof mod === "string" &&
          (mod === "milk" || mod === "coffee" || mod === "water")
            ? resolveHwid(mod, modulesRef.current)
            : hwidRef.current,
        name,
        value,
        detail,
      });
      setLabEvents((prev) => {
        const next = [...prev, ev];
        return next.length > 4000 ? next.slice(-4000) : next;
      });
    },
    []
  );

  const pushSensorSample = useCallback(
    (
      mod: DrinkxHost,
      name: string,
      value: number,
      minDelta = 0.15,
      opts?: { force?: boolean; heartbeatMs?: number; digits?: number }
    ) => {
      // pumpCurrent* / pumpPower / heater*_pwm / water pressure+pulses всегда пишем.
      const critical =
        name === "pumpCurrent" ||
        name === "pumpCurrentL" ||
        name === "pumpPower" ||
        name === "heater1_pwm" ||
        name === "heater2_pwm" ||
        name === "waterPressure" ||
        name === "waterTotalPulses";
      if (!opts?.force && !critical && !isSensorTracked(mod, name)) return;
      const key = seriesKey(mod, name);
      const prev = lastSensorLog.current[key];
      const now = Date.now();
      const heartbeat =
        opts?.heartbeatMs ??
        (critical
          ? name === "waterTotalPulses" || name === "waterPressure"
            ? 1_500
            : 1_200
          : 5_000);
      const delta =
        name === "pumpCurrent" || name === "pumpCurrentL"
          ? Math.min(minDelta, 0.005)
          : name === "waterTotalPulses"
            ? Math.min(minDelta, 1)
            : minDelta;
      const changed =
        prev == null ||
        Math.abs(prev - value) >= delta ||
        now - (lastSensorLog.current[`${key}__t`] ?? 0) > heartbeat;
      if (!changed) return;
      lastSensorLog.current[key] = value;
      lastSensorLog.current[`${key}__t`] = now;
      const digits =
        opts?.digits ??
        (name === "pumpCurrent" || name === "pumpCurrentL" ? 3 : 2);
      pushLab("sensor", name, Number(value.toFixed(digits)), undefined, mod);
    },
    [isSensorTracked, pushLab]
  );

  const terminalText = useMemo(
    () =>
      labEvents
        .slice(-400)
        .map(formatLabTerminalLine)
        .join("\n"),
    [labEvents]
  );

  useEffect(() => {
    const el = terminalRef.current;
    if (!el) return;
    if (termStickBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [terminalText]);

  function onTerminalScroll() {
    const el = terminalRef.current;
    if (!el) return;
    termStickBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }

  const sessionOk = session.connected === true;
  /** Probe может мигать — к NATS пробуем при живой сессии + natsUrl. */
  const canTryNats = sessionOk && !!session.natsUrl;
  const live = nats.connected;
  const unlocked =
    typeof sessionStorage !== "undefined" &&
    sessionStorage.getItem("sm.writeUnlocked") === "1";

  const { snap: labSnap, controllerRef: labTelemetryRef } = useLabTelemetry({
    live,
    getActiveHost: () => hostRef.current,
    resolveHwid: (h) => resolveHwid(h, modulesRef.current),
    getSessionMode: () => session.mode,
    valveHoldUntil: valveHoldUntil.current,
  });

  /** Применить снимок телеметрии → UI + графики. */
  useEffect(() => {
    if (!live || labSnap.lastTickAt === 0) return;
    const active = hostRef.current;

    setComplexTemps(labSnap.complexTemps);
    if (labSnap.complexTemps[active]) {
      setTemps(labSnap.complexTemps[active] ?? {});
    }
    if (labSnap.waterPressure) setWaterPressure(labSnap.waterPressure.value);
    if (labSnap.waterPulses) setWaterPulses(labSnap.waterPulses.value);
    if (labSnap.waterPressure) {
      pushSensorSample(
        "water",
        "waterPressure",
        labSnap.waterPressure.value,
        0.02
      );
    }
    if (labSnap.waterPulses) {
      pushSensorSample(
        "water",
        "waterTotalPulses",
        labSnap.waterPulses.value,
        1
      );
    }

    for (const mod of DRINKX_HOSTS) {
      const temps = labSnap.complexTemps[mod];
      if (!temps) continue;
      for (const [key, val] of Object.entries(temps)) {
        if (typeof val === "number") pushSensorSample(mod, key, val);
      }
    }

    const pumpTv = labSnap.pumpOn[active];
    if (pumpTv) setPumpOn(pumpTv.value);

    setPumpPowerByHost((prev) => {
      const next = { ...prev };
      for (const mod of DRINKX_HOSTS) {
        const p = labSnap.pumpPower[mod];
        if (p) next[mod] = p.value;
      }
      return next;
    });
    for (const mod of DRINKX_HOSTS) {
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
      const pwm = labSnap.heaterPwm[mod];
      if (!pwm) continue;
      if (pwm.heater1) pushSensorSample(mod, "heater1_pwm", pwm.heater1.value, 0.5);
      if (pwm.heater2) pushSensorSample(mod, "heater2_pwm", pwm.heater2.value, 0.5);
    }

    setPumpCurrentByHost((prev) => {
      const next = { ...prev };
      for (const mod of ["milk", "coffee"] as const) {
        const v = labSnap.pumpRis[mod];
        if (v) next[mod] = v.value;
      }
      return next;
    });
    setPumpCurrentLByHost((prev) => {
      const next = { ...prev };
      for (const mod of ["milk", "coffee"] as const) {
        const v = labSnap.pumpLis[mod];
        if (v) next[mod] = v.value;
      }
      return next;
    });
    for (const mod of ["milk", "coffee"] as const) {
      const r = labSnap.pumpRis[mod];
      const l = labSnap.pumpLis[mod];
      if (r) pushSensorSample(mod, "pumpCurrent", r.value, 0.01);
      if (l) pushSensorSample(mod, "pumpCurrentL", l.value, 0.01);
    }

    if (labSnap.dxUiStatus) setDxUiStatus(labSnap.dxUiStatus);

    setValves((prev) => {
      const next = { ...prev };
      const now = Date.now();
      const allowed = new Set(MODULE_VALVES[hostRef.current]);
      for (const [baseId, tv] of Object.entries(labSnap.valves)) {
        if (!allowed.has(baseId)) continue;
        const hold = valveHoldUntil.current.get(baseId) ?? 0;
        if (hold > now) continue;
        if (tv) next[baseId] = tv.value;
      }
      return next;
    });
  }, [live, labSnap, pushSensorSample]);

  const refreshDevices = useCallback(() => {
    labTelemetryRef.current?.kick();
  }, [labTelemetryRef]);

  const pollDxPumpCurrents = useCallback(() => {
    labTelemetryRef.current?.kickDx();
  }, [labTelemetryRef]);

  useEffect(() => {
    void window.desktop.natsInfo().then(setNats).catch(() => undefined);
    return window.desktop.onNatsState(setNats);
  }, []);

  useEffect(() => {
    setHwid(resolveHwid(host, modulesRef.current));
    setValves({});
    setPumpOn(null);
    setHeaters({});
    setMilkValves({});
    setTemps({});
    // complexTemps / pressure / pulses — не сбрасываем (комплекс).
    setCalibRows(FLOW_CALIBRATION_QTYS.map((qty) => ({ qty })));
    setCalibLog("");
    setCalibStatus("");
    valveHoldUntil.current.clear();
    labTelemetryRef.current?.onHostChange();
  }, [host, labTelemetryRef]);

  const withHwid = useCallback(
    (payload: Record<string, unknown> = {}) => ({
      hwid: hwidRef.current,
      ...payload,
    }),
    []
  );

  const req = useCallback(
    async (
      subject: string,
      payload: Record<string, unknown> = {},
      timeoutMs = 2_000,
      priority: "command" | "poll" = "command"
    ) => {
      try {
        return await window.desktop.natsRequest({
          subject,
          payload: withHwid(payload),
          timeoutMs,
          priority,
        });
      } catch (e) {
        return { ok: false as const, error: errText(e) };
      }
    },
    [withHwid]
  );

  const reqForHost = useCallback(
    async (
      target: DrinkxHost,
      subject: string,
      payload: Record<string, unknown> = {},
      timeoutMs = 2_000,
      priority: "command" | "poll" = "poll"
    ) => {
      try {
        return await window.desktop.natsRequest({
          subject,
          payload: {
            hwid: resolveHwid(target, modulesRef.current),
            ...payload,
          },
          timeoutMs,
          priority,
        });
      } catch (e) {
        return { ok: false as const, error: errText(e) };
      }
    },
    []
  );

  const ingestStatusSensors = useCallback(
    (target: DrinkxHost, statusData: unknown, updateUi: boolean) => {
      const map = extractTempMap(statusData, target);
      if (updateUi && hostRef.current === target) setTemps(map);
      if (Object.keys(map).length > 0) {
        setComplexTemps((prev) => ({
          ...prev,
          [target]: { ...prev[target], ...map },
        }));
      }
      for (const [key, val] of Object.entries(map)) {
        if (typeof val === "number") {
          pushSensorSample(target, key, val);
        }
      }
      if (target === "water") {
        const pulses = extractWaterTotalPulses(statusData, "water");
        if (pulses != null) {
          setWaterPulses(pulses);
          pushSensorSample("water", "waterTotalPulses", pulses, 1);
        }
        const pressure = extractWaterPressure(statusData, "water");
        if (pressure != null) {
          setWaterPressure(pressure);
          pushSensorSample("water", "waterPressure", pressure, 0.02);
        }
      }
      if (target === "milk" || target === "coffee") {
        const current = extractPumpCurrent(statusData);
        if (current != null) {
          setPumpCurrentByHost((prev) => ({ ...prev, [target]: current }));
          pushSensorSample(target, "pumpCurrent", current, 0.02);
        }
      }
    },
    [pushSensorSample]
  );

  const applyComplexTuple = useCallback(
    (replies: unknown[]) => {
      const tuple = parseComplexStatusTuple(replies);
      const active = hostRef.current;
      for (const h of DRINKX_HOSTS) {
        const snap = tuple.hosts[h];
        if (snap.sensorCount === 0) continue;
        if (Object.keys(snap.temps).length > 0) {
          setComplexTemps((prev) => ({
            ...prev,
            [h]: { ...prev[h], ...snap.temps },
          }));
          if (h === active) setTemps((prev) => ({ ...prev, ...snap.temps }));
          for (const [key, val] of Object.entries(snap.temps)) {
            if (typeof val === "number") {
              pushSensorSample(h, key, val);
            }
          }
        }
        if (h === "water") {
          if (snap.waterPulses != null) {
            setWaterPulses(snap.waterPulses);
            pushSensorSample("water", "waterTotalPulses", snap.waterPulses, 1);
          }
          if (snap.waterPressure != null) {
            setWaterPressure(snap.waterPressure);
            pushSensorSample(
              "water",
              "waterPressure",
              snap.waterPressure,
              0.02
            );
          }
        }
        if ((h === "milk" || h === "coffee") && snap.pumpCurrent != null) {
          setPumpCurrentByHost((prev) => ({
            ...prev,
            [h]: snap.pumpCurrent,
          }));
          pushSensorSample(h, "pumpCurrent", snap.pumpCurrent, 0.02);
        }
      }
      return tuple;
    },
    [pushSensorSample]
  );

  async function withCommandLock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = commandLock.current;
    let release!: () => void;
    commandLock.current = new Promise<void>((r) => {
      release = r;
    });
    await prev.catch(() => undefined);
    pollPaused.current = true;
    pollGeneration.current += 1;
    labTelemetryRef.current?.pause();
    try {
      return await fn();
    } finally {
      await sleep(80);
      pollPaused.current = false;
      labTelemetryRef.current?.resume();
      release();
      window.setTimeout(() => {
        if (!pollPaused.current) labTelemetryRef.current?.kick();
      }, 500);
    }
  }

  async function ensureValve(
    baseId: string,
    enabled: boolean
  ): Promise<{ ok: boolean; enabled?: boolean; error?: string }> {
    let lastError: string | undefined;
    const active = hostRef.current;
    // Команда open/stop → ответ {success}; затем status → {enabled} (источник истины).
    for (let attempt = 0; attempt < 2; attempt++) {
      const cmd = await req(
        valveCommandSubject(active, baseId, enabled),
        {},
        1_200,
        "command"
      );
      if (!cmd.ok) {
        lastError = cmd.error;
        await sleep(50);
        continue;
      }
      const st = await req(
        valveStatusSubject(active, baseId),
        {},
        700,
        "command"
      );
      const got = st.ok ? extractEnabledState(st.data) : null;
      if (got === enabled) return { ok: true, enabled: got };
      if (got !== null) {
        // бек ответил другим состоянием — принимаем его
        lastError = `ожидали ${enabled}, бек: ${got}`;
      }
      await sleep(50);
    }
    return {
      ok: false,
      error: lastError || "состояние клапана не подтвердилось",
    };
  }

  async function connectNats() {
    if (!canTryNats) {
      setToast({
        text: "Нужна активная сессия (вкладка Сессия)",
        error: true,
      });
      return;
    }
    setBusy("nats");
    setToast(null);
    try {
      // Явно URL из сессии — даже если probe natsOnline=false.
      const info = await window.desktop.natsConnect(
        session.natsUrl ?? undefined
      );
      setNats(info);
      if (!info.connected) {
        setToast({ text: info.message, error: true });
        return;
      }
      try {
        await window.desktop.natsSubscribeStatus();
      } catch (e) {
        console.warn("[modules] subscribe", e);
      }
      try {
        const muster = await window.desktop.natsMuster(900);
        if (muster.ok) {
          setModules(muster.modules);
          const nextHost = pickHostFromMuster(muster.modules, hostRef.current);
          if (nextHost !== hostRef.current) {
            setHost(nextHost);
            setHwid(resolveHwid(nextHost, muster.modules));
            setToast({
              text: `Модуль ${hostRef.current} offline → ${nextHost}`,
            });
          } else {
            const match = muster.modules.find(
              (m) =>
                m.hwid === defaultHwid(nextHost) ||
                m.role === nextHost ||
                (m.hwid ?? "").includes(nextHost)
            );
            if (match?.hwid) setHwid(match.hwid);
          }
        }
      } catch (e) {
        console.warn("[modules] muster", e);
      }
      setToast((prev) => prev ?? { text: info.message });
    } catch (e) {
      setToast({ text: errText(e), error: true });
    } finally {
      setBusy(null);
    }
  }

  // Auto-connect NATS: несколько попыток (probe часто отстаёт от туннеля).
  useEffect(() => {
    if (!canTryNats || nats.connected) return;
    let cancelled = false;
    let attempts = 0;
    const tryConnect = async () => {
      while (!cancelled && attempts < 4 && !nats.connected) {
        attempts += 1;
        autoNatsTried.current = true;
        try {
          const info = await window.desktop.natsConnect(
            session.natsUrl ?? undefined
          );
          if (cancelled) return;
          setNats(info);
          if (info.connected) {
            try {
              await window.desktop.natsSubscribeStatus();
            } catch {
              // ignore
            }
            try {
              const muster = await window.desktop.natsMuster(900);
              if (muster.ok) {
                setModules(muster.modules);
                const nextHost = pickHostFromMuster(
                  muster.modules,
                  hostRef.current
                );
                if (nextHost !== hostRef.current) {
                  setHost(nextHost);
                  setHwid(resolveHwid(nextHost, muster.modules));
                } else {
                  setHwid(resolveHwid(nextHost, muster.modules));
                }
              }
            } catch {
              // ignore
            }
            return;
          }
        } catch (e) {
          console.warn("[modules] auto-nats", attempts, e);
        }
        await new Promise((r) => setTimeout(r, 1200 * attempts));
      }
    };
    void tryConnect();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canTryNats, session.natsUrl]);

  useEffect(() => {
    if (!canTryNats) autoNatsTried.current = false;
  }, [canTryNats]);

  // После sleep/wake main шлёт app:resumed — переподключаем NATS.
  useEffect(() => {
    return window.desktop.onAppResumed((payload) => {
      autoNatsTried.current = false;
      if (payload.connected === false) {
        setNats({
          connected: false,
          server: null,
          message: "Сессия после сна не восстановлена",
        });
        return;
      }
      void (async () => {
        try {
          await window.desktop.natsDisconnect();
        } catch {
          // ignore
        }
        if (session.connected && session.natsUrl) {
          await connectNats();
        }
      })();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.connected, session.natsUrl]);

  async function disconnectNats() {
    setBusy("nats");
    try {
      valvePkgAbort.current?.abort();
      warmupAbort.current?.abort();
      for (const t of heaterTimers.current.values()) clearTimeout(t);
      heaterTimers.current.clear();
      const info = await window.desktop.natsDisconnect();
      setNats(info);
    } catch (e) {
      setToast({ text: errText(e), error: true });
    } finally {
      setBusy(null);
    }
  }

  async function resolveMuster() {
    setBusy("muster");
    try {
      const res = await window.desktop.natsMuster(900);
      if (!res.ok) {
        setToast({ text: res.error, error: true });
        return;
      }
      setModules(res.modules);
      const nextHost = pickHostFromMuster(res.modules, hostRef.current);
      if (nextHost !== hostRef.current) {
        setHost(nextHost);
        setHwid(resolveHwid(nextHost, res.modules));
      } else {
        const match = res.modules.find(
          (m) =>
            m.hwid === defaultHwid(nextHost) ||
            m.role === nextHost ||
            (m.hwid ?? "").includes(nextHost)
        );
        if (match?.hwid) setHwid(match.hwid);
        else setHwid(resolveHwid(nextHost, res.modules));
      }
      setToast({
        text: res.modules.length
          ? `Модулей: ${res.modules.length}` +
            (nextHost !== host ? ` · активен ${nextHost}` : "")
          : "Muster пуст — используем dx." + host,
        error: res.modules.length === 0,
      });
    } catch (e) {
      setToast({ text: errText(e), error: true });
    } finally {
      setBusy(null);
    }
  }

  async function toggleValve(baseId: string) {
    const next = !(valves[baseId] === true);
    setBusy(`valve-${baseId}`);
    // Оптимистично + hold 4с — poll не должен гасить лампу до verify.
    setValves((v) => ({ ...v, [baseId]: next }));
    valveHoldUntil.current.set(baseId, Date.now() + 4_000);
    labTelemetryRef.current?.setValve(baseId, next);
    pushLab("valve", baseId, next, next ? "cmd open" : "cmd close");
    try {
      await withCommandLock(async () => {
        const res = await ensureValve(baseId, next);
        if (res.enabled !== undefined) {
          setValves((v) => ({ ...v, [baseId]: res.enabled! }));
          labTelemetryRef.current?.setValve(baseId, res.enabled!);
          valveHoldUntil.current.set(baseId, Date.now() + 4_000);
        }
        if (!res.ok) {
          pushLab("valve", baseId, res.enabled ?? null, res.error || "verify failed");
          setToast({
            text: res.error || `Клапан ${baseId}: не подтверждён`,
            error: true,
          });
          if (res.enabled === undefined) {
            const st = await req(
              valveStatusSubject(hostRef.current, baseId),
              {},
              700,
              "command"
            );
            const got = st.ok ? extractEnabledState(st.data) : null;
            if (got !== null) {
              setValves((v) => ({ ...v, [baseId]: got }));
              labTelemetryRef.current?.setValve(baseId, got);
              valveHoldUntil.current.set(baseId, Date.now() + 2_000);
            } else {
              valveHoldUntil.current.delete(baseId);
            }
          }
        } else {
          pushLab("valve", baseId, res.enabled ?? next, "verified");
        }
      });
    } catch (e) {
      setToast({ text: errText(e), error: true });
      valveHoldUntil.current.delete(baseId);
    } finally {
      setBusy(null);
    }
  }

  async function setAllValves(enabled: boolean) {
    setBusy("valves-all");
    setValves((prev) => {
      const next = { ...prev };
      for (const id of MODULE_VALVES[host]) {
        next[id] = enabled;
        valveHoldUntil.current.set(id, Date.now() + 4_000);
        labTelemetryRef.current?.setValve(id, enabled);
      }
      return next;
    });
    try {
      await withCommandLock(async () => {
        for (const baseId of MODULE_VALVES[host]) {
          await ensureValve(baseId, enabled);
        }
      });
    } catch (e) {
      setToast({ text: errText(e), error: true });
    } finally {
      setBusy(null);
    }
  }

  function abortValvePackage() {
    valvePkgAbort.current?.abort();
  }

  async function runValvePackage() {
    const pkg = getValvePackage(valvePackageId);
    if (!pkg) return;
    const steps = pkg.stepsFor(host);
    if (steps.length === 0) {
      setToast({ text: "Нет шагов для этого модуля", error: true });
      return;
    }
    const ac = new AbortController();
    valvePkgAbort.current = ac;
    setBusy("valve-pkg");
    setToast(null);
    pushLab("command", pkg.id, true, `package start · ${steps.length} steps`);
    let failed: string | undefined;
    try {
      await withCommandLock(async () => {
        for (let i = 0; i < steps.length; i++) {
          if (ac.signal.aborted) {
            failed = "остановлено";
            break;
          }
          const step = steps[i]!;
          setValves((v) => ({ ...v, [step.valveId]: step.enabled }));
          pushLab(
            "valve",
            step.valveId,
            step.enabled,
            `pkg ${i + 1}/${steps.length} · ${step.enabled ? "open" : "close"}`
          );
          let res = await ensureValve(step.valveId, step.enabled);
          if (!res.ok && !ac.signal.aborted) {
            await sleep(50);
            res = await ensureValve(step.valveId, step.enabled);
          }
          if (!res.ok) {
            failed = res.error || `${step.valveId} verify failed`;
            pushLab("valve", step.valveId, null, failed);
            break;
          }
          pushLab("valve", step.valveId, step.enabled, "verified");
          if (step.holdMs > 0 && !ac.signal.aborted) {
            await sleep(step.holdMs);
          }
        }
      });
      if (failed) {
        setToast({ text: `Пакет: ${failed}`, error: true });
        pushLab("command", pkg.id, false, failed);
      } else {
        setToast({ text: `Пакет «${pkg.label}» готов` });
        pushLab("command", pkg.id, true, "package done");
      }
    } catch (e) {
      setToast({ text: errText(e), error: true });
    } finally {
      valvePkgAbort.current = null;
      setBusy(null);
    }
  }

  function burstDxPumpCurrents() {
    void pollDxPumpCurrents();
    window.setTimeout(() => void pollDxPumpCurrents(), 350);
    window.setTimeout(() => void pollDxPumpCurrents(), 900);
    window.setTimeout(() => void pollDxPumpCurrents(), 1_800);
  }

  function estimatePwmForHeater(hid: string): number {
    const sensor =
      hid === "heater1" ? "heater1_out" : hid === "heater2" ? "heater2_out" : null;
    const temp =
      (sensor && temps[sensor]) ??
      (sensor && complexTemps[host]?.[sensor as TempSensorKey]) ??
      null;
    return estimateHeaterPwmPercent(true, heaterTarget, temp) ?? 25;
  }

  async function startHeatersForPump(session: number) {
    const autoMs = Math.max(1, heaterAutoStopSec) * 1000;
    const failed: string[] = [];
    for (const hid of HEATER_IDS) {
      if (session !== pumpSessionRef.current) return;
      try {
        const prev = heaterTimers.current.get(hid);
        if (prev) clearTimeout(prev);
        const res = await withCommandLock(() =>
          req(heaterCommandSubject(host, hid), { target: heaterTarget })
        );
        if (session !== pumpSessionRef.current) return;
        if (res.ok) {
          const short =
            hid === "heater1" ? ("heater1" as const) : ("heater2" as const);
          const pwmEst = estimatePwmForHeater(hid);
          setHeaters((h) => ({ ...h, [hid]: true }));
          labTelemetryRef.current?.setHeater(host, short, true, pwmEst);
          setHeaterPwmByHost((p) => ({
            ...p,
            [host]: { ...p[host], [short]: pwmEst },
          }));
          pushSensorSample(host, `${short}_pwm`, pwmEst, 0.5);
          pushLab("heater", hid, true, `with pump target=${heaterTarget}C pwm~${pwmEst}`);
          const timer = setTimeout(() => {
            void stopHeater(hid);
          }, autoMs);
          heaterTimers.current.set(hid, timer);
        } else {
          failed.push(`${hid}: ${res.error}`);
        }
      } catch (e) {
        failed.push(`${hid}: ${errText(e)}`);
        console.warn("[modules] heater with pump", hid, e);
      }
    }
    if (failed.length && session === pumpSessionRef.current) {
      setToast({
        text: `Тэны с насосом: ${failed.join("; ")}`,
        error: true,
      });
    }
  }

  async function startPump(direction: "forward" | "reverse" = "forward") {
    const session = ++pumpSessionRef.current;
    setBusy("pump");
    // Сразу STOP + cmd в телеметрии — опрос не откатит лампу на OFF во время тэнов.
    setPumpOn(true);
    pushSensorSample(host, "pumpPower", pumpPower, 0.5);
    setPumpPowerByHost((p) => ({ ...p, [host]: pumpPower }));
    labTelemetryRef.current?.setPumpPower(host, pumpPower, true);
    burstDxPumpCurrents();
    try {
      if (direction === "forward" && pumpWithHeaters) {
        await startHeatersForPump(session);
        if (session !== pumpSessionRef.current) return;
      }
      const payload = pumpCommandPayload({
        durationMs: pumpDuration,
        powerPercent: pumpPower,
        direction,
      });

      const res = await withCommandLock(() =>
        req(pumpCommandSubject(host), payload, 12_000)
      );
      if (session !== pumpSessionRef.current) return;
      if (!res.ok) {
        setPumpOn(false);
        pushSensorSample(host, "pumpPower", 0, 0.5);
        setPumpPowerByHost((p) => ({ ...p, [host]: 0 }));
        labTelemetryRef.current?.setPumpPower(host, 0, false);
        setToast({ text: res.error, error: true });
        return;
      }
      pushLab(
        "pump",
        "pump",
        true,
        `${direction} power%=${pumpPower} pwm=${payload.power} ms=${pumpDuration}`
      );
      // Обновить cmd timestamp после реального ACK
      labTelemetryRef.current?.setPumpPower(host, pumpPower, true);
      burstDxPumpCurrents();
      if (pumpTimerRef.current) clearTimeout(pumpTimerRef.current);
      pumpTimerRef.current = setTimeout(() => {
        if (session !== pumpSessionRef.current) return;
        pumpTimerRef.current = null;
        setPumpOn(false);
        pushLab("pump", "pump", false, "duration elapsed");
        pushSensorSample(host, "pumpPower", 0, 0.5);
        setPumpPowerByHost((p) => ({ ...p, [host]: 0 }));
        labTelemetryRef.current?.setPumpPower(host, 0, false);
        void refreshDevices();
        burstDxPumpCurrents();
      }, pumpDuration + 200);
    } catch (e) {
      if (session === pumpSessionRef.current) {
        setToast({ text: errText(e), error: true });
        setPumpOn(false);
        setPumpPowerByHost((p) => ({ ...p, [host]: 0 }));
        labTelemetryRef.current?.setPumpPower(host, 0, false);
      }
    } finally {
      if (session === pumpSessionRef.current) setBusy(null);
    }
  }

  async function stopPump() {
    // Отменить in-flight start (тэны / ACK) и авто-стоп по ms.
    pumpSessionRef.current += 1;
    if (pumpTimerRef.current) {
      clearTimeout(pumpTimerRef.current);
      pumpTimerRef.current = null;
    }
    setPumpOn(false);
    pushSensorSample(host, "pumpPower", 0, 0.5);
    setPumpPowerByHost((p) => ({ ...p, [host]: 0 }));
    labTelemetryRef.current?.setPumpPower(host, 0, false);
    setBusy("pump");
    try {
      const res = await withCommandLock(() => req(pumpStopSubject(host)));
      if (!res.ok) {
        setToast({ text: res.error, error: true });
        return;
      }
      pushLab("pump", "pump", false, "stop");
    } catch (e) {
      setToast({ text: errText(e), error: true });
    } finally {
      setBusy(null);
      burstDxPumpCurrents();
    }
  }

  async function togglePump() {
    const running =
      pumpOn === true || (pumpPowerByHost[host] ?? 0) > 0 || busy === "pump";
    if (running) await stopPump();
    else await startPump("forward");
  }

  async function startHeater(heaterId: string) {
    pollPaused.current = true;
    labTelemetryRef.current?.pause();
    setBusy(`heater-${heaterId}`);
    try {
      const prev = heaterTimers.current.get(heaterId);
      if (prev) clearTimeout(prev);
      const res = await req(heaterCommandSubject(host, heaterId), {
        target: heaterTarget,
      });
      if (!res.ok) {
        setToast({ text: res.error, error: true });
        return;
      }
      setHeaters((h) => ({ ...h, [heaterId]: true }));
      const short =
        heaterId === "heater1" ? ("heater1" as const) : ("heater2" as const);
      const pwmEst = estimatePwmForHeater(heaterId);
      labTelemetryRef.current?.setHeater(host, short, true, pwmEst);
      setHeaterPwmByHost((p) => ({
        ...p,
        [host]: { ...p[host], [short]: pwmEst },
      }));
      pushSensorSample(host, `${short}_pwm`, pwmEst, 0.5);
      pushLab("heater", heaterId, true, `target=${heaterTarget}C pwm~${pwmEst}`);
      const autoMs = Math.max(1, heaterAutoStopSec) * 1000;
      const timer = setTimeout(() => {
        void stopHeater(heaterId);
      }, autoMs);
      heaterTimers.current.set(heaterId, timer);
    } catch (e) {
      setToast({ text: errText(e), error: true });
    } finally {
      setBusy(null);
      pollPaused.current = false;
      labTelemetryRef.current?.resume();
      void refreshDevices();
    }
  }

  async function stopHeater(heaterId: string) {
    const prev = heaterTimers.current.get(heaterId);
    if (prev) clearTimeout(prev);
    heaterTimers.current.delete(heaterId);
    pollPaused.current = true;
    labTelemetryRef.current?.pause();
    try {
      await req(heaterStopSubject(host, heaterId));
      setHeaters((h) => ({ ...h, [heaterId]: false }));
      pushLab("heater", heaterId, false, "stop");
      const short =
        heaterId === "heater1" ? ("heater1" as const) : ("heater2" as const);
      labTelemetryRef.current?.setHeater(host, short, false, 0);
      setHeaterPwmByHost((prev) => ({
        ...prev,
        [host]: { ...prev[host], [short]: 0 },
      }));
      pushSensorSample(host, `${short}_pwm`, 0, 0.5);
    } catch (e) {
      console.warn("[modules] stop heater", e);
    } finally {
      pollPaused.current = false;
      labTelemetryRef.current?.resume();
      void refreshDevices();
    }
  }

  async function toggleHeater(heaterId: string) {
    if (heaters[heaterId] === true) await stopHeater(heaterId);
    else await startHeater(heaterId);
  }

  function abortHeaterWarmup() {
    warmupAbort.current?.abort();
  }

  async function runHeaterWarmup() {
    const ac = new AbortController();
    warmupAbort.current = ac;
    const targetC = heaterTarget;
    const maxOutC = warmupMaxOut;
    const {
      staggerMs,
      timeoutMs,
      overheatAbortC,
      pollMs,
      reachEpsilonC,
      order,
    } = HEATER_WARMUP_DEFAULTS;

    setBusy("warmup");
    setToast(null);
    setWarmupStatus("старт…");
    pushLab(
      "heater",
      "warmup",
      true,
      `target=${targetC} max=${maxOutC} timeout=${timeoutMs}ms`
    );

    // Не мешать профилю таймерным auto-stop одиночных стартов.
    for (const t of heaterTimers.current.values()) clearTimeout(t);
    heaterTimers.current.clear();

    const started: string[] = [];
    let outcome: "ok" | "abort" | "error" = "ok";
    let detail = "";

    try {
      pollPaused.current = true;
      pollGeneration.current += 1;

      for (let i = 0; i < order.length; i++) {
        if (ac.signal.aborted) {
          outcome = "abort";
          detail = "остановлено";
          break;
        }
        const hid = order[i]!;
        const sensorKey = warmupSensorKey(hid);
        const ohKey = warmupOverheatKey(hid);

        const res = await req(heaterCommandSubject(host, hid), {
          target: targetC,
        });
        if (!res.ok) {
          outcome = "error";
          detail = res.error || `${hid} start failed`;
          break;
        }
        started.push(hid);
        setHeaters((h) => ({ ...h, [hid]: true }));
        pushLab("heater", hid, true, `warmup start target=${targetC}`);
        setWarmupStatus(`${HEATER_LABELS[hid] ?? hid}: нагрев…`);

        const deadline = Date.now() + timeoutMs;
        let reached = false;
        while (Date.now() < deadline && !ac.signal.aborted) {
          const st = await req(NATS_SUBJECTS.status, {}, 1_000);
          if (st.ok) {
            const map = extractTempMap(st.data, host);
            setTemps(map);
            const out = sensorKey != null ? map[sensorKey] : undefined;
            const oh = ohKey != null ? map[ohKey] : undefined;
            if (typeof out === "number") {
              setWarmupStatus(
                `${HEATER_LABELS[hid] ?? hid}: ${out.toFixed(1)}°C → ${targetC}°C`
              );
              if (out >= maxOutC) {
                outcome = "abort";
                detail = `${hid} out ${out}≥max ${maxOutC}`;
                pushLab("heater", hid, null, detail);
                break;
              }
              if (out >= targetC - reachEpsilonC) {
                reached = true;
                pushLab("heater", hid, true, `reached ${out.toFixed(1)}°C`);
                break;
              }
            }
            if (typeof oh === "number" && oh >= overheatAbortC) {
              outcome = "abort";
              detail = `${hid} overheat ${oh}≥${overheatAbortC}`;
              pushLab("heater", hid, null, detail);
              break;
            }
          }
          await sleep(pollMs);
        }

        if (outcome !== "ok") break;
        if (ac.signal.aborted) {
          outcome = "abort";
          detail = "остановлено";
          break;
        }
        if (!reached) {
          pushLab("heater", hid, true, "timeout — continue next");
          setWarmupStatus(
            `${HEATER_LABELS[hid] ?? hid}: timeout, дальше…`
          );
        }
        if (i < order.length - 1) {
          await sleep(staggerMs);
        }
      }

      for (const hid of started) {
        try {
          await req(heaterStopSubject(host, hid));
          setHeaters((h) => ({ ...h, [hid]: false }));
          pushLab("heater", hid, false, "warmup stop");
        } catch (e) {
          console.warn("[modules] warmup stop", hid, e);
        }
      }

      if (outcome === "ok" && !ac.signal.aborted) {
        setToast({ text: "Прогрев ТЭНов завершён" });
        setWarmupStatus("готово");
        pushLab("heater", "warmup", true, "done");
      } else if (outcome === "abort" || ac.signal.aborted) {
        setToast({
          text: detail || "Прогрев остановлен",
          error: true,
        });
        setWarmupStatus(detail || "остановлено");
        pushLab("heater", "warmup", false, detail || "abort");
      } else {
        setToast({ text: detail || "Ошибка прогрева", error: true });
        setWarmupStatus(detail || "ошибка");
        pushLab("heater", "warmup", false, detail || "error");
      }
    } catch (e) {
      setToast({ text: errText(e), error: true });
      setWarmupStatus(errText(e));
      for (const hid of started) {
        try {
          await req(heaterStopSubject(host, hid));
          setHeaters((h) => ({ ...h, [hid]: false }));
        } catch {
          // ignore
        }
      }
    } finally {
      warmupAbort.current = null;
      pollPaused.current = false;
      setBusy(null);
      void refreshDevices();
    }
  }

  async function toggleMilkValve(valveNumber: number) {
    const key = String(valveNumber);
    const next = !(milkValves[key] === true);
    setBusy(`milk-v-${valveNumber}`);
    setMilkValves((m) => ({ ...m, [key]: next }));
    try {
      await withCommandLock(async () => {
        const subject = next
          ? "coffeemachine.debug-valves-on"
          : "coffeemachine.debug-valves-off";
        const res = await req(subject, { nozzleId: 0, valves: [valveNumber] });
        if (!res.ok) {
          setToast({ text: res.error, error: true });
          setMilkValves((m) => ({ ...m, [key]: !next }));
        }
      });
    } catch (e) {
      setToast({ text: errText(e), error: true });
    } finally {
      setBusy(null);
    }
  }

  async function runFlush(kind: "milk" | "water") {
    const openValve =
      kind === "water"
        ? MODULE_VALVES[host].includes("waterInput")
          ? "waterInput"
          : "milkInput"
        : "milkInput";

    pollPaused.current = true;
    setBusy("flush");
    setToast(null);
    try {
      await req(valveCommandSubject(host, openValve, true));
      if (MODULE_VALVES[host].includes("drain")) {
        await req(valveCommandSubject(host, "drain", false));
      }
      const duration = 5000;
      await req(pumpCommandSubject(host), { duration });
      await sleep(duration);
      await req(valveCommandSubject(host, openValve, false));
      if (MODULE_VALVES[host].includes("drain")) {
        await req(valveCommandSubject(host, "drain", false));
      }
      setToast({ text: `Flush ${kind} · ${openValve} 5с` });
      void refreshDevices();
    } catch (e) {
      setToast({ text: errText(e), error: true });
    } finally {
      setBusy(null);
      pollPaused.current = false;
    }
  }

  async function foamCook() {
    if (host === "water") return;
    if (foamTemp < 20 || foamTemp > 95) {
      setToast({ text: "Температура 20…95 °C", error: true });
      return;
    }
    pollPaused.current = true;
    setBusy("foam");
    try {
      if (MODULE_VALVES[host].includes("drain")) {
        await req(valveCommandSubject(host, "drain", false));
      }
      if (MODULE_VALVES[host].includes("waterInput")) {
        await req(valveCommandSubject(host, "waterInput", false));
      }
      const res = await req(
        NATS_SUBJECTS.brew,
        {
          nozzleId: 0,
          coffeeRecipe: {
            parts: [
              {
                type: "milk",
                qty: 8000,
                temp: foamTemp,
                airPercent: foamAir,
                productionOrder: 1,
              },
            ],
            valves: [],
          },
        },
        90_000
      );
      if (!res.ok) {
        setToast({ text: res.error, error: true });
        return;
      }
      setToast({ text: "Пена: готово" });
    } catch (e) {
      setToast({ text: errText(e), error: true });
    } finally {
      setBusy(null);
      pollPaused.current = false;
    }
  }

  function requireLabUnlock(): boolean {
    if (
      typeof sessionStorage !== "undefined" &&
      sessionStorage.getItem("sm.writeUnlocked") === "1"
    ) {
      return true;
    }
    setToast({
      text: "Разблокируйте правки в Настройках (сервисный пароль)",
      error: true,
    });
    return false;
  }

  async function runLabScenario(scenario: LabScenario) {
    if (scenario.risk !== "read" && !requireLabUnlock()) return;
    if (scenario.risk === "danger") {
      if (
        !window.confirm(`${scenario.label}: остановить текущую операцию CM?`)
      ) {
        return;
      }
    }
    const eta = scenario.expectedSec
      ? `~${Math.round(scenario.expectedSec / 60)} мин (${scenario.expectedSec} с)`
      : null;
    if (scenario.risk === "service" && scenario.id.includes("milkrinse")) {
      if (
        !window.confirm(
          [
            `${scenario.label}: реальный ERP milkrinse (coffeemachine.milkrinse!).`,
            eta ? `Ожидайте ${eta}: насос forward → reverse-циклы.` : null,
            "Host → milk. Ток pump_R_IS (V) с DX UI :8000 — не отрицательный при reverse.",
            "Stop CM остаётся доступным. Продолжить?",
          ]
            .filter(Boolean)
            .join("\n")
        )
      ) {
        return;
      }
      if (host !== "milk") setHost("milk");
      setShowCharts(true);
      setShowSensorCharts(true);
    }
    const payload = scenario.buildPayload({ host, hwid });
    smLog("info", "lab-scenario", scenario.id, {
      subject: scenario.subject,
      payload,
      expectedSec: scenario.expectedSec,
    });
    const isStop = scenario.id === "stop-cm";
    // Stop CM не должен ждать конца rinse / блокировать сам себя.
    const busyToken = {};
    scenarioBusyToken.current = busyToken;
    setBusy(isStop ? "scenario-stop-cm" : `scenario-${scenario.id}`);
    pollPaused.current = false;
    pushLab(
      "command",
      scenario.subject,
      "request",
      `${JSON.stringify(payload)}${eta ? ` · ETA ${eta}` : ""}`
    );
    if (eta && !isStop) {
      setToast({
        text: `${scenario.label}: идёт ${eta}. Ток — pump_R_IS (V) у milk.`,
      });
    }
    try {
      // milkrinse: poll — не блокирует DX/status опрос.
      // Stop: command — пробивает очередь, чтобы оборвать opsq.
      const res = await req(
        scenario.subject,
        payload,
        scenario.timeoutMs ?? 8_000,
        isStop
          ? "command"
          : scenario.id.includes("milkrinse") || scenario.risk === "read"
            ? "poll"
            : "command"
      );
      if (res.ok) {
        pushLab(
          "command",
          scenario.subject,
          "ok",
          JSON.stringify(res.data).slice(0, 240)
        );
        setToast({ text: `${scenario.label} ok` });
        smLog("info", "lab-scenario", `${scenario.id} ok`);
      } else {
        pushLab("command", scenario.subject, "error", res.error);
        setToast({ text: res.error, error: true });
        smLog("error", "lab-scenario", `${scenario.id} fail`, {
          error: res.error,
        });
      }
      void refreshDevices();
      void pollDxPumpCurrents();
    } finally {
      // После Stop / новой сценарии старый milkrinse не затирает busy.
      if (scenarioBusyToken.current === busyToken) setBusy(null);
    }
  }

  async function runBrewLab() {
    if (!requireLabUnlock()) return;
    if (
      !window.confirm(
        "Brew Lab нальёт в группу (qty = мс насоса). Убедитесь, что стакан на месте. Продолжить?"
      )
    ) {
      return;
    }
    const parts: Array<{
      type: BrewLabPartType;
      qtyMs: number;
      tempC: number;
      productionOrder: number;
    }> = [
      {
        type: brewType,
        qtyMs: brewQtyMs,
        tempC: brewTempC,
        productionOrder: 1,
      },
    ];
    if (brewAddMilk) {
      parts.push({
        type: "milk",
        qtyMs: brewMilkQtyMs,
        tempC: brewMilkTempC,
        productionOrder: 2,
      });
    }
    const payload = buildBrewLabPayload({
      hwid: brewHwid || hwid || "dx",
      parts,
    });
    smLog("info", "brew-lab", "start", payload);
    pollPaused.current = true;
    setBusy("brew-lab");
    pushLab("command", NATS_SUBJECTS.brew, "request", JSON.stringify(payload));
    try {
      const res = await req(NATS_SUBJECTS.brew, payload, 90_000);
      if (res.ok) {
        pushLab(
          "command",
          NATS_SUBJECTS.brew,
          "ok",
          JSON.stringify(res.data).slice(0, 240)
        );
        setToast({ text: "Brew Lab ok" });
        smLog("info", "brew-lab", "ok");
      } else {
        pushLab("command", NATS_SUBJECTS.brew, "error", res.error);
        setToast({ text: res.error, error: true });
        smLog("error", "brew-lab", "fail", { error: res.error });
      }
      void refreshDevices();
    } finally {
      setBusy(null);
      pollPaused.current = false;
    }
  }

  async function readWaterPulses(): Promise<number | null> {
    try {
      const statusRes = await req(NATS_SUBJECTS.status, {}, 4000);
      if (!statusRes.ok) return null;
      return extractWaterTotalPulses(statusRes.data, "water");
    } catch {
      return null;
    }
  }

  async function brewCalibrationVolume(qty: number): Promise<{
    pulsesDelta: number;
  }> {
    const startPulses = await readWaterPulses();
    if (startPulses == null) {
      throw new Error("Не удалось прочитать стартовое total pulses");
    }

    const brewPromise = req(
      NATS_SUBJECTS.brew,
      {
        nozzleId: 0,
        coffeeRecipe: {
          parts: [
            {
              type: "water",
              qty,
              temp: 20,
              productionOrder: 1,
            },
          ],
          valves: [],
        },
      },
      FLOW_CALIBRATION_BREW_TIMEOUT_MS
    );

    await sleep(FLOW_CALIBRATION_SWITCH_DELAY_MS);
    await req(valveCommandSubject("water", "dump", false));
    await req(valveCommandSubject("water", "drain", false));
    await req(valveCommandSubject("water", "milkInput", true));

    let brewFinished = false;
    let lastObserved = startPulses;
    let detectedReset = false;
    let maxAfterReset = Number.NaN;

    const watcher = (async () => {
      while (!brewFinished) {
        await sleep(FLOW_CALIBRATION_PULSES_POLL_MS);
        const cur = await readWaterPulses();
        if (cur == null) continue;
        if (!detectedReset && cur < lastObserved) {
          detectedReset = true;
          maxAfterReset = cur;
        } else if (detectedReset) {
          maxAfterReset = Number.isFinite(maxAfterReset)
            ? Math.max(maxAfterReset, cur)
            : cur;
        }
        lastObserved = cur;
      }
    })();

    try {
      const brewRes = await brewPromise;
      if (!brewRes.ok) {
        throw new Error(brewRes.error || `Пролив ${qty} мл ошибка`);
      }
    } finally {
      brewFinished = true;
      await watcher;
      try {
        await req(valveCommandSubject("water", "milkInput", false));
      } catch {
        // ignore
      }
    }

    const endPulses = await readWaterPulses();
    const pulsesDelta = detectedReset
      ? maxAfterReset
      : endPulses != null
        ? endPulses - startPulses
        : Number.NaN;

    if (!Number.isFinite(pulsesDelta) || pulsesDelta <= 0) {
      throw new Error(`Нет корректных pulses для шага ${qty} мл`);
    }
    return { pulsesDelta };
  }

  async function persistFlowFactor(flowFactor: number): Promise<string> {
    const normalized = Number(flowFactor.toFixed(6));
    const updateRes = await window.desktop.natsUpdateConfig(
      withHwid({ flowFactor: normalized })
    );
    if (!updateRes.ok) {
      throw new Error(updateRes.error || "update-config failed");
    }

    let persistNote = "runtime update-config OK";
    if (unlocked) {
      try {
        const read = await window.desktop.drinkxRead({ role: "water" });
        if (!read.ok) throw new Error(read.error);
        const obj = JSON.parse(read.text) as Record<string, unknown>;
        obj.flowFactor = normalized;
        const write = await window.desktop.drinkxWrite({
          role: "water",
          text: `${JSON.stringify(obj, null, 2)}\n`,
          unlocked: true,
          restart: false,
        });
        if (!write.ok) throw new Error(write.error);
        persistNote += ` · drinkx.json записан (${normalized})`;
      } catch (e) {
        persistNote += ` · drinkx.json: ${errText(e)}`;
      }
    } else {
      persistNote += " · drinkx.json пропущен (разблокируйте правки)";
    }
    return persistNote;
  }

  async function runFlowCalibration() {
    if (host !== "water") return;
    if (
      !window.confirm(
        "Проливы 100/200/300/400 мл. После каждого шага введите фактический объём. Продолжить?"
      )
    ) {
      setCalibStatus("Калибровка отменена");
      return;
    }

    pollPaused.current = true;
    setBusy("calib");
    const lines = [
      "Калибровка flowmeter · water",
      "flowFactor = total_pulses / фактический_объём_мл",
      "",
    ];
    const rows: CalibRow[] = FLOW_CALIBRATION_QTYS.map((qty) => ({ qty }));
    setCalibRows(rows);
    setCalibLog(lines.join("\n"));
    setCalibStatus("Идёт калибровка…");

    try {
      const factors: number[] = [];
      for (const qty of FLOW_CALIBRATION_QTYS) {
        lines.push(`Шаг ${qty} мл: пролив…`);
        setCalibLog(lines.join("\n"));
        const { pulsesDelta } = await brewCalibrationVolume(qty);
        const row = rows.find((r) => r.qty === qty)!;
        row.pulses = pulsesDelta;
        lines.push(`Шаг ${qty} мл: pulses = ${pulsesDelta}`);
        setCalibRows([...rows]);
        setCalibLog(lines.join("\n"));

        const answer = window.prompt(
          `Фактический объём для ${qty} мл (мл):`,
          String(qty)
        );
        if (answer == null) throw new Error("Остановлено пользователем");
        const actualMl = Number(String(answer).replace(",", "."));
        if (!Number.isFinite(actualMl) || actualMl <= 0) {
          throw new Error(`Некорректный объём для ${qty} мл`);
        }
        const stepFactor = pulsesDelta / actualMl;
        row.actualMl = actualMl;
        row.flowFactor = stepFactor;
        factors.push(stepFactor);
        lines.push(
          `Шаг ${qty} мл: факт = ${actualMl}, flowFactor = ${stepFactor.toFixed(6)}`,
          ""
        );
        setCalibRows([...rows]);
        setCalibLog(lines.join("\n"));
      }

      const avg = factors.reduce((a, b) => a + b, 0) / factors.length;
      lines.push(`Итоговый flowFactor = ${avg.toFixed(6)}`);
      lines.push("Сохраняю…");
      setCalibLog(lines.join("\n"));
      const note = await persistFlowFactor(avg);
      lines.push(note);
      setCalibLog(lines.join("\n"));
      setCalibStatus(`Готово · flowFactor ${avg.toFixed(6)}`);
      setToast({ text: `Калибровка OK · ${avg.toFixed(6)}` });
    } catch (e) {
      lines.push("", `Ошибка: ${errText(e)}`);
      setCalibLog(lines.join("\n"));
      setCalibStatus("Ошибка калибровки");
      setToast({ text: errText(e), error: true });
    } finally {
      setBusy(null);
      pollPaused.current = false;
      void refreshDevices();
    }
  }

  const controlsDisabled = !live;
  function valveRowDisabled(baseId: string): boolean {
    return (
      !live ||
      busy === `valve-${baseId}` ||
      busy === "valves-all" ||
      busy === "valve-pkg"
    );
  }
  const availableChartSensors = useMemo(() => {
    const catalog = complexSensorCatalog();
    const fromEvents = new Set<string>();
    for (const e of labEvents) {
      if (e.kind === "sensor") fromEvents.add(seriesKey(e.module, e.name));
    }
    return [...new Set([...catalog, ...fromEvents])];
  }, [labEvents]);

  const chartSensorNames = useMemo(() => {
    const names = new Set<string>();
    for (const e of labEvents) {
      if (e.kind === "sensor") names.add(seriesKey(e.module, e.name));
    }
    for (const k of complexSensorCatalog()) names.add(k);
    // Каталог уже в смысловом порядке; дополняем событиями.
    const catalog = complexSensorCatalog();
    const ordered = [
      ...catalog.filter((k) => names.has(k)),
      ...[...names].filter((k) => !catalog.includes(k)),
    ];
    return ordered;
  }, [labEvents]);

  const chartCommonProps = {
    events: labEvents,
    availableSensors: availableChartSensors,
    valveIdsByModule: {
      milk: MODULE_VALVES.milk,
      coffee: MODULE_VALVES.coffee,
      water: MODULE_VALVES.water,
    } as Record<DrinkxHost, string[]>,
    heaterIds: [...HEATER_IDS],
  };

  function exportLabLog() {
    const csv = labEventsToCsv(labEvents);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `modules-lab-${host}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    pushLab("system", "export", labEvents.length, a.download);
    setToast({ text: `Лог выгружен (${labEvents.length} событий)` });
  }

  async function runTerminalCommand() {
    const subject = termSubject.trim();
    if (!subject) return;
    let payload: Record<string, unknown> = {};
    if (termCmd.trim()) {
      try {
        payload = JSON.parse(termCmd) as Record<string, unknown>;
      } catch {
        setToast({ text: "payload должен быть JSON", error: true });
        return;
      }
    }
    pushLab("command", subject, "request", termCmd || "{}");
    const res = await req(subject, payload, 2_500);
    if (res.ok) {
      pushLab(
        "command",
        subject,
        "ok",
        JSON.stringify(res.data).slice(0, 240)
      );
    } else {
      pushLab("command", subject, "error", res.error);
      setToast({ text: res.error, error: true });
    }
  }

  function applySubjectPreset(id: string) {
    setTermSubjectPick(id);
    let subject = termSubject;
    if (id.startsWith("custom:")) {
      subject = id.slice("custom:".length);
      setTermSubject(subject);
    } else if (id === "__custom__") {
      return;
    } else {
      const preset = TERMINAL_SUBJECT_PRESETS.find((p) => p.id === id);
      if (!preset) return;
      subject = preset.subject;
      setTermSubject(subject);
    }
    const ids = associatedPayloadIds(subject, customSubjects);
    const first = ids[0];
    if (first) applyPayloadPreset(first);
  }

  function applyPayloadPreset(id: string) {
    setTermPayloadPick(id);
    if (id.startsWith("custom:")) {
      const found = customPayloads.find((p) => p.id === id.slice("custom:".length));
      if (found) setTermCmd(found.payloadJson);
      return;
    }
    if (id === "__custom__") return;
    const preset = TERMINAL_PAYLOAD_PRESETS.find((p) => p.id === id);
    if (preset) setTermCmd(JSON.stringify(preset.payload, null, 2));
  }

  function linkPayloadToSubject(subject: string, payloadPickId: string) {
    const builtin = findSubjectPresetFor(subject);
    // Builtin subjects: store override in customSubjects with same subject
    const existing = customSubjects.find((s) => s.subject === subject);
    const baseIds =
      existing?.payloadIds?.length
        ? existing.payloadIds
        : builtin
          ? [...builtin.payloadIds]
          : [];
    if (baseIds.includes(payloadPickId)) {
      // already linked; still ensure custom row exists for customs
      if (!existing && !builtin) {
        const row: CustomSubject = {
          subject,
          label: subject,
          payloadIds: [payloadPickId],
        };
        const next = [row, ...customSubjects].slice(0, 40);
        setCustomSubjects(next);
        saveCustomSubjects(next);
      }
      return;
    }
    const payloadIds = [payloadPickId, ...baseIds.filter((x) => x !== payloadPickId)];
    const row: CustomSubject = {
      subject,
      label: existing?.label ?? subject,
      payloadIds,
    };
    const next = [row, ...customSubjects.filter((s) => s.subject !== subject)].slice(
      0,
      40
    );
    setCustomSubjects(next);
    saveCustomSubjects(next);
  }

  function rememberSubject() {
    const subject = termSubject.trim();
    if (!subject) return;
    const pick =
      currentPayloadPickId(termPayloadPick, termCmd, customPayloads) ??
      (() => {
        // сохранить текущий JSON как payload и связать
        const raw = termCmd.trim() || "{}";
        try {
          JSON.parse(raw);
        } catch {
          return null;
        }
        const id = `p${Date.now().toString(36)}`;
        const entry: CustomPayload = {
          id,
          label: `${subject} payload`,
          description: `Авто при сохранении subject ${subject}`,
          payloadJson: raw,
        };
        const payloads = [entry, ...customPayloads].slice(0, 40);
        setCustomPayloads(payloads);
        saveCustomPayloads(payloads);
        setTermPayloadPick(`custom:${id}`);
        return `custom:${id}`;
      })();

    const existing = customSubjects.find((s) => s.subject === subject);
    const builtin = findSubjectPresetFor(subject);
    const base = existing?.payloadIds?.length
      ? existing.payloadIds
      : builtin
        ? [...builtin.payloadIds]
        : [];
    const payloadIds = pick
      ? [pick, ...base.filter((x) => x !== pick)]
      : base;

    const next = [
      {
        subject,
        label: existing?.label ?? subject,
        payloadIds,
      },
      ...customSubjects.filter((s) => s.subject !== subject),
    ].slice(0, 40);
    setCustomSubjects(next);
    saveCustomSubjects(next);
    setTermSubjectPick(`custom:${subject}`);
    setToast({
      text: pick
        ? `Subject сохранён + связь с payload`
        : `Subject сохранён: ${subject}`,
    });
  }

  function rememberPayload() {
    const raw = termCmd.trim() || "{}";
    try {
      JSON.parse(raw);
    } catch {
      setToast({ text: "payload должен быть JSON", error: true });
      return;
    }
    const id = `p${Date.now().toString(36)}`;
    const label = window.prompt("Название пресета payload", "мой payload");
    if (!label) return;
    const description =
      window.prompt("Краткое описание (зачем)", "") ?? "";
    const entry: CustomPayload = {
      id,
      label: label.trim() || id,
      description: description.trim(),
      payloadJson: raw,
    };
    const next = [entry, ...customPayloads].slice(0, 40);
    setCustomPayloads(next);
    saveCustomPayloads(next);
    const pickId = `custom:${id}`;
    setTermPayloadPick(pickId);

    const subject = termSubject.trim();
    if (subject) {
      linkPayloadToSubject(subject, pickId);
      setToast({
        text: `Payload «${entry.label}» сохранён и связан с ${subject}`,
      });
    } else {
      setToast({ text: `Payload сохранён: ${entry.label}` });
    }
  }

  function deleteCustomSubject() {
    const subject = termSubject.trim();
    if (!subject) return;
    if (!customSubjects.some((s) => s.subject === subject)) {
      setToast({ text: "Это не свой subject", error: true });
      return;
    }
    if (!window.confirm(`Удалить свой subject «${subject}»?`)) return;
    const next = customSubjects.filter((s) => s.subject !== subject);
    setCustomSubjects(next);
    saveCustomSubjects(next);
    const builtin = findSubjectPresetFor(subject);
    if (builtin) {
      setTermSubjectPick(builtin.id);
      setTermSubject(builtin.subject);
      const first = builtin.payloadIds[0];
      if (first) applyPayloadPreset(first);
    } else {
      setTermSubjectPick("__custom__");
    }
    setToast({ text: `Удалён subject: ${subject}` });
  }

  function deleteCustomPayload() {
    if (!termPayloadPick.startsWith("custom:")) {
      setToast({ text: "Выберите свой payload в списке", error: true });
      return;
    }
    const id = termPayloadPick.slice("custom:".length);
    const found = customPayloads.find((p) => p.id === id);
    if (!found) return;
    if (!window.confirm(`Удалить payload «${found.label}»?`)) return;
    const pickKey = `custom:${id}`;
    const nextPayloads = customPayloads.filter((p) => p.id !== id);
    setCustomPayloads(nextPayloads);
    saveCustomPayloads(nextPayloads);
    const nextSubjects = customSubjects.map((s) => ({
      ...s,
      payloadIds: s.payloadIds.filter((x) => x !== pickKey),
    }));
    setCustomSubjects(nextSubjects);
    saveCustomSubjects(nextSubjects);
    const ids = associatedPayloadIds(termSubject.trim(), nextSubjects);
    const first = ids[0] ?? "empty";
    applyPayloadPreset(first);
    setToast({ text: `Удалён payload: ${found.label}` });
  }

  const linkedPayloadIds = useMemo(
    () => associatedPayloadIds(termSubject.trim(), customSubjects),
    [termSubject, customSubjects]
  );

  const filteredBuiltinPayloads = useMemo(() => {
    if (linkedPayloadIds.length === 0) return TERMINAL_PAYLOAD_PRESETS;
    const set = new Set(linkedPayloadIds.filter((x) => !x.startsWith("custom:")));
    const list = TERMINAL_PAYLOAD_PRESETS.filter((p) => set.has(p.id));
    return list.length > 0 ? list : TERMINAL_PAYLOAD_PRESETS;
  }, [linkedPayloadIds]);

  const filteredCustomPayloads = useMemo(() => {
    if (linkedPayloadIds.length === 0) return customPayloads;
    const set = new Set(
      linkedPayloadIds
        .filter((x) => x.startsWith("custom:"))
        .map((x) => x.slice("custom:".length))
    );
    return customPayloads.filter((p) => set.has(p.id));
  }, [linkedPayloadIds, customPayloads]);

  const canDeleteSubject = customSubjects.some(
    (s) => s.subject === termSubject.trim()
  );
  const canDeletePayload = termPayloadPick.startsWith("custom:");

  const subjectPresetHint = useMemo(() => {
    if (termSubjectPick.startsWith("custom:")) {
      const n = linkedPayloadIds.length;
      return `Свой subject · связанных payload: ${n}`;
    }
    const p = TERMINAL_SUBJECT_PRESETS.find((x) => x.id === termSubjectPick);
    if (!p) return "";
    return `${p.description} · payload: ${p.payloadIds.length}`;
  }, [termSubjectPick, linkedPayloadIds]);

  const payloadPresetHint = useMemo(() => {
    if (termPayloadPick.startsWith("custom:")) {
      const found = customPayloads.find(
        (p) => p.id === termPayloadPick.slice("custom:".length)
      );
      return found?.description || "Свой сохранённый payload";
    }
    const preset = TERMINAL_PAYLOAD_PRESETS.find((p) => p.id === termPayloadPick);
    if (!preset) return "";
    return `${preset.description} · обычно: ${preset.subjectsHint}`;
  }, [termPayloadPick, customPayloads]);

  return (
    <div className="stack">
      <div className={`panel${warn ? " panel-warn" : ""}`}>
        <h2>Modules Lab</h2>
        <div className="lab-toolbar">
          <span className={`badge${sessionOk ? " on" : " danger"}`}>
            {sessionOk
              ? session.natsOnline
                ? `Сессия · NATS probe ok`
                : `Сессия · probe NATS? · ${session.natsUrl ?? ""}`
              : "Нет сессии"}
          </span>
          <span className={`badge${live ? " on" : ""}`}>
            {live ? "NATS client ON" : "NATS client OFF"}
          </span>
          <span className="badge">{labEvents.length}</span>
          <ActionButton
            helpId="modules.nats"
            variant="primary"
            className="btn-compact"
            disabled={busy !== null || !canTryNats || live}
            onClick={() => void connectNats()}
          >
            {busy === "nats" ? "…" : "NATS"}
          </ActionButton>
          <ActionButton
            helpId="modules.off"
            className="btn-compact"
            disabled={busy !== null || !live}
            onClick={() => void disconnectNats()}
          >
            Off
          </ActionButton>
          <ActionButton
            helpId="modules.muster"
            className="btn-compact"
            disabled={controlsDisabled}
            onClick={() => void resolveMuster()}
          >
            Muster
          </ActionButton>
          <ActionButton
            helpId="modules.charts"
            className="btn-compact"
            disabled={labEvents.length === 0}
            onClick={() => setShowCharts((v) => !v)}
          >
            {showCharts ? "Графики▾" : "Графики"}
          </ActionButton>
          <ActionButton
            helpId="modules.tracks"
            className="btn-compact"
            onClick={() => setShowTrackPanel((v) => !v)}
          >
            {showTrackPanel ? "Треки▾" : "Треки"}
          </ActionButton>
          <ActionButton
            helpId="modules.csv"
            className="btn-compact"
            disabled={labEvents.length === 0}
            onClick={() => exportLabLog()}
          >
            CSV
          </ActionButton>
          <ActionButton
            helpId="modules.clear"
            className="btn-compact"
            disabled={labEvents.length === 0}
            onClick={() => {
              setLabEvents([]);
              pushLab("system", "clear", 0);
            }}
          >
            Clear
          </ActionButton>
          <label className="muted lab-select">
            host
            <HelpTip controlId="modules.host" />
            <select
              value={host}
              disabled={!live}
              onChange={(e) => setHost(e.target.value as DrinkxHost)}
            >
              {DRINKX_HOSTS.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </label>
          <label className="muted lab-select">
            hwid
            <HelpTip controlId="modules.hwid" />
            <select
              value={hwid}
              disabled={!live}
              onChange={(e) => setHwid(e.target.value)}
            >
              <option value={defaultHwid(host)}>{defaultHwid(host)}</option>
              {modules
                .filter((m) => m.hwid && m.hwid !== defaultHwid(host))
                .map((m) => (
                  <option key={m.hwid} value={m.hwid!}>
                    {m.hwid}
                    {m.role ? ` (${m.role})` : ""}
                  </option>
                ))}
            </select>
          </label>
        </div>
        {toast ? (
          <div className={`toast${toast.error ? " error" : ""}`}>
            {toast.text}
          </div>
        ) : null}
      </div>

      {showTrackPanel ? (
        <div className="panel panel-compact lab-track-panel">
          <h2>Отслеживание комплекса</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Выключенный модуль не опрашивается (status). Выключенный датчик не
            пишется в лог/график.
          </p>
          <div className="lab-track-modules">
            {DRINKX_HOSTS.map((mod) => (
              <label key={mod} className="lab-chart-check">
                <input
                  type="checkbox"
                  checked={labTrack.modules[mod] !== false}
                  onChange={(e) => {
                    updateLabTrack({
                      ...labTrack,
                      modules: {
                        ...labTrack.modules,
                        [mod]: e.target.checked,
                      },
                    });
                  }}
                />
                <span>
                  модуль <strong>{mod}</strong>
                </span>
              </label>
            ))}
          </div>
          <div className="lab-track-sensors">
            {complexSensorCatalog().map((key) => {
              const meta = chartSeriesMeta(key);
              const on = labTrack.sensors[key] !== false;
              return (
                <label key={key} className="lab-chart-check">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => {
                      updateLabTrack({
                        ...labTrack,
                        sensors: {
                          ...labTrack.sensors,
                          [key]: e.target.checked,
                        },
                      });
                    }}
                  />
                  <span>
                    {meta.label}
                    <span className="lab-chart-meta">
                      {meta.code}
                      {meta.unit ? ` · ${meta.unit}` : ""}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ) : null}

      {showCharts ? (
        <div className="panel">
          <h2>Графики комплекса</h2>
          <ModulesLabCharts
            {...chartCommonProps}
            sensorNames={chartSensorNames}
            groupByModule
          />
        </div>
      ) : null}

      <div className="lab-grid">
        <div className="lab-col">
      {host === "milk" ? (
        <div className="panel panel-compact">
          <h2>Молочные клапана</h2>
          <div className="device-list">
            {milkSystemValveNumbers().map((v) => (
              <ToggleRow
                key={v.valveNumber}
                label={v.label}
                code={`valve${v.valveNumber}`}
                on={milkValves[String(v.valveNumber)] ?? null}
                disabled={controlsDisabled}
                onToggle={() => void toggleMilkValve(v.valveNumber)}
              />
            ))}
          </div>
        </div>
      ) : null}

      <div className="panel panel-compact">
        <h2>Клапаны · {host}</h2>
        <div className="row" style={{ marginBottom: 10 }}>
          <ActionButton
            helpId="modules.valvesAll"
            disabled={!live || busy === "valves-all" || busy === "valve-pkg"}
            onClick={() => void setAllValves(true)}
          >
            Открыть все
          </ActionButton>
          <ActionButton
            helpId="modules.valvesAll"
            disabled={!live || busy === "valves-all" || busy === "valve-pkg"}
            onClick={() => void setAllValves(false)}
          >
            Закрыть все
          </ActionButton>
        </div>
        <div className="row" style={{ marginBottom: 10, flexWrap: "wrap" }}>
          <label className="muted lab-param">
            пакет
            <HelpTip controlId="modules.valvePackage" />
            <select
              value={valvePackageId}
              disabled={!live || busy !== null}
              onChange={(e) =>
                setValvePackageId(e.target.value as ValvePackageId)
              }
              onKeyDown={(e) =>
                onEnterNavigate(e, {
                  onAction: () => void runValvePackage(),
                })
              }
            >
              {VALVE_PACKAGES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <ActionButton
            helpId="modules.valvePackage"
            variant="primary"
            disabled={!live || busy !== null}
            onClick={() => void runValvePackage()}
          >
            Запуск пакета
          </ActionButton>
          <ActionButton
            helpId="modules.valvePackage"
            disabled={busy !== "valve-pkg"}
            onClick={() => abortValvePackage()}
          >
            Стоп
          </ActionButton>
        </div>
        <div className="device-list">
          {MODULE_VALVES[host].map((baseId) => (
            <ToggleRow
              key={baseId}
              label={VALVE_LABELS[baseId] ?? baseId}
              code={baseId}
              on={valves[baseId] ?? null}
              disabled={valveRowDisabled(baseId)}
              onToggle={() => void toggleValve(baseId)}
            />
          ))}
        </div>
      </div>

      <div className="panel panel-compact">
        <h2>Насос · {host}</h2>
        <div className="row" style={{ marginBottom: 10, flexWrap: "wrap", gap: 10 }}>
          <label className="muted lab-param">
            ms
            <HelpTip controlId="modules.pumpMs" />
            <input
              type="number"
              value={pumpDuration}
              min={500}
              max={60000}
              step={500}
              disabled={!live}
              onChange={(e) => setPumpDuration(Number(e.target.value) || 3000)}
              onKeyDown={(e) =>
                onEnterNavigate(e, { next: pumpPowerRef })
              }
            />
          </label>
          <label className="muted lab-param">
            power %
            <HelpTip controlId="modules.pumpPower" />
            <input
              ref={pumpPowerRef}
              type="number"
              value={pumpPower}
              min={0}
              max={100}
              disabled={!live}
              onChange={(e) => setPumpPower(Number(e.target.value) || 0)}
              onKeyDown={(e) =>
                onEnterNavigate(e, {
                  onAction: () => {
                    if (!controlsDisabled) void togglePump();
                  },
                })
              }
            />
          </label>
          <label className="muted lab-param">
            <input
              type="checkbox"
              checked={pumpWithHeaters}
              disabled={!live}
              onChange={(e) => setPumpWithHeaters(e.target.checked)}
            />
            + тены @ {heaterTarget}°C
            <HelpTip controlId="modules.pumpHeaters" />
          </label>
        </div>
        <ToggleRow
          label={`Насос ${host}`}
          code={`pumps.${host}`}
          on={
            pumpOn === true || (pumpPowerByHost[host] ?? 0) > 0 || busy === "pump"
              ? true
              : pumpOn
          }
          disabled={controlsDisabled}
          onToggle={() => void togglePump()}
          actionLabel={
            pumpOn === true ||
            (pumpPowerByHost[host] ?? 0) > 0 ||
            busy === "pump"
              ? "STOP"
              : "START"
          }
        />
        {(host === "milk" || host === "coffee") && (
          <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
            R_IS:{" "}
            <strong>
              {pumpCurrentByHost[host] != null
                ? `${pumpCurrentByHost[host]!.toFixed(3)} V`
                : "—"}
            </strong>
            {" · L_IS: "}
            <strong>
              {pumpCurrentLByHost[host] != null
                ? `${pumpCurrentLByHost[host]!.toFixed(3)} V`
                : "—"}
            </strong>
            {" · "}
            ШИМ~:{" "}
            <strong>
              {heaterPwmByHost[host]?.heater1 != null
                ? `${Math.round(heaterPwmByHost[host]!.heater1!)}%`
                : "—"}
              {" / "}
              {heaterPwmByHost[host]?.heater2 != null
                ? `${Math.round(heaterPwmByHost[host]!.heater2!)}%`
                : "—"}
            </strong>
            <span className="muted" style={{ fontSize: 11 }}>
              {" "}
              (оценка PID start 25–75%)
            </span>
            <HelpTip controlId="modules.dxUi" />
            <br />
            <span style={{ fontSize: 11 }}>
              В — сырое напряжение АЦП (Type:V в drinkx), не амперы. Поле{" "}
              <code>ms</code> — сколько крутить насос (до 60 с). Ошибка{" "}
              <code>timeout 2000ms</code> была ACK NATS (исправлено до 12 с), не
              лимит длительности.
            </span>
            {dxUiStatus ? (
              <>
                <br />
                <span style={{ fontSize: 11 }}>{dxUiStatus}</span>
              </>
            ) : null}
          </p>
        )}
        {(host === "milk" || host === "coffee") && !pumpOn ? (
          <div className="row" style={{ marginTop: 8 }}>
            <ActionButton
              helpId="modules.pumpReverse"
              disabled={controlsDisabled}
              onClick={() => void startPump("reverse")}
              title="Нужен cm-drv с direction/reverse в pumps.*!"
            >
              Реверс {pumpDuration} мс
            </ActionButton>
          </div>
        ) : null}
      </div>

      <div className="panel panel-compact">
        <h2>Нагреватели</h2>
        <div className="row" style={{ marginBottom: 10, flexWrap: "wrap", gap: 10 }}>
          <label className="muted lab-param">
            target °C
            <HelpTip controlId="modules.heaterTarget" />
            <input
              ref={heaterTargetRef}
              type="number"
              value={heaterTarget}
              min={20}
              max={95}
              disabled={!live}
              onChange={(e) =>
                setHeaterTarget(Number(e.target.value) || HEATER_TARGET_C)
              }
              onKeyDown={(e) =>
                onEnterNavigate(e, { next: heaterMaxOutRef })
              }
            />
          </label>
          <label className="muted lab-param">
            max out °C
            <HelpTip controlId="modules.heaterMaxOut" />
            <input
              ref={heaterMaxOutRef}
              type="number"
              value={warmupMaxOut}
              min={30}
              max={95}
              disabled={!live}
              onChange={(e) =>
                setWarmupMaxOut(
                  Number(e.target.value) || HEATER_WARMUP_DEFAULTS.maxOutC
                )
              }
              onKeyDown={(e) =>
                onEnterNavigate(e, { next: heaterAutoStopRef })
              }
            />
          </label>
          <label className="muted lab-param">
            авто-стоп с
            <HelpTip controlId="modules.heaterAutoStop" />
            <input
              ref={heaterAutoStopRef}
              type="number"
              value={heaterAutoStopSec}
              min={1}
              max={600}
              disabled={!live}
              onChange={(e) =>
                setHeaterAutoStopSec(Number(e.target.value) || 10)
              }
              onKeyDown={(e) =>
                onEnterNavigate(e, {
                  onAction: () => void runHeaterWarmup(),
                })
              }
            />
          </label>
        </div>
        <div className="row" style={{ marginBottom: 10 }}>
          <ActionButton
            helpId="modules.warmup"
            variant="primary"
            buttonRef={warmupBtnRef}
            disabled={!live || busy !== null}
            onClick={() => void runHeaterWarmup()}
          >
            Прогрев
          </ActionButton>
          <ActionButton
            helpId="modules.warmup"
            disabled={busy !== "warmup"}
            onClick={() => abortHeaterWarmup()}
          >
            Стоп прогрева
          </ActionButton>
          {warmupStatus ? (
            <span className="muted" style={{ alignSelf: "center" }}>
              {warmupStatus}
            </span>
          ) : null}
        </div>
        <div className="device-list">
          {HEATER_IDS.map((hid) => (
            <ToggleRow
              key={hid}
              label={HEATER_LABELS[hid]}
              code={hid}
              on={heaters[hid] ?? null}
              disabled={controlsDisabled}
              onToggle={() => void toggleHeater(hid)}
            />
          ))}
        </div>
      </div>

      <div className="panel panel-compact">
        <h2>Сервис</h2>
        <div className="row">
          {(host === "milk" || host === "coffee") && (
            <ActionButton
              helpId="modules.flush"
              disabled={controlsDisabled}
              onClick={() => void runFlush("milk")}
            >
              Flush milk
            </ActionButton>
          )}
          <ActionButton
            helpId="modules.flush"
            disabled={controlsDisabled}
            onClick={() => void runFlush("water")}
          >
            Flush water
          </ActionButton>
          <ActionButton
            disabled={controlsDisabled}
            onClick={() => {
              setPumpDuration(3000);
              void startPump();
            }}
          >
            Pump test 3с
          </ActionButton>
        </div>
        {host === "milk" || host === "coffee" ? (
          <div className="row" style={{ marginTop: 12 }}>
            <label className="muted">
              пена °C{" "}
              <input
                type="number"
                value={foamTemp}
                min={20}
                max={95}
                disabled={!live}
                onChange={(e) => setFoamTemp(Number(e.target.value))}
                style={{ width: 70 }}
              />
            </label>
            <label className="muted">
              air %{" "}
              <input
                type="number"
                value={foamAir}
                min={0}
                max={100}
                disabled={!live}
                onChange={(e) => setFoamAir(Number(e.target.value))}
                style={{ width: 70 }}
              />
            </label>
            <ActionButton
              disabled={controlsDisabled}
              onClick={() => void foamCook()}
            >
              Готовка пены
            </ActionButton>
          </div>
        ) : null}
      </div>

      <div className="panel panel-compact">
        <h2 className="row" style={{ gap: 8, alignItems: "center" }}>
          Сценарии
          <HelpTip controlId="lab.scenarios" />
        </h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Реальные ERP payload на NATS (как cm-drv / ComplexOS), не mock.
          Service/danger — после сервисного пароля. «?» — что ждать по кнопке.
        </p>
        <div
          className="stack"
          style={{ gap: 10, marginTop: 8 }}
        >
          {scenariosForHost(host).map((s) => (
            <div
              key={s.id}
              className="row"
              style={{
                flexWrap: "wrap",
                gap: 8,
                alignItems: "flex-start",
              }}
            >
              <ActionButton
                helpId={s.helpId}
                disabled={
                  controlsDisabled ||
                  (s.id === "stop-cm"
                    ? busy === "scenario-stop-cm"
                    : busy !== null)
                }
                onClick={() => void runLabScenario(s)}
              >
                {s.label}
                {s.expectedSec && s.expectedSec >= 30
                  ? ` (~${Math.ceil(s.expectedSec / 60)} мин)`
                  : ""}
              </ActionButton>
              <span className="muted" style={{ flex: "1 1 220px", fontSize: 12 }}>
                {scenarioHint(s)}
              </span>
            </div>
          ))}
          {(host === "milk" || host === "coffee") && !pumpOn ? (
            <div
              className="row"
              style={{
                flexWrap: "wrap",
                gap: 8,
                alignItems: "flex-start",
              }}
            >
              <ActionButton
                helpId="modules.pumpReverse"
                disabled={controlsDisabled}
                onClick={() => void startPump("reverse")}
              >
                Pump reverse
              </ActionButton>
              <span className="muted" style={{ flex: "1 1 220px", fontSize: 12 }}>
                Короткий реверс насоса (pumps.*! direction=reverse). Не rinse —
                только проверка направления. Смотрите ток на графике.
              </span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="panel panel-compact">
        <h2 className="row" style={{ gap: 8, alignItems: "center" }}>
          Brew Lab
          <HelpTip controlId="lab.brew" />
        </h2>
        <p className="muted" style={{ marginTop: 0 }}>
          qty — <strong>миллисекунды</strong> насоса, не мл. Нужен сервисный
          пароль + confirm.
        </p>
        <div className="row" style={{ flexWrap: "wrap", gap: 10 }}>
          <label className="muted lab-param">
            hwid
            <HelpTip controlId="lab.brew.hwid" />
            <select
              value={brewHwid}
              disabled={!live || !unlocked}
              onChange={(e) => setBrewHwid(e.target.value)}
            >
              {[...BREW_LAB_DEFAULTS.hwidOptions, hwid]
                .filter((v, i, a) => a.indexOf(v) === i)
                .map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
            </select>
          </label>
          <label className="muted lab-param">
            type
            <select
              value={brewType}
              disabled={!live || !unlocked}
              onChange={(e) => setBrewType(e.target.value as BrewLabPartType)}
            >
              <option value="coffee">coffee</option>
              <option value="milk">milk</option>
              <option value="water">water</option>
            </select>
          </label>
          <label className="muted lab-param">
            qty мс
            <HelpTip controlId="lab.brew.qty" />
            <input
              type="number"
              min={200}
              max={60000}
              step={100}
              value={brewQtyMs}
              disabled={!live || !unlocked}
              onChange={(e) => setBrewQtyMs(Number(e.target.value) || 0)}
              onKeyDown={(e) =>
                onEnterNavigate(e, {
                  onAction: () => {
                    if (unlocked) void runBrewLab();
                  },
                })
              }
            />
          </label>
          <label className="muted lab-param">
            temp °C
            <HelpTip controlId="lab.brew.temp" />
            <input
              type="number"
              min={20}
              max={95}
              value={brewTempC}
              disabled={!live || !unlocked}
              onChange={(e) => setBrewTempC(Number(e.target.value) || 65)}
            />
          </label>
          <label className="muted lab-param">
            <input
              type="checkbox"
              checked={brewAddMilk}
              disabled={!live || !unlocked}
              onChange={(e) => setBrewAddMilk(e.target.checked)}
            />
            + milk part
          </label>
          {brewAddMilk ? (
            <>
              <label className="muted lab-param">
                milk qty мс
                <input
                  type="number"
                  min={200}
                  max={60000}
                  value={brewMilkQtyMs}
                  disabled={!live || !unlocked}
                  onChange={(e) =>
                    setBrewMilkQtyMs(Number(e.target.value) || 0)
                  }
                />
              </label>
              <label className="muted lab-param">
                milk °C
                <input
                  type="number"
                  min={20}
                  max={95}
                  value={brewMilkTempC}
                  disabled={!live || !unlocked}
                  onChange={(e) =>
                    setBrewMilkTempC(Number(e.target.value) || 65)
                  }
                />
              </label>
            </>
          ) : null}
          <ActionButton
            helpId="lab.brew"
            variant="primary"
            disabled={controlsDisabled || !unlocked || busy !== null}
            onClick={() => void runBrewLab()}
          >
            Brew
          </ActionButton>
        </div>
      </div>

      {host === "water" ? (
        <div className="panel">
          <h2>Калибровка флоуметра</h2>
          <p className="lead">
            Total pulses:{" "}
            <strong className="metric">
              {waterPulses != null ? waterPulses : "—"}
            </strong>
            {" · "}
            Давление:{" "}
            <strong className="metric">
              {waterPressure != null
                ? `${waterPressure.toFixed(2)} bar`
                : "—"}
            </strong>
          </p>
          <div className="row">
            <ActionButton
              variant="primary"
              disabled={controlsDisabled}
              onClick={() => void runFlowCalibration()}
            >
              {busy === "calib" ? "Калибровка…" : "Старт калибровки 100–400 мл"}
            </ActionButton>
          </div>
          {calibStatus ? (
            <p className="muted" style={{ marginTop: 10 }}>
              {calibStatus}
            </p>
          ) : null}
          <table className="temps-table" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Цель мл</th>
                <th>Pulses</th>
                <th>Факт мл</th>
                <th>flowFactor</th>
              </tr>
            </thead>
            <tbody>
              {calibRows.map((r) => (
                <tr key={r.qty}>
                  <td>{r.qty}</td>
                  <td>{r.pulses ?? "—"}</td>
                  <td>{r.actualMl ?? "—"}</td>
                  <td>
                    {r.flowFactor != null ? r.flowFactor.toFixed(6) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {calibLog ? (
            <pre className="code-block" style={{ marginTop: 12, maxHeight: 220 }}>
              {calibLog}
            </pre>
          ) : null}
        </div>
      ) : null}
        </div>

        <div className="lab-col lab-sensors-sticky">
      <div className="panel panel-compact panel-sensors">
        <h2>
          Датчики комплекса <HelpTip controlId="modules.dxUi" />
        </h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
          R_IS / L_IS — DX UI (вольты). Мощность насоса — pumps.status. ШИМ —
          оценка heaters.status. Жёлтый = опрос замер (не mid-tick / не во время
          команды). Пустой ток → IP milk=.44 coffee=.45.
        </p>
        <div className="lab-sensor-module-toggles">
          {DRINKX_HOSTS.map((mod) => (
            <label key={mod} className="lab-chart-check">
              <input
                type="checkbox"
                checked={sensorModulesVisible[mod] !== false}
                onChange={(e) =>
                  setSensorModulesVisible((prev) => ({
                    ...prev,
                    [mod]: e.target.checked,
                  }))
                }
              />
              <span>{mod}</span>
            </label>
          ))}
        </div>
        {DRINKX_HOSTS.filter((m) => sensorModulesVisible[m] !== false).map(
          (mod) => {
            const keys = expectedTempKeys(mod);
            const now = Date.now();
            const pollStale = isTelemetryStale(labSnap, STALE_MS.temps, now);
            const actStale = isTelemetryStale(
              labSnap,
              STALE_MS.actuators,
              now
            );
            type Row = {
              key: string;
              label: string;
              value: string;
              muted: boolean;
              stale: boolean;
            };
            const rows: Row[] = keys.map((k) => {
              const sk = seriesKey(mod, k);
              const v = complexTemps[mod]?.[k];
              return {
                key: sk,
                label: TEMP_SENSOR_LABELS[k],
                value: v != null ? `${v.toFixed(1)} °C` : "—",
                muted: mutedSensorKeys.includes(sk),
                stale: v != null && pollStale,
              };
            });
            if (mod === "water") {
              rows.push(
                {
                  key: seriesKey("water", "waterPressure"),
                  label: "Давление",
                  value:
                    waterPressure != null
                      ? `${waterPressure.toFixed(2)} bar`
                      : "—",
                  muted: mutedSensorKeys.includes(
                    seriesKey("water", "waterPressure")
                  ),
                  stale: waterPressure != null && pollStale,
                },
                {
                  key: seriesKey("water", "waterTotalPulses"),
                  label: "Total pulses",
                  value: waterPulses != null ? String(waterPulses) : "—",
                  muted: mutedSensorKeys.includes(
                    seriesKey("water", "waterTotalPulses")
                  ),
                  stale: waterPulses != null && pollStale,
                }
              );
            }
            if (mod === "milk" || mod === "coffee") {
              const cur = pumpCurrentByHost[mod];
              const curL = pumpCurrentLByHost[mod];
              const pow =
                pumpPowerByHost[mod] ??
                (mod === host && pumpOn ? pumpPower : null);
              const pwm1 = heaterPwmByHost[mod]?.heater1;
              const pwm2 = heaterPwmByHost[mod]?.heater2;
              rows.push(
                {
                  key: seriesKey(mod, "pumpPower"),
                  label: "Насос мощность",
                  value: pow != null ? `${pow} %` : "—",
                  muted: mutedSensorKeys.includes(seriesKey(mod, "pumpPower")),
                  stale: pow != null && actStale,
                },
                {
                  key: seriesKey(mod, "pumpCurrent"),
                  label: "Насос R_IS",
                  value: cur != null ? `${cur.toFixed(3)} V` : "—",
                  muted: mutedSensorKeys.includes(
                    seriesKey(mod, "pumpCurrent")
                  ),
                  stale: cur != null && pollStale,
                },
                {
                  key: seriesKey(mod, "pumpCurrentL"),
                  label: "Насос L_IS",
                  value: curL != null ? `${curL.toFixed(3)} V` : "—",
                  muted: mutedSensorKeys.includes(
                    seriesKey(mod, "pumpCurrentL")
                  ),
                  stale: curL != null && pollStale,
                },
                {
                  key: seriesKey(mod, "heater1_pwm"),
                  label: "Тэн 1 ШИМ",
                  value: pwm1 != null ? `${pwm1.toFixed(0)} %` : "—",
                  muted: mutedSensorKeys.includes(
                    seriesKey(mod, "heater1_pwm")
                  ),
                  stale: pwm1 != null && actStale,
                },
                {
                  key: seriesKey(mod, "heater2_pwm"),
                  label: "Тэн 2 ШИМ",
                  value: pwm2 != null ? `${pwm2.toFixed(0)} %` : "—",
                  muted: mutedSensorKeys.includes(
                    seriesKey(mod, "heater2_pwm")
                  ),
                  stale: pwm2 != null && actStale,
                }
              );
            }
            const active = rows.filter((r) => !r.muted);
            const muted = rows.filter((r) => r.muted);
            const ordered = [...active, ...muted];
            return (
              <div key={mod} className="lab-sensor-module-block">
                <div className="lab-sensor-module-title">{mod}</div>
                <div className="sensor-list">
                  {ordered.map((row) => (
                    <button
                      key={row.key}
                      type="button"
                      className={`sensor-row sensor-row-btn${row.muted ? " sensor-muted" : ""}${row.stale ? " sensor-stale" : ""}`}
                      title={
                        row.stale
                          ? "Данные устарели (давно не обновлялись)"
                          : row.key.startsWith(`${mod}.__`)
                            ? undefined
                            : row.muted
                              ? "Включить отображение"
                              : "Скрыть в конец списка"
                      }
                      disabled={row.key.startsWith(`${mod}.__`)}
                      onClick={() => {
                        if (row.key.startsWith(`${mod}.__`)) return;
                        setMutedSensorKeys((prev) =>
                          prev.includes(row.key)
                            ? prev.filter((k) => k !== row.key)
                            : [...prev, row.key]
                        );
                      }}
                    >
                      <span>{row.label}</span>
                      <span className="metric">{row.value}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          }
        )}
        <div style={{ marginTop: 12 }}>
          <div className="row" style={{ marginBottom: 8, alignItems: "center" }}>
            <ActionButton
              className="btn-compact"
              onClick={() => setShowSensorCharts((v) => !v)}
            >
              {showSensorCharts ? "Графики датчиков▾" : "Графики датчиков"}
            </ActionButton>
            <span className="muted" style={{ fontSize: "0.8rem" }}>
              по умолчанию выкл · та же сетка, что под «Графики»
            </span>
          </div>
          {showSensorCharts ? (
            <ModulesLabCharts
              {...chartCommonProps}
              sensorNames={chartSensorNames}
              groupByModule
            />
          ) : null}
        </div>
      </div>
        </div>
      </div>

      <div className="panel">
        <h2 className="row" style={{ gap: 8, alignItems: "center" }}>
          Терминал / журнал
          <HelpTip controlId="modules.terminal" />
        </h2>
        <pre
          className="lab-terminal"
          ref={terminalRef}
          onScroll={onTerminalScroll}
        >
          {terminalText || "— лог пуст —"}
        </pre>
        <div className="lab-terminal-form">
          <div className="lab-terminal-presets">
            <label className="muted">
              <span className="row" style={{ gap: 6, alignItems: "center" }}>
                Куда отправить
                <HelpTip controlId="modules.terminal.subject" />
              </span>
              <select
                value={termSubjectPick}
                disabled={!live}
                onChange={(e) => applySubjectPreset(e.target.value)}
                onKeyDown={(e) =>
                  onEnterNavigate(e, { next: termSubjectInputRef })
                }
              >
                {TERMINAL_SUBJECT_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} — {p.subject}
                  </option>
                ))}
                {customSubjects.map((s) => (
                  <option key={`c-${s.subject}`} value={`custom:${s.subject}`}>
                    ★ {s.label}
                  </option>
                ))}
                <option value="__custom__">Свой subject (поле ниже)</option>
              </select>
            </label>
            <label className="muted">
              <span className="row" style={{ gap: 6, alignItems: "center" }}>
                Payload preset
                <HelpTip controlId="modules.terminal.payload" />
              </span>
              <select
                value={
                  filteredBuiltinPayloads.some((p) => p.id === termPayloadPick) ||
                  filteredCustomPayloads.some(
                    (p) => `custom:${p.id}` === termPayloadPick
                  ) ||
                  termPayloadPick === "__custom__"
                    ? termPayloadPick
                    : filteredBuiltinPayloads[0]?.id ??
                      (filteredCustomPayloads[0]
                        ? `custom:${filteredCustomPayloads[0].id}`
                        : "__custom__")
                }
                disabled={!live}
                onChange={(e) => applyPayloadPreset(e.target.value)}
                onKeyDown={(e) =>
                  onEnterNavigate(e, { next: termPayloadInputRef })
                }
              >
                {filteredBuiltinPayloads.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
                {filteredCustomPayloads.map((p) => (
                  <option key={p.id} value={`custom:${p.id}`}>
                    ★ {p.label}
                  </option>
                ))}
                <option value="__custom__">Свой JSON (поле ниже)</option>
              </select>
            </label>
          </div>
          {(subjectPresetHint || payloadPresetHint) && (
            <p className="muted lab-terminal-hint">
              {subjectPresetHint}
              {subjectPresetHint && payloadPresetHint ? " · " : ""}
              {payloadPresetHint}
            </p>
          )}
          <div className="lab-terminal-fields">
            <label className="muted">
              Subject (ручной ввод)
              <input
                ref={termSubjectInputRef}
                className="lab-term-subject"
                value={termSubject}
                disabled={!live}
                onChange={(e) => {
                  const v = e.target.value;
                  setTermSubject(v);
                  const trimmed = v.trim();
                  const builtin = findSubjectPresetFor(trimmed);
                  const custom = customSubjects.find(
                    (s) => s.subject === trimmed
                  );
                  if (custom) setTermSubjectPick(`custom:${custom.subject}`);
                  else if (builtin) setTermSubjectPick(builtin.id);
                  else setTermSubjectPick("__custom__");
                  const ids = associatedPayloadIds(trimmed, customSubjects);
                  if (
                    ids.length > 0 &&
                    termPayloadPick !== "__custom__" &&
                    !ids.includes(termPayloadPick)
                  ) {
                    applyPayloadPreset(ids[0]!);
                  }
                }}
                onKeyDown={(e) =>
                  onEnterNavigate(e, { next: termPayloadInputRef })
                }
                placeholder="coffeemachine.status"
                spellCheck={false}
              />
            </label>
            <label className="muted">
              <span className="row" style={{ gap: 8, alignItems: "baseline" }}>
                JSON payload (ручной ввод)
                <span className="lab-terminal-kbd">Ctrl+Enter — Send</span>
              </span>
              <textarea
                ref={termPayloadInputRef}
                className="lab-term-payload"
                value={termCmd}
                disabled={!live}
                onChange={(e) => {
                  setTermCmd(e.target.value);
                  setTermPayloadPick("__custom__");
                }}
                onKeyDown={(e) =>
                  onEnterNavigate(e, {
                    textareaUsesCtrlEnter: true,
                    onAction: () => void runTerminalCommand(),
                    next: termSendBtnRef,
                  })
                }
                placeholder="{}"
                spellCheck={false}
              />
            </label>
          </div>
          <div className="lab-terminal-actions">
            <ActionButton
              helpId="modules.terminal.send"
              variant="primary"
              buttonRef={termSendBtnRef}
              disabled={controlsDisabled}
              onClick={() => void runTerminalCommand()}
            >
              Send
            </ActionButton>
            <ActionButton
              helpId="modules.terminal.rememberSubject"
              className="btn-compact"
              disabled={!live || !termSubject.trim()}
              onClick={() => rememberSubject()}
            >
              Запомнить subject
            </ActionButton>
            <ActionButton
              helpId="modules.terminal.rememberPayload"
              className="btn-compact"
              disabled={!live}
              onClick={() => rememberPayload()}
            >
              Запомнить payload
            </ActionButton>
            <ActionButton
              helpId="modules.terminal.deleteSubject"
              className="btn-compact"
              disabled={!live || !canDeleteSubject}
              onClick={() => deleteCustomSubject()}
            >
              Удалить subject
            </ActionButton>
            <ActionButton
              helpId="modules.terminal.deletePayload"
              className="btn-compact"
              disabled={!live || !canDeletePayload}
              onClick={() => deleteCustomPayload()}
            >
              Удалить payload
            </ActionButton>
          </div>
          <button
            type="button"
            className="linkish"
            onClick={() => setShowPayloadRules((v) => !v)}
            style={{
              background: "none",
              border: "none",
              color: "inherit",
              cursor: "pointer",
              padding: 0,
              font: "inherit",
              alignSelf: "flex-start",
            }}
          >
            Правила payload {showPayloadRules ? "▾" : "▸"}
          </button>
          {showPayloadRules ? (
            <pre className="code-block lab-terminal-rules">
              {TERMINAL_PAYLOAD_RULES}
            </pre>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function scenarioHint(s: LabScenario): string {
  switch (s.id) {
    case "status-module":
      return "Чтение coffeemachine.status — безопасно. Ответ в логе Lab.";
    case "milkrinse-micro":
      return "ERP Micro-rinse ~2.5 мин. Ток pump_R_IS (V) с DX UI milk — при reverse не отрицательный. Stop CM не блокируется.";
    case "milkrinse-long":
      return "tubesLength=1500 ≈ 4 мин. Ток (V) на milk; reverse = тот же канал, без знака. Stop CM доступен.";
    case "stop-cm":
      return "Оборвать brew/мойку/rinse. Доступна во время сценария — не ждёт конца rinse.";
    default:
      return s.subject;
  }
}

function ToggleRow(props: {
  label: string;
  code: string;
  on: boolean | null;
  disabled: boolean;
  onToggle: () => void;
  actionLabel?: string;
}) {
  const active = props.on === true;
  const lampClass =
    props.on === true ? "lamp on" : props.on === false ? "lamp" : "lamp unk";
  return (
    <div className="device-row">
      <span className={lampClass} title={String(props.on)} />
      <div className="device-label">
        <span className="device-code">{props.code}</span>
        <span className="device-text">{props.label}</span>
      </div>
      <button
        type="button"
        className={`btn toggle-btn${active ? " toggle-on" : ""}`}
        disabled={props.disabled}
        onClick={props.onToggle}
      >
        {props.actionLabel ?? (active ? "ON" : "OFF")}
      </button>
    </div>
  );
}
