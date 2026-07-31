/**
 * Простые SVG-графики по journal Modules Lab.
 */

import { sensorSeries, type LabEvent } from "@service-monitor/core";

type Props = {
  events: LabEvent[];
  sensorNames: string[];
};

export function ModulesLabCharts({ events, sensorNames }: Props) {
  if (sensorNames.length === 0) {
    return (
      <p className="muted" style={{ margin: 0 }}>
        Нет точек датчиков для графика — поработайте с модулем под NATS.
      </p>
    );
  }

  return (
    <div className="lab-charts">
      {sensorNames.map((name) => {
        const pts = sensorSeries(events, name, 100);
        return (
          <div key={name} className="lab-chart-card">
            <div className="lab-chart-title">{name}</div>
            {pts.length < 2 ? (
              <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
                мало точек ({pts.length})
              </p>
            ) : (
              <Sparkline points={pts} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function Sparkline({ points }: { points: Array<{ t: number; v: number }> }) {
  const w = 320;
  const h = 72;
  const pad = 4;
  const vs = points.map((p) => p.v);
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  const span = max - min || 1;
  const path = points
    .map((p, i) => {
      const x = pad + (i / (points.length - 1)) * (w - pad * 2);
      const y = h - pad - ((p.v - min) / span) * (h - pad * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} className="lab-spark">
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2" />
      <text x={pad} y={12} fill="var(--text-muted)" fontSize="10">
        {max.toFixed(2)}
      </text>
      <text x={pad} y={h - 2} fill="var(--text-muted)" fontSize="10">
        {min.toFixed(2)}
      </text>
    </svg>
  );
}
