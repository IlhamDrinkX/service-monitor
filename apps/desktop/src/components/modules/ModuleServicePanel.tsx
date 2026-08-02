import { useState } from "react";
import {
  MODULE_VALVES,
  NATS_SUBJECTS,
  pumpCommandPayload,
  pumpCommandSubject,
  valveCommandSubject,
} from "@service-monitor/core";
import { ActionButton } from "../ActionButton";
import { errText, sleep } from "../../lab/modulesLab/modulesLabHost";
import { useModulesLab } from "../../lab/modulesLab/ModulesLabContext";
import { flushOpenValve, isFoamTempValid } from "./moduleServiceHelpers";

export function ModuleServicePanel() {
  const {
    live,
    host,
    setBusy,
    setToast,
    controlsDisabled,
    pollPaused,
    labTelemetryRef,
    req,
    refreshDevices,
    startPump,
  } = useModulesLab();

  const [foamTemp, setFoamTemp] = useState(65);
  const [foamAir, setFoamAir] = useState(35);

  async function runFlush(kind: "milk" | "water") {
    const openValve = flushOpenValve(host, kind);

    pollPaused.current = true;
    labTelemetryRef.current?.pause();
    setBusy("flush");
    setToast(null);
    try {
      await req(valveCommandSubject(host, openValve, true));
      if (MODULE_VALVES[host].includes("drain")) {
        await req(valveCommandSubject(host, "drain", false));
      }
      const duration = 5000;
      // ERP default power=100 PWM (~39%) если не передать — шлём полный ход.
      await req(
        pumpCommandSubject(host),
        pumpCommandPayload({ durationMs: duration, powerPercent: 100 })
      );
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
      labTelemetryRef.current?.resume();
    }
  }

  async function foamCook() {
    if (host === "water") return;
    if (!isFoamTempValid(foamTemp)) {
      setToast({ text: "Температура 20…95 °C", error: true });
      return;
    }
    pollPaused.current = true;
    labTelemetryRef.current?.pause();
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
      labTelemetryRef.current?.resume();
    }
  }

  return (
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
            void startPump("forward", { durationMs: 3000 });
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
  );
}
