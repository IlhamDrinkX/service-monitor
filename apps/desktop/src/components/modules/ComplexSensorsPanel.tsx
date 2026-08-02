import { useState } from "react";
import {
  DRINKX_HOSTS,
  type DrinkxHost,
  type LabEvent,
  type LabSnapshot,
  type TempSensorKey,
} from "@service-monitor/core";
import { ActionButton } from "../ActionButton";
import { HelpTip } from "../HelpTip";
import { ModulesLabCharts } from "../ModulesLabCharts";
import type { LabChartSyncPayload } from "../LabChartPanel";
import {
  buildComplexSensorRows,
  orderSensorRows,
  telemetryStaleFlags,
  visibleSensorModules,
} from "./complexSensorsHelpers";

export function ComplexSensorsPanel(props: {
  host: DrinkxHost;
  labSnap: LabSnapshot;
  complexTemps: Partial<
    Record<DrinkxHost, Partial<Record<TempSensorKey, number>>>
  >;
  waterPressure: number | null;
  waterPulses: number | null;
  pumpCurrentByHost: Partial<Record<DrinkxHost, number | null>>;
  pumpCurrentLByHost: Partial<Record<DrinkxHost, number | null>>;
  pumpPowerByHost: Partial<Record<DrinkxHost, number | null>>;
  heaterPwmByHost: Partial<
    Record<DrinkxHost, { heater1?: number; heater2?: number }>
  >;
  pumpOn: boolean | null;
  pumpPower: number;
  chartCommonProps: {
    events: LabEvent[];
    availableSensors: string[];
    valveIdsByModule: Record<DrinkxHost, string[]>;
    heaterIds: string[];
    liveActuators?: LabChartSyncPayload["liveActuators"];
  };
  chartSensorNames: string[];
  /** Lifted so milkrinse scenario can open sensor charts. */
  showSensorCharts: boolean;
  onShowSensorChartsChange: (next: boolean) => void;
}) {
  const {
    host,
    labSnap,
    complexTemps,
    waterPressure,
    waterPulses,
    pumpCurrentByHost,
    pumpCurrentLByHost,
    pumpPowerByHost,
    heaterPwmByHost,
    pumpOn,
    pumpPower,
    chartCommonProps,
    chartSensorNames,
    showSensorCharts,
    onShowSensorChartsChange,
  } = props;

  const [sensorModulesVisible, setSensorModulesVisible] = useState<
    Record<DrinkxHost, boolean>
  >({ milk: true, coffee: true, water: true });
  const [mutedSensorKeys, setMutedSensorKeys] = useState<string[]>([]);

  const { pollStale, actStale } = telemetryStaleFlags(labSnap);

  return (
    <div className="lab-col lab-sensors-sticky">
      <div className="panel panel-compact panel-sensors">
        <h2>
          Датчики комплекса <HelpTip controlId="modules.dxUi" />
        </h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
          R_IS / L_IS — DX UI (вольты). Мощность насоса — pumps.status. ШИМ —
          оценка heaters.status. Жёлтый = опрос замер (не mid-tick / не во время
          команды). Пустой ток → IP milk=.44 coffee=.45.
        </p>
        <div className="lab-sensor-module-toggles">
          {DRINKX_HOSTS.map((mod) => (
            <label key={mod} className="lab-chart-check">
              <input
                type="checkbox"
                checked={sensorModulesVisible[mod] !== false}
                onChange={(e) =>
                  setSensorModulesVisible((prev) => ({
                    ...prev,
                    [mod]: e.target.checked,
                  }))
                }
              />
              <span>{mod}</span>
            </label>
          ))}
        </div>
        {visibleSensorModules(sensorModulesVisible).map((mod) => {
          const hh = labSnap.hostHealth[mod];
          const rows = orderSensorRows(
            buildComplexSensorRows({
              mod,
              complexTemps,
              mutedSensorKeys,
              pollStale,
              actStale,
              natsOk: hh?.natsOk,
              dxOk: hh?.dxOk,
              waterPressure,
              waterPulses,
              pumpCurrentByHost,
              pumpCurrentLByHost,
              pumpPowerByHost,
              heaterPwmByHost,
              host,
              pumpOn,
              pumpPower,
            })
          );
          return (
            <div key={mod} className="lab-sensor-module-block">
              <div className="lab-sensor-module-title">{mod}</div>
              <div className="sensor-list">
                {rows.map((row) => (
                  <button
                    key={row.key}
                    type="button"
                    className={`sensor-row sensor-row-btn${row.muted ? " sensor-muted" : ""}${row.stale ? " sensor-stale" : ""}`}
                    title={
                      row.stale
                        ? "Данные устарели (давно не обновлялись)"
                        : row.key.startsWith(`${mod}.__`)
                          ? undefined
                          : row.muted
                            ? "Включить отображение"
                            : "Скрыть в конец списка"
                    }
                    disabled={row.key.startsWith(`${mod}.__`)}
                    onClick={() => {
                      if (row.key.startsWith(`${mod}.__`)) return;
                      setMutedSensorKeys((prev) =>
                        prev.includes(row.key)
                          ? prev.filter((k) => k !== row.key)
                          : [...prev, row.key]
                      );
                    }}
                  >
                    <span>{row.label}</span>
                    <span className="metric">{row.value}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        <div style={{ marginTop: 12 }}>
          <div className="row" style={{ marginBottom: 8, alignItems: "center" }}>
            <ActionButton
              className="btn-compact"
              onClick={() => onShowSensorChartsChange(!showSensorCharts)}
            >
              {showSensorCharts ? "Графики датчиков▾" : "Графики датчиков"}
            </ActionButton>
            <span className="muted" style={{ fontSize: "0.8rem" }}>
              по умолчанию выкл · та же сетка, что под «Графики»
            </span>
          </div>
          {showSensorCharts ? (
            <ModulesLabCharts
              {...chartCommonProps}
              sensorNames={chartSensorNames}
              groupByModule
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
