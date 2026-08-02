/**
 * Панель сиропа (Modbus) + flash partA/partB на Host dozator.
 * Stage 6: scan/motor params, live log, in-app flash, legacy launch свёрнут.
 */

import { useEffect, useState } from "react";
import { ActionButton } from "./ActionButton";

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

type Props = {
  busy: string | null;
  setBusy: (v: string | null) => void;
  onToast: (t: { text: string; error?: boolean }) => void;
};

export function SyrupFlashPanel({ busy, setBusy, onToast }: Props) {
  const [maxId, setMaxId] = useState(32);
  const [baud, setBaud] = useState(9600);
  const [singleBaud, setSingleBaud] = useState(false);
  const [motorId, setMotorId] = useState(1);
  const [seconds, setSeconds] = useState(2);
  const [intensity, setIntensity] = useState(50);
  const [syrupOut, setSyrupOut] = useState("");

  const [currentId, setCurrentId] = useState(1);
  const [newId, setNewId] = useState(2);
  const [currentBaud, setCurrentBaud] = useState(9600);
  const [newBaud, setNewBaud] = useState(19200);
  const [flashLog, setFlashLog] = useState("");
  /** Legacy Electron-окна flash_sirup / sirup_test — свёрнуты по умолчанию */
  const [legacyOpen, setLegacyOpen] = useState(false);

  useEffect(() => {
    return window.desktop.onFlashLog((entry) => {
      setFlashLog((prev) => prev + entry.message);
    });
  }, []);

  async function checkSsh() {
    setBusy("syrup-check");
    try {
      const res = await window.desktop.syrupCheckSsh();
      if (!res.ok) onToast({ text: res.error, error: true });
      else onToast({ text: res.message });
    } catch (e) {
      onToast({ text: errText(e), error: true });
    } finally {
      setBusy(null);
    }
  }

  async function runScan() {
    setBusy("syrup-scan");
    setSyrupOut("");
    try {
      const res = await window.desktop.syrupModbusScan({
        mode: "scan",
        maxId,
        baud: singleBaud ? baud : undefined,
        singleMode: singleBaud,
      });
      if (!res.ok) {
        onToast({ text: res.error, error: true });
        return;
      }
      setSyrupOut(res.output);
      onToast({ text: "Modbus scan OK" });
    } catch (e) {
      onToast({ text: errText(e), error: true });
    } finally {
      setBusy(null);
    }
  }

  async function runMotor() {
    setBusy("syrup-motor");
    setSyrupOut("");
    try {
      const res = await window.desktop.syrupModbusScan({
        mode: "motor",
        baud,
        id: motorId,
        seconds,
        intensity,
      });
      if (!res.ok) {
        onToast({ text: res.error, error: true });
        return;
      }
      setSyrupOut(res.output);
      onToast({ text: "Motor test OK" });
    } catch (e) {
      onToast({ text: errText(e), error: true });
    } finally {
      setBusy(null);
    }
  }

  async function runPartA() {
    setBusy("flash-a");
    setFlashLog("");
    try {
      const res = await window.desktop.flashPartA({
        currentId,
        newId,
        currentBaud,
        newBaud,
      });
      if (!res.ok) {
        onToast({ text: res.error, error: true });
        return;
      }
      onToast({ text: "Flash partA OK" });
    } catch (e) {
      onToast({ text: errText(e), error: true });
    } finally {
      setBusy(null);
    }
  }

  async function runPartB() {
    setBusy("flash-b");
    setFlashLog("");
    try {
      const res = await window.desktop.flashPartB({ newId, newBaud });
      if (!res.ok) {
        onToast({ text: res.error, error: true });
        return;
      }
      onToast({ text: "Flash partB OK" });
    } catch (e) {
      onToast({ text: errText(e), error: true });
    } finally {
      setBusy(null);
    }
  }

  const disabled = busy !== null;

  return (
    <>
      <div className="panel">
        <h2>Сироп · Modbus / стенд dozator</h2>
        <p className="lead">
          SSH Host <code>dozator</code> → <code>modbus-cli.js</code> на{" "}
          <code>/dev/ttySC0</code> (не NATS на комплексе).
        </p>
        <div className="row" style={{ marginBottom: 10 }}>
          <label className="muted">
            maxId{" "}
            <input
              type="number"
              value={maxId}
              min={1}
              max={247}
              disabled={disabled}
              onChange={(e) => setMaxId(Number(e.target.value) || 32)}
              style={{ width: 70 }}
            />
          </label>
          <label className="muted">
            baud{" "}
            <input
              type="number"
              value={baud}
              disabled={disabled}
              onChange={(e) => setBaud(Number(e.target.value) || 9600)}
              style={{ width: 90 }}
            />
          </label>
          <label className="muted" style={{ display: "flex", gap: 6 }}>
            <input
              type="checkbox"
              checked={singleBaud}
              disabled={disabled}
              onChange={(e) => setSingleBaud(e.target.checked)}
            />
            scan на одном baud
          </label>
        </div>
        <div className="row" style={{ marginBottom: 10 }}>
          <label className="muted">
            motor id{" "}
            <input
              type="number"
              value={motorId}
              min={1}
              disabled={disabled}
              onChange={(e) => setMotorId(Number(e.target.value) || 1)}
              style={{ width: 60 }}
            />
          </label>
          <label className="muted">
            sec{" "}
            <input
              type="number"
              value={seconds}
              min={1}
              max={60}
              disabled={disabled}
              onChange={(e) => setSeconds(Number(e.target.value) || 2)}
              style={{ width: 60 }}
            />
          </label>
          <label className="muted">
            intensity{" "}
            <input
              type="number"
              value={intensity}
              min={0}
              max={100}
              disabled={disabled}
              onChange={(e) => setIntensity(Number(e.target.value) || 0)}
              style={{ width: 70 }}
            />
          </label>
        </div>
        <div className="row">
          <ActionButton
            helpId="modules.syrup"
            disabled={disabled}
            onClick={() => void checkSsh()}
          >
            {busy === "syrup-check" ? "…" : "SSH check"}
          </ActionButton>
          <ActionButton
            variant="primary"
            disabled={disabled}
            onClick={() => void runScan()}
          >
            {busy === "syrup-scan" ? "…" : "Scan"}
          </ActionButton>
          <ActionButton disabled={disabled} onClick={() => void runMotor()}>
            {busy === "syrup-motor" ? "…" : "Motor"}
          </ActionButton>
        </div>
        {syrupOut ? (
          <pre className="code-block" style={{ marginTop: 12, maxHeight: 220 }}>
            {syrupOut}
          </pre>
        ) : null}
      </div>

      <div className="panel">
        <h2>Flash сироп · partA / partB</h2>
        <p className="lead">
          Remote <code>flash-cli.js</code> на dozator (нужен установленный
          backend в <code>automatic_dozator</code>).
        </p>
        <div className="row" style={{ marginBottom: 10 }}>
          <label className="muted">
            currentId{" "}
            <input
              type="number"
              value={currentId}
              disabled={disabled}
              onChange={(e) => setCurrentId(Number(e.target.value) || 1)}
              style={{ width: 70 }}
            />
          </label>
          <label className="muted">
            newId{" "}
            <input
              type="number"
              value={newId}
              disabled={disabled}
              onChange={(e) => setNewId(Number(e.target.value) || 2)}
              style={{ width: 70 }}
            />
          </label>
          <label className="muted">
            oldBaud{" "}
            <input
              type="number"
              value={currentBaud}
              disabled={disabled}
              onChange={(e) => setCurrentBaud(Number(e.target.value) || 9600)}
              style={{ width: 90 }}
            />
          </label>
          <label className="muted">
            newBaud{" "}
            <input
              type="number"
              value={newBaud}
              disabled={disabled}
              onChange={(e) => setNewBaud(Number(e.target.value) || 19200)}
              style={{ width: 90 }}
            />
          </label>
        </div>
        <div className="row">
          <ActionButton
            helpId="modules.flash"
            variant="primary"
            disabled={disabled}
            onClick={() => void runPartA()}
          >
            {busy === "flash-a" ? "…" : "Part A"}
          </ActionButton>
          <ActionButton disabled={disabled} onClick={() => void runPartB()}>
            {busy === "flash-b" ? "…" : "Part B"}
          </ActionButton>
        </div>
        {flashLog ? (
          <pre className="code-block" style={{ marginTop: 12, maxHeight: 240 }}>
            {flashLog}
          </pre>
        ) : null}
      </div>

      <div className="panel panel-compact">
        <button
          type="button"
          className="btn stand-disclosure-btn"
          aria-expanded={legacyOpen}
          onClick={() => setLegacyOpen((v) => !v)}
        >
          <span className="stand-disclosure-chevron" aria-hidden>
            {legacyOpen ? "▾" : "▸"}
          </span>
          Legacy окна (flash_sirup / sirup_test)
        </button>
        {!legacyOpen ? (
          <p className="muted stand-disclosure-hint">
            Предпочтительны in-app Part A/B выше. Отдельные Electron-окна — только
            если нужен старый UI из fleet-foundry.
          </p>
        ) : (
          <div className="row" style={{ marginTop: 10, flexWrap: "wrap", gap: 8 }}>
            <ActionButton
              className="btn-compact"
              disabled={disabled}
              onClick={() =>
                void window.desktop
                  .launchFleetTool({ tool: "flash_sirup" })
                  .catch((e) => onToast({ text: errText(e), error: true }))
              }
            >
              flash_sirup (окно)
            </ActionButton>
            <ActionButton
              className="btn-compact"
              disabled={disabled}
              onClick={() =>
                void window.desktop
                  .launchFleetTool({ tool: "sirup_test" })
                  .catch((e) => onToast({ text: errText(e), error: true }))
              }
            >
              sirup_test (окно)
            </ActionButton>
          </div>
        )}
      </div>
    </>
  );
}
