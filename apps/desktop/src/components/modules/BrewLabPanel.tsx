import { useState } from "react";
import {
  BREW_LAB_DEFAULTS,
  NATS_SUBJECTS,
  buildBrewLabPayload,
  type BrewLabPartType,
} from "@service-monitor/core";
import { ActionButton } from "../ActionButton";
import { HelpTip } from "../HelpTip";
import { onEnterNavigate } from "../../lib/form-nav";
import { smLog } from "../../lib/sm-log";
import { useModulesLab } from "../../lab/modulesLab/ModulesLabContext";
import { brewLabPartsFromForm } from "./brewLabHelpers";

export function BrewLabPanel() {
  const {
    live,
    unlocked,
    controlsDisabled,
    busy,
    setBusy,
    hwid,
    setToast,
    pushLab,
    req,
    pollPaused,
    labTelemetryRef,
    refreshDevices,
    requireLabUnlock,
  } = useModulesLab();

  const [brewHwid, setBrewHwid] = useState<string>("dx");
  const [brewType, setBrewType] = useState<BrewLabPartType>("coffee");
  const [brewQtyMs, setBrewQtyMs] = useState<number>(BREW_LAB_DEFAULTS.qtyMs);
  const [brewTempC, setBrewTempC] = useState<number>(BREW_LAB_DEFAULTS.tempC);
  const [brewAddMilk, setBrewAddMilk] = useState(false);
  const [brewMilkQtyMs, setBrewMilkQtyMs] = useState(8000);
  const [brewMilkTempC, setBrewMilkTempC] = useState(65);

  async function runBrewLab() {
    if (!requireLabUnlock()) return;
    if (
      !window.confirm(
        "Brew Lab нальёт в группу (qty = мс насоса). Убедитесь, что стакан на месте. Продолжить?"
      )
    ) {
      return;
    }
    const parts = brewLabPartsFromForm({
      type: brewType,
      qtyMs: brewQtyMs,
      tempC: brewTempC,
      addMilk: brewAddMilk,
      milkQtyMs: brewMilkQtyMs,
      milkTempC: brewMilkTempC,
    });
    const payload = buildBrewLabPayload({
      hwid: brewHwid || hwid || "dx",
      parts,
    });
    smLog("info", "brew-lab", "start", payload);
    pollPaused.current = true;
    labTelemetryRef.current?.pause();
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
      labTelemetryRef.current?.resume();
    }
  }

  return (
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
  );
}
