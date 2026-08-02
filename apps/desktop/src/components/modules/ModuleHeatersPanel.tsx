import { useLayoutEffect, useRef, useState } from "react";
import {
  HEATER_IDS,
  HEATER_AUTO_STOP_MS,
  HEATER_LABELS,
  HEATER_TARGET_C,
  HEATER_WARMUP_DEFAULTS,
  NATS_SUBJECTS,
  extractTempMap,
  heaterCommandSubject,
  heaterStopSubject,
  warmupOverheatKey,
  warmupSensorKey,
  type TempSensorKey,
} from "@service-monitor/core";
import { ActionButton } from "../ActionButton";
import { HelpTip } from "../HelpTip";
import { errText, sleep } from "../../lab/modulesLab/modulesLabHost";
import { useModulesLab } from "../../lab/modulesLab/ModulesLabContext";
import { onEnterNavigate } from "../../lib/form-nav";
import {
  estimatePwmForHeater,
  heaterOutletSensor,
  heaterShortId,
} from "./moduleHeatersHelpers";
import { ToggleRow } from "./ToggleRow";

export function ModuleHeatersPanel() {
  const {
    live,
    host,
    busy,
    setBusy,
    setToast,
    controlsDisabled,
    heaters,
    setHeaters,
    temps,
    setTemps,
    complexTemps,
    setHeaterPwmByHost,
    heaterTarget,
    setHeaterTarget,
    heaterTimers,
    warmupAbort,
    pollPaused,
    pollGeneration,
    labTelemetryRef,
    pushLab,
    pushSensorSample,
    req,
    withCommandLock,
    refreshDevices,
    registerStartHeatersForPump,
  } = useModulesLab();

  const [heaterAutoStopSec, setHeaterAutoStopSec] = useState(
    HEATER_AUTO_STOP_MS / 1000
  );
  const [warmupMaxOut, setWarmupMaxOut] = useState(
    HEATER_WARMUP_DEFAULTS.maxOutC
  );
  const [warmupStatus, setWarmupStatus] = useState("");
  const heaterTargetRef = useRef<HTMLInputElement | null>(null);
  const heaterMaxOutRef = useRef<HTMLInputElement | null>(null);
  const heaterAutoStopRef = useRef<HTMLInputElement | null>(null);
  const warmupBtnRef = useRef<HTMLButtonElement | null>(null);

  function pwmForHeater(hid: string): number {
    const sensor = heaterOutletSensor(hid);
    const temp =
      (sensor && temps[sensor]) ??
      (sensor && complexTemps[host]?.[sensor as TempSensorKey]) ??
      null;
    return estimatePwmForHeater(true, heaterTarget, temp);
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
      const short = heaterShortId(heaterId);
      if (short) {
        labTelemetryRef.current?.setHeater(host, short, false, 0);
        setHeaterPwmByHost((p) => ({
          ...p,
          [host]: { ...p[host], [short]: 0 },
        }));
        pushSensorSample(host, `${short}_pwm`, 0, 0.5);
      }
    } catch (e) {
      console.warn("[modules] stop heater", e);
    } finally {
      pollPaused.current = false;
      labTelemetryRef.current?.resume();
      void refreshDevices();
    }
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
      const short = heaterShortId(heaterId);
      const pwmEst = pwmForHeater(heaterId);
      if (short) {
        labTelemetryRef.current?.setHeater(host, short, true, pwmEst);
        setHeaterPwmByHost((p) => ({
          ...p,
          [host]: { ...p[host], [short]: pwmEst },
        }));
        pushSensorSample(host, `${short}_pwm`, pwmEst, 0.5);
      }
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

  async function toggleHeater(heaterId: string) {
    if (heaters[heaterId] === true) await stopHeater(heaterId);
    else await startHeater(heaterId);
  }

  async function startHeatersForPump(
    session: number,
    isSessionCurrent: () => boolean
  ) {
    const autoMs = Math.max(1, heaterAutoStopSec) * 1000;
    const failed: string[] = [];
    for (const hid of HEATER_IDS) {
      if (!isSessionCurrent()) return;
      try {
        const prev = heaterTimers.current.get(hid);
        if (prev) clearTimeout(prev);
        const res = await withCommandLock(() =>
          req(heaterCommandSubject(host, hid), { target: heaterTarget })
        );
        if (!isSessionCurrent()) return;
        if (res.ok) {
          const short = heaterShortId(hid);
          const pwmEst = pwmForHeater(hid);
          setHeaters((h) => ({ ...h, [hid]: true }));
          if (short) {
            labTelemetryRef.current?.setHeater(host, short, true, pwmEst);
            setHeaterPwmByHost((p) => ({
              ...p,
              [host]: { ...p[host], [short]: pwmEst },
            }));
            pushSensorSample(host, `${short}_pwm`, pwmEst, 0.5);
          }
          pushLab(
            "heater",
            hid,
            true,
            `with pump target=${heaterTarget}C pwm~${pwmEst}`
          );
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
    if (failed.length && isSessionCurrent()) {
      setToast({
        text: `Тэны с насосом: ${failed.join("; ")}`,
        error: true,
      });
    }
  }

  useLayoutEffect(() => {
    registerStartHeatersForPump(startHeatersForPump);
  });

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
      labTelemetryRef.current?.pause();

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
          setWarmupStatus(`${HEATER_LABELS[hid] ?? hid}: timeout, дальше…`);
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
      labTelemetryRef.current?.resume();
      setBusy(null);
      void refreshDevices();
    }
  }

  return (
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
            onKeyDown={(e) => onEnterNavigate(e, { next: heaterMaxOutRef })}
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
            onKeyDown={(e) => onEnterNavigate(e, { next: heaterAutoStopRef })}
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
  );
}
