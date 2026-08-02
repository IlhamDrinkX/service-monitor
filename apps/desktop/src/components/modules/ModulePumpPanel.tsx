import { useLayoutEffect, useRef, useState } from "react";
import {
  pumpCommandPayload,
  pumpCommandSubject,
  pumpStopSubject,
  seriesKey,
} from "@service-monitor/core";
import { ActionButton } from "../ActionButton";
import { HelpTip } from "../HelpTip";
import { errText } from "../../lab/modulesLab/modulesLabHost";
import { useModulesLab } from "../../lab/modulesLab/ModulesLabContext";
import { onEnterNavigate } from "../../lib/form-nav";
import { isPumpRunning } from "./modulePumpHelpers";
import { ToggleRow } from "./ToggleRow";

export function ModulePumpPanel() {
  const {
    live,
    host,
    busy,
    setBusy,
    setToast,
    controlsDisabled,
    pumpOn,
    setPumpOn,
    pumpPowerByHost,
    setPumpPowerByHost,
    pumpCurrentByHost,
    pumpCurrentLByHost,
    heaterPwmByHost,
    heaterTarget,
    dxUiStatus,
    labTelemetryRef,
    pushLab,
    pushSensorSample,
    lastValveLog,
    req,
    withCommandLock,
    refreshDevices,
    pollDxPumpCurrents,
    startHeatersForPump,
    registerStartPump,
  } = useModulesLab();

  const [pumpDuration, setPumpDuration] = useState(3000);
  const [pumpPower, setPumpPower] = useState(100);
  const [pumpWithHeaters, setPumpWithHeaters] = useState(true);
  const pumpPowerRef = useRef<HTMLInputElement | null>(null);
  /** Инкремент отменяет in-flight startPump (STOP во время тэнов). */
  const pumpSessionRef = useRef(0);
  const pumpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pumpDurationRef = useRef(pumpDuration);
  pumpDurationRef.current = pumpDuration;
  const pumpPowerLocalRef = useRef(pumpPower);
  pumpPowerLocalRef.current = pumpPower;
  const pumpWithHeatersRef = useRef(pumpWithHeaters);
  pumpWithHeatersRef.current = pumpWithHeaters;

  function burstDxPumpCurrents() {
    void pollDxPumpCurrents();
    window.setTimeout(() => void pollDxPumpCurrents(), 350);
    window.setTimeout(() => void pollDxPumpCurrents(), 900);
    window.setTimeout(() => void pollDxPumpCurrents(), 1_800);
  }

  async function startPump(
    direction: "forward" | "reverse" = "forward",
    opts?: { durationMs?: number }
  ) {
    const session = ++pumpSessionRef.current;
    const durationMs = opts?.durationMs ?? pumpDurationRef.current;
    const power = pumpPowerLocalRef.current;
    if (opts?.durationMs != null) {
      setPumpDuration(opts.durationMs);
      pumpDurationRef.current = opts.durationMs;
    }
    setBusy("pump");
    // Сразу STOP + cmd в телеметрии — опрос не откатит лампу на OFF во время тэнов.
    setPumpOn(true);
    pushSensorSample(host, "pumpPower", power, 0.5);
    setPumpPowerByHost((p) => ({ ...p, [host]: power }));
    labTelemetryRef.current?.setPumpPower(host, power, true);
    burstDxPumpCurrents();
    try {
      if (direction === "forward" && pumpWithHeatersRef.current) {
        await startHeatersForPump(
          session,
          () => session === pumpSessionRef.current
        );
        if (session !== pumpSessionRef.current) return;
      }
      const payload = pumpCommandPayload({
        durationMs,
        powerPercent: power,
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
        `${direction} power%=${power} pwm=${payload.power} ms=${durationMs}`
      );
      lastValveLog.current[seriesKey(host, "pump")] = true;
      // Обновить cmd timestamp после реального ACK
      labTelemetryRef.current?.setPumpPower(host, power, true);
      burstDxPumpCurrents();
      if (pumpTimerRef.current) clearTimeout(pumpTimerRef.current);
      pumpTimerRef.current = setTimeout(() => {
        if (session !== pumpSessionRef.current) return;
        pumpTimerRef.current = null;
        setPumpOn(false);
        pushLab("pump", "pump", false, "duration elapsed");
        lastValveLog.current[seriesKey(host, "pump")] = false;
        pushSensorSample(host, "pumpPower", 0, 0.5);
        setPumpPowerByHost((p) => ({ ...p, [host]: 0 }));
        labTelemetryRef.current?.setPumpPower(host, 0, false);
        void refreshDevices();
        burstDxPumpCurrents();
      }, durationMs + 200);
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
      lastValveLog.current[seriesKey(host, "pump")] = false;
    } catch (e) {
      setToast({ text: errText(e), error: true });
    } finally {
      setBusy(null);
      burstDxPumpCurrents();
    }
  }

  async function togglePump() {
    const running = isPumpRunning(pumpOn, pumpPowerByHost[host], busy);
    if (running) await stopPump();
    else await startPump("forward");
  }

  useLayoutEffect(() => {
    registerStartPump(startPump);
  });

  const running = isPumpRunning(pumpOn, pumpPowerByHost[host], busy);

  return (
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
            onKeyDown={(e) => onEnterNavigate(e, { next: pumpPowerRef })}
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
        on={running ? true : pumpOn}
        disabled={controlsDisabled}
        onToggle={() => void togglePump()}
        actionLabel={running ? "STOP" : "START"}
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
  );
}
