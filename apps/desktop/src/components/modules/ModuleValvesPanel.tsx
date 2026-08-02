import { useState } from "react";
import {
  MODULE_VALVES,
  VALVE_LABELS,
  VALVE_PACKAGES,
  extractEnabledState,
  getValvePackage,
  seriesKey,
  valveStatusSubject,
  type ValvePackageId,
} from "@service-monitor/core";
import { ActionButton } from "../ActionButton";
import { HelpTip } from "../HelpTip";
import { errText, sleep } from "../../lab/modulesLab/modulesLabHost";
import { useModulesLab } from "../../lab/modulesLab/ModulesLabContext";
import { onEnterNavigate } from "../../lib/form-nav";
import { isValveRowDisabled } from "./moduleValvesHelpers";
import { ToggleRow } from "./ToggleRow";

export function ModuleValvesPanel() {
  const {
    live,
    host,
    hostRef,
    busy,
    setBusy,
    setToast,
    valves,
    setValves,
    valveHoldUntil,
    valvePkgAbort,
    ensureValve,
    withCommandLock,
    pushLab,
    labTelemetryRef,
    req,
  } = useModulesLab();

  const [valvePackageId, setValvePackageId] =
    useState<ValvePackageId>("sequential_cycle");

  async function toggleValve(baseId: string) {
    const next = !(valves[baseId] === true);
    const activeHost = hostRef.current;
    const vKey = seriesKey(activeHost, baseId);
    setBusy(`valve-${baseId}`);
    // Оптимистично + hold 4с — poll не должен гасить лампу до verify.
    setValves((v) => ({ ...v, [baseId]: next }));
    valveHoldUntil.current.set(vKey, Date.now() + 4_000);
    labTelemetryRef.current?.setValve(vKey, next);
    pushLab("valve", baseId, next, next ? "cmd open" : "cmd close", activeHost);
    try {
      await withCommandLock(async () => {
        const res = await ensureValve(baseId, next);
        if (res.enabled !== undefined) {
          setValves((v) => ({ ...v, [baseId]: res.enabled! }));
          labTelemetryRef.current?.setValve(vKey, res.enabled!);
          valveHoldUntil.current.set(vKey, Date.now() + 4_000);
        }
        if (!res.ok) {
          pushLab(
            "valve",
            baseId,
            res.enabled ?? null,
            res.error || "verify failed",
            activeHost
          );
          setToast({
            text: res.error || `Клапан ${baseId}: не подтверждён`,
            error: true,
          });
          if (res.enabled === undefined) {
            const st = await req(
              valveStatusSubject(activeHost, baseId),
              {},
              700,
              "command"
            );
            const got = st.ok ? extractEnabledState(st.data) : null;
            if (got != null) {
              setValves((v) => ({ ...v, [baseId]: got }));
              labTelemetryRef.current?.setValve(vKey, got);
              valveHoldUntil.current.set(vKey, Date.now() + 2_000);
            } else {
              valveHoldUntil.current.delete(vKey);
            }
          }
        } else {
          pushLab("valve", baseId, res.enabled ?? next, "verified", activeHost);
        }
      });
    } finally {
      valveHoldUntil.current.delete(vKey);
      setBusy(null);
    }
  }

  async function setAllValves(enabled: boolean) {
    const activeHost = hostRef.current;
    setBusy("valves-all");
    setValves((prev) => {
      const next = { ...prev };
      for (const id of MODULE_VALVES[activeHost]) {
        next[id] = enabled;
        const vKey = seriesKey(activeHost, id);
        valveHoldUntil.current.set(vKey, Date.now() + 4_000);
        labTelemetryRef.current?.setValve(vKey, enabled);
      }
      return next;
    });
    try {
      await withCommandLock(async () => {
        for (const baseId of MODULE_VALVES[activeHost]) {
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

  return (
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
            disabled={isValveRowDisabled(baseId, live, busy)}
            onToggle={() => void toggleValve(baseId)}
          />
        ))}
      </div>
    </div>
  );
}
