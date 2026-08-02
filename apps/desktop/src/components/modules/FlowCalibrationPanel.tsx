import { useEffect, useState } from "react";
import {
  FLOW_CALIBRATION_BREW_TIMEOUT_MS,
  FLOW_CALIBRATION_PULSES_POLL_MS,
  FLOW_CALIBRATION_QTYS,
  FLOW_CALIBRATION_SWITCH_DELAY_MS,
  NATS_SUBJECTS,
  extractWaterTotalPulses,
  valveCommandSubject,
} from "@service-monitor/core";
import { ActionButton } from "../ActionButton";
import { errText, sleep } from "../../lab/modulesLab/modulesLabHost";
import { useModulesLab } from "../../lab/modulesLab/ModulesLabContext";
import type { CalibRow } from "../../lab/modulesLab/modulesLabTypes";
import {
  averageFlowFactor,
  calibPulsesDelta,
  computeStepFlowFactor,
  initialCalibRows,
  isValidPulsesDelta,
  parseActualMl,
} from "./flowCalibrationHelpers";

export function FlowCalibrationPanel() {
  const {
    host,
    unlocked,
    busy,
    setBusy,
    setToast,
    controlsDisabled,
    waterPulses,
    waterPressure,
    pollPaused,
    labTelemetryRef,
    req,
    withHwid,
    refreshDevices,
  } = useModulesLab();

  const [calibRows, setCalibRows] = useState<CalibRow[]>(() =>
    initialCalibRows()
  );
  const [calibLog, setCalibLog] = useState("");
  const [calibStatus, setCalibStatus] = useState("");

  useEffect(() => {
    setCalibRows(initialCalibRows());
    setCalibLog("");
    setCalibStatus("");
  }, [host]);

  if (host !== "water") return null;

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
    const pulsesDelta = calibPulsesDelta({
      startPulses,
      endPulses,
      detectedReset,
      maxAfterReset,
    });

    if (!isValidPulsesDelta(pulsesDelta)) {
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
    if (
      !window.confirm(
        "Проливы 100/200/300/400 мл. После каждого шага введите фактический объём. Продолжить?"
      )
    ) {
      setCalibStatus("Калибровка отменена");
      return;
    }

    pollPaused.current = true;
    labTelemetryRef.current?.pause();
    setBusy("calib");
    const lines = [
      "Калибровка flowmeter · water",
      "flowFactor = total_pulses / фактический_объём_мл",
      "",
    ];
    const rows: CalibRow[] = initialCalibRows();
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
        const actualMl = parseActualMl(answer);
        if (actualMl == null) {
          throw new Error(`Некорректный объём для ${qty} мл`);
        }
        const stepFactor = computeStepFlowFactor(pulsesDelta, actualMl);
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

      const avg = averageFlowFactor(factors);
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
      labTelemetryRef.current?.resume();
      void refreshDevices();
    }
  }

  return (
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
          {waterPressure != null ? `${waterPressure.toFixed(2)} bar` : "—"}
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
              <td>{r.flowFactor != null ? r.flowFactor.toFixed(6) : "—"}</td>
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
  );
}
