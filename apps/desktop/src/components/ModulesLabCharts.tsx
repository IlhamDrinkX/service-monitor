/**
 * Графики Modules Lab: комплекс milk/coffee/water, enlarge, маркер-срез.
 */

import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  DRINKX_HOSTS,
  HEATER_LABELS,
  VALVE_LABELS,
  booleanStepSeries,
  chartSeriesMeta,
  chartSinceMs,
  layoutModuleChartKeys,
  moduleChartColumns,
  parseSeriesKey,
  pumpPowerSeries,
  sensorSeries,
  seriesKey,
  snapshotAt,
  type ChartTimeScale,
  type DrinkxHost,
  type LabEvent,
  type LabSnapshotRow,
} from "@service-monitor/core";

const SERIES_COLORS = [
  "#3db8a8",
  "#e8a838",
  "#6ea8fe",
  "#e87a9a",
  "#a78bfa",
  "#84cc16",
  "#f97316",
  "#22d3ee",
];

const ACTUATOR_COLORS = [
  "#94a3b8",
  "#64748b",
  "#cbd5e1",
  "#78716c",
  "#a8a29e",
  "#71717a",
  "#52525b",
  "#eab308",
];

type YScale = "auto" | "0-5" | "0-100" | "0-120";

type Props = {
  events: LabEvent[];
  sensorNames: string[];
  availableSensors?: string[];
  valveIdsByModule?: Record<DrinkxHost, string[]>;
  /** @deprecated use valveIdsByModule */
  valveIds?: string[];
  heaterIds?: string[];
  /** Мини-карточки сгруппировать по milk/coffee/water */
  groupByModule?: boolean;
};

export function ModulesLabCharts({
  events,
  sensorNames,
  availableSensors,
  valveIdsByModule,
  valveIds = [],
  heaterIds = [],
  groupByModule = false,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);

  const valvesMap = useMemo(() => {
    if (valveIdsByModule) return valveIdsByModule;
    return {
      milk: valveIds,
      coffee: valveIds,
      water: valveIds,
    } as Record<DrinkxHost, string[]>;
  }, [valveIdsByModule, valveIds]);

  const allSensors = useMemo(() => {
    const set = new Set<string>(availableSensors ?? sensorNames);
    for (const n of sensorNames) set.add(n);
    for (const e of events) {
      if (e.kind === "sensor") set.add(seriesKey(e.module, e.name));
    }
    return [...set];
  }, [availableSensors, sensorNames, events]);

  const groupedNames = useMemo(() => {
    if (!groupByModule) return null;
    const map: Record<string, string[]> = {
      milk: [],
      coffee: [],
      water: [],
      other: [],
    };
    for (const name of sensorNames) {
      const { module } = parseSeriesKey(name);
      if (module === "milk" || module === "coffee" || module === "water") {
        map[module]!.push(name);
      } else {
        map.other!.push(name);
      }
    }
    return map;
  }, [groupByModule, sensorNames]);

  if (sensorNames.length === 0 && !expanded) {
    return (
      <p className="muted" style={{ margin: 0 }}>
        Нет точек датчиков — подождите опрос комплекса или включите треки.
      </p>
    );
  }

  function renderCard(name: string) {
    const pts = sensorSeries(events, name, 100);
    const meta = chartSeriesMeta(name);
    return (
      <button
        key={name}
        type="button"
        className="lab-chart-card lab-chart-card-btn"
        onClick={() => {
          setFocus(name);
          setExpanded(true);
        }}
        title="Открыть увеличенный график"
      >
        <div className="lab-chart-title">
          {meta.label}
          <span className="lab-chart-meta">
            {meta.code}
            {meta.unit ? ` · ${meta.unit}` : ""}
          </span>
        </div>
        {pts.length < 2 ? (
          <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
            мало точек ({pts.length}) — клик для настроек
          </p>
        ) : (
          <Sparkline points={pts} height={72} />
        )}
      </button>
    );
  }

  return (
    <>
      {groupedNames ? (
        <div className="lab-charts-grouped">
          {(["milk", "coffee", "water"] as const).map((mod) => {
            if (groupedNames[mod]!.length === 0) return null;
            const { slots, rest } = layoutModuleChartKeys(
              mod,
              groupedNames[mod]!
            );
            const cols = moduleChartColumns(mod);
            return (
              <div key={mod} className="lab-charts-group">
                <div className="lab-charts-group-title">{mod}</div>
                <div
                  className={`lab-charts lab-charts-semantic lab-charts-cols-${cols}`}
                >
                  {slots.map((name, i) =>
                    name == null ? (
                      <div
                        key={`${mod}-spacer-${i}`}
                        className="lab-chart-spacer"
                        aria-hidden
                      />
                    ) : (
                      renderCard(name)
                    )
                  )}
                </div>
                {rest.length > 0 ? (
                  <div className="lab-charts" style={{ marginTop: 10 }}>
                    {rest.map(renderCard)}
                  </div>
                ) : null}
              </div>
            );
          })}
          {groupedNames.other!.length > 0 ? (
            <div className="lab-charts-group">
              <div className="lab-charts-group-title">прочее</div>
              <div className="lab-charts">
                {groupedNames.other!.map(renderCard)}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="lab-charts">{sensorNames.map(renderCard)}</div>
      )}

      {expanded ? (
        <ExpandedChart
          events={events}
          allSensors={allSensors}
          initialSensor={focus ?? sensorNames[0] ?? allSensors[0] ?? null}
          valvesMap={valvesMap}
          heaterIds={heaterIds}
          onClose={() => setExpanded(false)}
        />
      ) : null}
    </>
  );
}

function ExpandedChart({
  events,
  allSensors,
  initialSensor,
  valvesMap,
  heaterIds,
  onClose,
}: {
  events: LabEvent[];
  allSensors: string[];
  initialSensor: string | null;
  valvesMap: Record<DrinkxHost, string[]>;
  heaterIds: string[];
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => {
    const s = new Set<string>();
    if (initialSensor) s.add(initialSensor);
    return s;
  });
  const [timeScale, setTimeScale] = useState<ChartTimeScale>("5m");
  const [yScale, setYScale] = useState<YScale>("auto");
  const [showPumpOn, setShowPumpOn] = useState<Set<DrinkxHost>>(new Set());
  const [showPumpPower, setShowPumpPower] = useState<Set<DrinkxHost>>(
    new Set()
  );
  const [valvesOn, setValvesOn] = useState<Set<string>>(new Set());
  const [heatersOn, setHeatersOn] = useState<Set<string>>(new Set());
  const [markerT, setMarkerT] = useState<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const since = chartSinceMs(timeScale);
  const limit = timeScale === "all" ? 500 : 300;

  const continuous = useMemo(() => {
    const series: Array<{
      id: string;
      label: string;
      code: string;
      unit: string;
      color: string;
      points: Array<{ t: number; v: number }>;
    }> = [];
    let ci = 0;
    for (const name of allSensors) {
      if (!selected.has(name)) continue;
      const meta = chartSeriesMeta(name);
      series.push({
        id: name,
        label: meta.label,
        code: meta.code,
        unit: meta.unit,
        color: SERIES_COLORS[ci % SERIES_COLORS.length]!,
        points: sensorSeries(events, name, limit, since),
      });
      ci += 1;
    }
    for (const mod of DRINKX_HOSTS) {
      if (!showPumpPower.has(mod)) continue;
      const id = seriesKey(mod, "pumpPower");
      const meta = chartSeriesMeta(id);
      const fromSensor = sensorSeries(events, id, limit, since);
      const fromPump =
        fromSensor.length >= 2
          ? fromSensor
          : pumpPowerSeries(events, since, limit, mod);
      series.push({
        id,
        label: meta.label,
        code: meta.code,
        unit: meta.unit,
        color: SERIES_COLORS[ci % SERIES_COLORS.length]!,
        points: fromPump,
      });
      ci += 1;
    }
    return series;
  }, [allSensors, selected, events, limit, since, showPumpPower]);

  const actuators = useMemo(() => {
    const list: Array<{
      id: string;
      label: string;
      color: string;
      points: Array<{ t: number; v: number }>;
    }> = [];
    let ai = 0;
    for (const mod of DRINKX_HOSTS) {
      for (const id of valvesMap[mod] ?? []) {
        const key = seriesKey(mod, id);
        if (!valvesOn.has(key)) continue;
        list.push({
          id: `valve:${key}`,
          label: `${mod} · ${VALVE_LABELS[id] ?? id}`,
          color: ACTUATOR_COLORS[ai % ACTUATOR_COLORS.length]!,
          points: booleanStepSeries(events, "valve", key, since, limit),
        });
        ai += 1;
      }
      if (showPumpOn.has(mod)) {
        const key = seriesKey(mod, "pump");
        list.push({
          id: `pump:${key}`,
          label: `${mod} · Насос ON/OFF`,
          color: ACTUATOR_COLORS[ai % ACTUATOR_COLORS.length]!,
          points: booleanStepSeries(events, "pump", key, since, limit),
        });
        ai += 1;
      }
      for (const hid of heaterIds) {
        const key = seriesKey(mod, hid);
        if (!heatersOn.has(key)) continue;
        list.push({
          id: `heater:${key}`,
          label: `${mod} · ${HEATER_LABELS[hid] ?? hid}`,
          color: ACTUATOR_COLORS[ai % ACTUATOR_COLORS.length]!,
          points: booleanStepSeries(events, "heater", key, since, limit),
        });
        ai += 1;
      }
    }
    return list;
  }, [
    valvesMap,
    valvesOn,
    heaterIds,
    heatersOn,
    showPumpOn,
    events,
    since,
    limit,
  ]);

  const slice = useMemo((): LabSnapshotRow[] => {
    if (markerT == null) return [];
    return snapshotAt(events, markerT);
  }, [events, markerT]);

  function toggleSensor(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleSet(
    setter: Dispatch<SetStateAction<Set<string>>>,
    id: string
  ) {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleHostSet(
    setter: Dispatch<SetStateAction<Set<DrinkxHost>>>,
    mod: DrinkxHost
  ) {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(mod)) next.delete(mod);
      else next.add(mod);
      return next;
    });
  }

  const sensorsByModule = useMemo(() => {
    const map: Record<string, string[]> = {
      milk: [],
      coffee: [],
      water: [],
      other: [],
    };
    for (const key of allSensors) {
      const { module } = parseSeriesKey(key);
      if (module === "milk" || module === "coffee" || module === "water") {
        map[module]!.push(key);
      } else {
        map.other!.push(key);
      }
    }
    return map;
  }, [allSensors]);

  return (
    <div
      className="lab-chart-modal-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="lab-chart-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Увеличенный график комплекса"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="lab-chart-modal-head">
          <h2 style={{ margin: 0, fontSize: "1.1rem" }}>
            График комплекса
          </h2>
          <button type="button" className="btn" onClick={onClose}>
            Закрыть
          </button>
        </div>

        <div className="lab-chart-modal-toolbar">
          <label className="muted">
            время{" "}
            <select
              value={timeScale}
              onChange={(e) =>
                setTimeScale(e.target.value as ChartTimeScale)
              }
            >
              <option value="1m">1 мин</option>
              <option value="5m">5 мин</option>
              <option value="15m">15 мин</option>
              <option value="all">всё</option>
            </select>
          </label>
          <label className="muted">
            шкала Y{" "}
            <select
              value={yScale}
              onChange={(e) => setYScale(e.target.value as YScale)}
            >
              <option value="auto">auto</option>
              <option value="0-5">0–5 (bar / A)</option>
              <option value="0-100">0–100 (%)</option>
              <option value="0-120">0–120 (°C)</option>
            </select>
          </label>
          {markerT != null ? (
            <button
              type="button"
              className="btn"
              onClick={() => setMarkerT(null)}
            >
              Сбросить маркер
            </button>
          ) : (
            <span className="muted">Клик по графику — маркер среза</span>
          )}
        </div>

        <div className="lab-chart-modal-body">
          <aside className="lab-chart-sidebar">
            {DRINKX_HOSTS.map((mod) => (
              <div key={mod} className="lab-chart-side-block">
                <div className="lab-chart-side-title">Датчики · {mod}</div>
                {(sensorsByModule[mod] ?? []).map((name) => {
                  const meta = chartSeriesMeta(name);
                  return (
                    <label key={name} className="lab-chart-check">
                      <input
                        type="checkbox"
                        checked={selected.has(name)}
                        onChange={() => toggleSensor(name)}
                      />
                      <span>
                        {meta.label.replace(`${mod} · `, "")}
                        <span className="lab-chart-meta">
                          {meta.code}
                          {meta.unit ? ` · ${meta.unit}` : ""}
                        </span>
                      </span>
                    </label>
                  );
                })}
                <div className="lab-chart-side-title" style={{ marginTop: 8 }}>
                  Исполнители · {mod}
                </div>
                {(valvesMap[mod] ?? []).map((id) => {
                  const key = seriesKey(mod, id);
                  return (
                    <label key={key} className="lab-chart-check">
                      <input
                        type="checkbox"
                        checked={valvesOn.has(key)}
                        onChange={() => toggleSet(setValvesOn, key)}
                      />
                      <span>
                        {VALVE_LABELS[id] ?? id}
                        <span className="lab-chart-meta">{key}</span>
                      </span>
                    </label>
                  );
                })}
                <label className="lab-chart-check">
                  <input
                    type="checkbox"
                    checked={showPumpOn.has(mod)}
                    onChange={() => toggleHostSet(setShowPumpOn, mod)}
                  />
                  <span>
                    Насос ON/OFF
                    <span className="lab-chart-meta">{mod}.pump</span>
                  </span>
                </label>
                <label className="lab-chart-check">
                  <input
                    type="checkbox"
                    checked={showPumpPower.has(mod)}
                    onChange={() => toggleHostSet(setShowPumpPower, mod)}
                  />
                  <span>
                    Мощность насоса %
                    <span className="lab-chart-meta">{mod}.pump.power</span>
                  </span>
                </label>
                {heaterIds.map((hid) => {
                  const key = seriesKey(mod, hid);
                  return (
                    <label key={key} className="lab-chart-check">
                      <input
                        type="checkbox"
                        checked={heatersOn.has(key)}
                        onChange={() => toggleSet(setHeatersOn, key)}
                      />
                      <span>
                        {HEATER_LABELS[hid] ?? hid}
                        <span className="lab-chart-meta">{key}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            ))}
          </aside>

          <div className="lab-chart-main">
            <MultiChart
              continuous={continuous}
              actuators={actuators}
              yScale={yScale}
              timeScale={timeScale}
              since={since}
              markerT={markerT}
              onMark={setMarkerT}
            />
            <div className="lab-chart-legend">
              {continuous.map((s) => (
                <span key={s.id} className="lab-chart-legend-item">
                  <i style={{ background: s.color }} />
                  {s.label}
                  {s.unit ? ` (${s.unit})` : ""}
                  <code>{s.code}</code>
                </span>
              ))}
              {actuators.map((s) => (
                <span key={s.id} className="lab-chart-legend-item">
                  <i style={{ background: s.color }} />
                  {s.label}
                  <code>0/1</code>
                </span>
              ))}
            </div>

            {markerT != null ? (
              <div className="lab-chart-slice">
                <h3>
                  Срез · {new Date(markerT).toLocaleTimeString()}
                </h3>
                {slice.length === 0 ? (
                  <p className="muted">Нет событий до маркера</p>
                ) : (
                  <table className="lab-slice-table">
                    <thead>
                      <tr>
                        <th>Модуль</th>
                        <th>Имя</th>
                        <th>Код</th>
                        <th>Значение</th>
                        <th>Ед.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {slice.map((row) => (
                        <tr key={`${row.kind}:${row.key}`}>
                          <td>{row.module}</td>
                          <td>{row.label}</td>
                          <td>
                            <code>{row.code}</code>
                          </td>
                          <td>
                            {row.value === true
                              ? "ON"
                              : row.value === false
                                ? "OFF"
                                : row.value == null
                                  ? "—"
                                  : String(row.value)}
                          </td>
                          <td>{row.unit}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function MultiChart({
  continuous,
  actuators,
  yScale,
  timeScale,
  since,
  markerT,
  onMark,
}: {
  continuous: Array<{
    id: string;
    color: string;
    points: Array<{ t: number; v: number }>;
  }>;
  actuators: Array<{
    id: string;
    color: string;
    points: Array<{ t: number; v: number }>;
  }>;
  yScale: YScale;
  timeScale: ChartTimeScale;
  since: number | null;
  markerT: number | null;
  onMark: (t: number) => void;
}) {
  const w = 900;
  const h = 420;
  const padL = 48;
  const padR = 16;
  const padT = 16;
  const laneH = 14;
  const laneGap = 4;
  const actuatorBand =
    actuators.length > 0
      ? actuators.length * (laneH + laneGap) + 12
      : 0;
  const padB = 28 + actuatorBand;
  const plotH = h - padT - padB;
  const plotW = w - padL - padR;

  const allPts = continuous.flatMap((s) => s.points);
  const allT = [
    ...allPts.map((p) => p.t),
    ...actuators.flatMap((a) => a.points.map((p) => p.t)),
  ];
  const now = Date.now();
  let tMin =
    allT.length > 0 ? Math.min(...allT) : since ?? now - 60_000;
  let tMax = allT.length > 0 ? Math.max(...allT) : now;
  if (since != null) tMin = Math.min(tMin, since);
  if (timeScale !== "all") tMax = Math.max(tMax, now);
  if (tMax <= tMin) tMax = tMin + 1;

  let yMin = 0;
  let yMax = 1;
  if (yScale === "0-5") {
    yMin = 0;
    yMax = 5;
  } else if (yScale === "0-100") {
    yMin = 0;
    yMax = 100;
  } else if (yScale === "0-120") {
    yMin = 0;
    yMax = 120;
  } else if (allPts.length > 0) {
    yMin = Math.min(...allPts.map((p) => p.v));
    yMax = Math.max(...allPts.map((p) => p.v));
    if (yMax === yMin) {
      yMin -= 1;
      yMax += 1;
    }
    const pad = (yMax - yMin) * 0.08;
    yMin -= pad;
    yMax += pad;
  }

  const xOf = (t: number) =>
    padL + ((t - tMin) / (tMax - tMin)) * plotW;
  const yOf = (v: number) =>
    padT + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;
  const tOf = (x: number) =>
    tMin + ((x - padL) / plotW) * (tMax - tMin);

  function pathFor(
    points: Array<{ t: number; v: number }>,
    yMap: (v: number) => number
  ): string {
    if (points.length === 0) return "";
    return points
      .map((p, i) => {
        const x = xOf(p.t);
        const y = yMap(p.v);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }

  const hasData =
    continuous.some((s) => s.points.length > 0) ||
    actuators.some((a) => a.points.length > 0);

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width="100%"
      height={h}
      className="lab-spark lab-spark-lg lab-spark-interactive"
      onClick={(e) => {
        const svg = e.currentTarget;
        const rect = svg.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * w;
        if (x < padL || x > padL + plotW) return;
        onMark(tOf(x));
      }}
    >
      <rect
        x={padL}
        y={padT}
        width={plotW}
        height={plotH}
        fill="rgba(0,0,0,0.2)"
        rx={4}
      />
      <text x={4} y={padT + 10} fill="var(--text-muted)" fontSize="11">
        {yMax.toFixed(2)}
      </text>
      <text x={4} y={padT + plotH} fill="var(--text-muted)" fontSize="11">
        {yMin.toFixed(2)}
      </text>
      {!hasData ? (
        <text
          x={w / 2}
          y={h / 2}
          textAnchor="middle"
          fill="var(--text-muted)"
          fontSize="14"
        >
          Нет точек в выбранном окне
        </text>
      ) : null}
      {continuous.map((s) => (
        <path
          key={s.id}
          d={pathFor(s.points, yOf)}
          fill="none"
          stroke={s.color}
          strokeWidth="2.2"
        />
      ))}
      {actuators.map((a, idx) => {
        const top = h - padB + 8 + idx * (laneH + laneGap);
        const yMap = (v: number) => top + laneH - v * laneH;
        return (
          <g key={a.id}>
            <text
              x={4}
              y={top + laneH - 2}
              fill="var(--text-muted)"
              fontSize="9"
            >
              0/1
            </text>
            <rect
              x={padL}
              y={top}
              width={plotW}
              height={laneH}
              fill="rgba(255,255,255,0.04)"
              rx={2}
            />
            <path
              d={pathFor(a.points, yMap)}
              fill="none"
              stroke={a.color}
              strokeWidth="2"
            />
          </g>
        );
      })}
      {markerT != null && markerT >= tMin && markerT <= tMax ? (
        <line
          className="lab-chart-marker"
          x1={xOf(markerT)}
          x2={xOf(markerT)}
          y1={padT}
          y2={h - 20}
          stroke="var(--accent)"
          strokeWidth="1.5"
          strokeDasharray="4 3"
        />
      ) : null}
      <text x={padL} y={h - 6} fill="var(--text-muted)" fontSize="10">
        {new Date(tMin).toLocaleTimeString()}
      </text>
      <text
        x={w - padR}
        y={h - 6}
        textAnchor="end"
        fill="var(--text-muted)"
        fontSize="10"
      >
        {new Date(tMax).toLocaleTimeString()}
      </text>
    </svg>
  );
}

function Sparkline({
  points,
  height = 72,
}: {
  points: Array<{ t: number; v: number }>;
  height?: number;
}) {
  const w = 320;
  const h = height;
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
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width="100%"
      height={h}
      className="lab-spark"
    >
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
