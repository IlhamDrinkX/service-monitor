import {
  milkSystemValveHwIndex,
  milkSystemValveId,
  milkSystemValveNumbers,
  natsReplyIsError,
  seriesKey,
} from "@service-monitor/core";
import { HelpTip } from "../HelpTip";
import { errText } from "../../lab/modulesLab/modulesLabHost";
import { useModulesLab } from "../../lab/modulesLab/ModulesLabContext";
import { milkValveOpenNumbers } from "./milkSystemValvesHelpers";
import { ToggleRow } from "./ToggleRow";

export function MilkSystemValvesPanel() {
  const {
    milkValves,
    setMilkValves,
    controlsDisabled,
    setBusy,
    setToast,
    withCommandLock,
    req,
    labTelemetryRef,
    pushLab,
    lastValveLog,
  } = useModulesLab();

  async function toggleMilkValve(valveNumber: number) {
    const key = String(valveNumber);
    const next = !(milkValves[key] === true);
    const id = milkSystemValveId(valveNumber);
    const hwIndex = milkSystemValveHwIndex(valveNumber);
    if (hwIndex == null || !id) return;
    setBusy(`milk-v-${valveNumber}`);
    setMilkValves((m) => ({ ...m, [key]: next }));
    pushLab("valve", id, next, next ? "cmd open" : "cmd close", "milk");
    lastValveLog.current[seriesKey("milk", id)] = next;
    const openNow = milkValveOpenNumbers(milkValves, valveNumber, next);
    labTelemetryRef.current?.setMilkSystemOpen(openNow, "cmd");

    const revert = () => {
      setMilkValves((m) => ({ ...m, [key]: !next }));
      pushLab("valve", id, !next, "cmd revert", "milk");
      lastValveLog.current[seriesKey("milk", id)] = !next;
      const openRevert = milkValveOpenNumbers(milkValves, valveNumber, !next);
      labTelemetryRef.current?.setMilkSystemOpen(openRevert, "cmd");
    };

    try {
      await withCommandLock(async () => {
        const subject = next
          ? "coffeemachine.debug-valves-on"
          : "coffeemachine.debug-valves-off";
        // ERP: milk-N.valves = [N]; debug-valves / bus используют тот же номер (не N-1).
        const res = await req(subject, { nozzleId: 0, valves: [hwIndex] });
        const body = res.ok ? res.data : null;
        const failed = !res.ok || natsReplyIsError(body);
        if (failed) {
          const errMsg = !res.ok
            ? String(res.error)
            : String(
                (body &&
                  typeof body === "object" &&
                  (body as { result?: unknown }).result) ??
                  "error"
              );
          setToast({
            text: `${errMsg} · на dx-facade debug-valves часто Not implemented; live — bus complexos.valves.switched при brew`,
            error: true,
          });
          revert();
        }
      });
    } catch (e) {
      setToast({ text: errText(e), error: true });
      revert();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="panel panel-compact">
      <h2 className="row" style={{ gap: 8, alignItems: "center" }}>
        Молочные клапана
        <HelpTip controlId="modules.milkValves" />
      </h2>
      <p className="muted" style={{ marginTop: 0, fontSize: 11 }}>
        Холодильник · номер N = milk-N / bus valves [N]. Live из{" "}
        <code>complexos.valves.switched</code> при brew. На dx-facade
        debug-valves часто Not implemented — кнопка тогда откатывается.
        Жёлтая лампа = ещё не было события.
      </p>
      <div className="device-list">
        {milkSystemValveNumbers().map((v) => (
          <ToggleRow
            key={v.valveNumber}
            label={v.label}
            code={v.id}
            on={milkValves[String(v.valveNumber)] ?? null}
            disabled={controlsDisabled}
            onToggle={() => void toggleMilkValve(v.valveNumber)}
          />
        ))}
      </div>
    </div>
  );
}
