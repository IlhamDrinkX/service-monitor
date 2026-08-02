import {
  DRINKX_HOSTS,
  chartSeriesMeta,
  complexSensorCatalog,
} from "@service-monitor/core";
import type { LabTrackState } from "../../lab/modulesLab/modulesLabTypes";

export function ModulesLabTrackPanel(props: {
  open: boolean;
  labTrack: LabTrackState;
  onUpdate: (next: LabTrackState) => void;
}) {
  if (!props.open) return null;
  const { labTrack, onUpdate } = props;

  return (
    <div className="panel panel-compact lab-track-panel">
      <h2>Отслеживание комплекса</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Выключенный модуль не опрашивается (status). Выключенный датчик не
        пишется в лог/график.
      </p>
      <div className="lab-track-modules">
        {DRINKX_HOSTS.map((mod) => (
          <label key={mod} className="lab-chart-check">
            <input
              type="checkbox"
              checked={labTrack.modules[mod] !== false}
              onChange={(e) => {
                onUpdate({
                  ...labTrack,
                  modules: {
                    ...labTrack.modules,
                    [mod]: e.target.checked,
                  },
                });
              }}
            />
            <span>
              модуль <strong>{mod}</strong>
            </span>
          </label>
        ))}
      </div>
      <div className="lab-track-sensors">
        {complexSensorCatalog().map((key) => {
          const meta = chartSeriesMeta(key);
          const on = labTrack.sensors[key] !== false;
          return (
            <label key={key} className="lab-chart-check">
              <input
                type="checkbox"
                checked={on}
                onChange={(e) => {
                  onUpdate({
                    ...labTrack,
                    sensors: {
                      ...labTrack.sensors,
                      [key]: e.target.checked,
                    },
                  });
                }}
              />
              <span>
                {meta.label}
                <span className="lab-chart-meta">
                  {meta.code}
                  {meta.unit ? ` · ${meta.unit}` : ""}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
