/**
 * Встроенный Industrial Service Control (без отдельного окна module_test).
 * Composition root: ModulesLabProvider + shell hooks + feature panels.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  defaultHwid,
  HEATER_TARGET_C,
  type DrinkxHost,
  type NatsMusterEntry,
} from "@service-monitor/core";
import { LabTerminalPanel } from "../components/modules/LabTerminalPanel";
import { ComplexSensorsPanel } from "../components/modules/ComplexSensorsPanel";
import { ModulesLabToolbar } from "../components/modules/ModulesLabToolbar";
import { ModulesLabTrackPanel } from "../components/modules/ModulesLabTrackPanel";
import { ModulesLabChartsSection } from "../components/modules/ModulesLabChartsSection";
import { BrewLabPanel } from "../components/modules/BrewLabPanel";
import { LabScenariosPanel } from "../components/modules/LabScenariosPanel";
import { MilkSystemValvesPanel } from "../components/modules/MilkSystemValvesPanel";
import { ModuleValvesPanel } from "../components/modules/ModuleValvesPanel";
import { ModulePumpPanel } from "../components/modules/ModulePumpPanel";
import { ModuleHeatersPanel } from "../components/modules/ModuleHeatersPanel";
import { ModuleServicePanel } from "../components/modules/ModuleServicePanel";
import { FlowCalibrationPanel } from "../components/modules/FlowCalibrationPanel";
import {
  ModulesLabProvider,
  type ModulesLabContextValue,
} from "../lab/modulesLab/ModulesLabContext";
import { resolveHwid } from "../lab/modulesLab/modulesLabHost";
import {
  availableChartSensorsFromEvents,
  buildLiveActuators,
  chartHeaterIds,
  chartSensorNamesFromEvents,
  chartValveIdsByModule,
} from "../lab/modulesLab/labEventLogHelpers";
import { useLabEventLog } from "../lab/modulesLab/useLabEventLog";
import { useLabTrack } from "../lab/modulesLab/useLabTrack";
import {
  useModulesLabCommandLock,
  useModulesLabReq,
} from "../lab/modulesLab/useModulesLabCommandLock";
import { useModulesLabNats } from "../lab/modulesLab/useModulesLabNats";
import { useModulesLabTelemetryBridge } from "../lab/modulesLab/useModulesLabTelemetryBridge";
import { useLabTelemetry } from "../lab/useLabTelemetry";
import { useComplexSession } from "../state/useComplexSession";

export function ModulesPage() {
  const { session, warn } = useComplexSession();
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(
    null
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [host, setHost] = useState<DrinkxHost>("milk");
  const [hwid, setHwid] = useState(defaultHwid("milk"));
  const [modules, setModules] = useState<NatsMusterEntry[]>([]);
  /** Shared with pump UI («+ тены @ N°C») and heaters panel. */
  const [heaterTarget, setHeaterTarget] = useState<number>(HEATER_TARGET_C);
  const [showCharts, setShowCharts] = useState(false);
  const [showSensorCharts, setShowSensorCharts] = useState(false);

  const scenarioBusyToken = useRef<object | null>(null);
  const heaterTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );
  /** Последнее залогированное состояние клапанов (DX + ms) → история графиков. */
  const lastValveLog = useRef<Record<string, boolean>>({});
  const valvePkgAbort = useRef<AbortController | null>(null);
  const warmupAbort = useRef<AbortController | null>(null);
  /** Не затирать состояние клапана опросом сразу после команды. */
  const valveHoldUntil = useRef<Map<string, number>>(new Map());
  const startPumpRef = useRef<
    (
      direction?: "forward" | "reverse",
      opts?: { durationMs?: number }
    ) => Promise<void>
  >(async () => undefined);
  const startHeatersForPumpRef = useRef<
    (session: number, isSessionCurrent: () => boolean) => Promise<void>
  >(async () => undefined);

  const hwidRef = useRef(hwid);
  hwidRef.current = hwid;
  const hostRef = useRef(host);
  hostRef.current = host;
  const modulesRef = useRef(modules);
  modulesRef.current = modules;

  const {
    labTrack,
    showTrackPanel,
    setShowTrackPanel,
    isModuleTracked,
    isSensorTracked,
    updateLabTrack,
  } = useLabTrack();

  const {
    labEvents,
    pushLab,
    pushSensorSample,
    exportLabLog,
    clearLabLog,
  } = useLabEventLog({
    hostRef,
    hwidRef,
    modulesRef,
    isSensorTracked,
    getHost: () => hostRef.current,
  });

  const {
    live,
    sessionOk,
    canTryNats,
    connectNats,
    disconnectNats,
    resolveMuster,
  } = useModulesLabNats({
    session,
    host,
    setHost,
    setHwid,
    setModules,
    hostRef,
    setBusy,
    setToast,
    valvePkgAbort,
    warmupAbort,
    heaterTimers,
  });

  const unlocked =
    typeof sessionStorage !== "undefined" &&
    sessionStorage.getItem("sm.writeUnlocked") === "1";

  const { snap: labSnap, controllerRef: labTelemetryRef } = useLabTelemetry({
    live,
    getActiveHost: () => hostRef.current,
    resolveHwid: (h) => resolveHwid(h, modulesRef.current),
    getSessionMode: () => session.mode,
    valveHoldUntil: valveHoldUntil.current,
    isModuleTracked,
  });

  const {
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
    heaterPwmByHost,
    setHeaterPwmByHost,
    pumpPowerByHost,
    setPumpPowerByHost,
    pumpCurrentByHost,
    pumpCurrentLByHost,
    dxUiStatus,
    waterPulses,
    waterPressure,
  } = useModulesLabTelemetryBridge({
    live,
    labSnap,
    hostRef,
    valveHoldUntil,
    lastValveLog,
    labTelemetryRef,
    pushLab,
    pushSensorSample,
  });

  const { withCommandLock, pollPaused, pollGeneration } =
    useModulesLabCommandLock({ labTelemetryRef });
  const { withHwid, req, ensureValve } = useModulesLabReq({
    hwidRef,
    hostRef,
    modulesRef,
  });

  const refreshDevices = useCallback(() => {
    labTelemetryRef.current?.kick();
  }, [labTelemetryRef]);

  const pollDxPumpCurrents = useCallback(() => {
    labTelemetryRef.current?.kickDx();
  }, [labTelemetryRef]);

  useEffect(() => {
    setHwid(resolveHwid(host, modulesRef.current));
    setValves({});
    setPumpOn(null);
    setHeaters({});
    // milkSystem valves — комплексные, не сбрасываем при смене host
    setTemps({});
    // calib rows reset — в FlowCalibrationPanel (useEffect по host)
    valveHoldUntil.current.clear();
    labTelemetryRef.current?.onHostChange();
  }, [host, labTelemetryRef, setValves, setPumpOn, setHeaters, setTemps]);

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

  const controlsDisabled = !live;

  const availableChartSensors = useMemo(
    () => availableChartSensorsFromEvents(labEvents),
    [labEvents]
  );
  const chartSensorNames = useMemo(
    () => chartSensorNamesFromEvents(labEvents),
    [labEvents]
  );
  const chartCommonProps = {
    events: labEvents,
    availableSensors: availableChartSensors,
    valveIdsByModule: chartValveIdsByModule(),
    heaterIds: chartHeaterIds(),
    liveActuators: buildLiveActuators({
      host,
      labSnap,
      valves,
      milkValves,
      pumpOn,
      labEvents,
    }),
  };

  const labCtx: ModulesLabContextValue = {
    live,
    unlocked,
    controlsDisabled,
    busy,
    setBusy,
    setToast,
    host,
    setHost,
    hwid,
    modules,
    hostRef,
    hwidRef,
    modulesRef,
    valves,
    setValves,
    milkValves,
    setMilkValves,
    pumpOn,
    setPumpOn,
    heaters,
    setHeaters,
    temps,
    setTemps,
    complexTemps,
    heaterPwmByHost,
    setHeaterPwmByHost,
    pumpPowerByHost,
    setPumpPowerByHost,
    pumpCurrentByHost,
    pumpCurrentLByHost,
    dxUiStatus,
    waterPulses,
    waterPressure,
    heaterTarget,
    setHeaterTarget,
    labSnap,
    labTelemetryRef,
    valveHoldUntil,
    lastValveLog,
    valvePkgAbort,
    warmupAbort,
    heaterTimers,
    pollPaused,
    pollGeneration,
    scenarioBusyToken,
    pushLab,
    pushSensorSample,
    req,
    withCommandLock,
    ensureValve,
    withHwid,
    refreshDevices,
    pollDxPumpCurrents,
    requireLabUnlock,
    setShowCharts,
    setShowSensorCharts,
    startPump: (direction, opts) => startPumpRef.current(direction, opts),
    registerStartPump: (fn) => {
      startPumpRef.current = fn;
    },
    startHeatersForPump: (s, isSessionCurrent) =>
      startHeatersForPumpRef.current(s, isSessionCurrent),
    registerStartHeatersForPump: (fn) => {
      startHeatersForPumpRef.current = fn;
    },
  };

  return (
    <ModulesLabProvider value={labCtx}>
      <div className="stack">
        <ModulesLabToolbar
          warn={warn}
          sessionOk={sessionOk}
          sessionNatsOnline={session.natsOnline}
          sessionNatsUrl={session.natsUrl}
          live={live}
          busy={busy}
          canTryNats={canTryNats}
          controlsDisabled={controlsDisabled}
          labEventsCount={labEvents.length}
          labEvents={labEvents}
          showCharts={showCharts}
          showTrackPanel={showTrackPanel}
          host={host}
          hwid={hwid}
          modules={modules}
          labSnap={labSnap}
          toast={toast}
          onConnectNats={() => void connectNats()}
          onDisconnectNats={() => void disconnectNats()}
          onResolveMuster={() => void resolveMuster()}
          onToggleCharts={() => setShowCharts((v) => !v)}
          onToggleTracks={() => setShowTrackPanel((v) => !v)}
          onExportCsv={() => {
            const count = exportLabLog();
            setToast({ text: `Лог выгружен (${count} событий)` });
          }}
          onClearLog={() => clearLabLog()}
          onHostChange={setHost}
          onHwidChange={setHwid}
        />

        <ModulesLabTrackPanel
          open={showTrackPanel}
          labTrack={labTrack}
          onUpdate={updateLabTrack}
        />

        <ModulesLabChartsSection
          open={showCharts}
          chartCommonProps={chartCommonProps}
          chartSensorNames={chartSensorNames}
        />

        <div className="lab-grid">
          <div className="lab-col">
            <MilkSystemValvesPanel />
            <ModuleValvesPanel />
            <ModulePumpPanel />
            <ModuleHeatersPanel />
            <ModuleServicePanel />
            <LabScenariosPanel />
            <BrewLabPanel />
            <FlowCalibrationPanel />
          </div>

          <ComplexSensorsPanel
            host={host}
            labSnap={labSnap}
            complexTemps={complexTemps}
            waterPressure={waterPressure}
            waterPulses={waterPulses}
            pumpCurrentByHost={pumpCurrentByHost}
            pumpCurrentLByHost={pumpCurrentLByHost}
            pumpPowerByHost={pumpPowerByHost}
            heaterPwmByHost={heaterPwmByHost}
            pumpOn={pumpOn}
            pumpPower={pumpPowerByHost[host] ?? 100}
            chartCommonProps={chartCommonProps}
            chartSensorNames={chartSensorNames}
            showSensorCharts={showSensorCharts}
            onShowSensorChartsChange={setShowSensorCharts}
          />
        </div>

        <LabTerminalPanel
          live={live}
          controlsDisabled={controlsDisabled}
          labEvents={labEvents}
          pushLab={pushLab}
          req={req}
          setToast={setToast}
        />
      </div>
    </ModulesLabProvider>
  );
}
