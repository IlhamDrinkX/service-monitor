import { scenariosForHost, type LabScenario } from "@service-monitor/core";
import { ActionButton } from "../ActionButton";
import { HelpTip } from "../HelpTip";
import { smLog } from "../../lib/sm-log";
import { useModulesLab } from "../../lab/modulesLab/ModulesLabContext";
import { isScenarioButtonDisabled } from "./labScenariosHelpers";
import { scenarioHint } from "./scenarioHint";

export function LabScenariosPanel() {
  const {
    host,
    setHost,
    hwid,
    busy,
    setBusy,
    controlsDisabled,
    pumpOn,
    setToast,
    pushLab,
    req,
    pollPaused,
    scenarioBusyToken,
    refreshDevices,
    pollDxPumpCurrents,
    requireLabUnlock,
    setShowCharts,
    setShowSensorCharts,
    startPump,
  } = useModulesLab();

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

  return (
    <div className="panel panel-compact">
      <h2 className="row" style={{ gap: 8, alignItems: "center" }}>
        Сценарии
        <HelpTip controlId="lab.scenarios" />
      </h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Реальные ERP payload на NATS (как cm-drv / ComplexOS), не mock.
        Service/danger — после сервисного пароля. «?» — что ждать по кнопке.
      </p>
      <div className="stack" style={{ gap: 10, marginTop: 8 }}>
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
              disabled={isScenarioButtonDisabled(s.id, busy, controlsDisabled)}
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
  );
}
