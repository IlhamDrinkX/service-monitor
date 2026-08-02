import {
  DRINKX_HOSTS,
  defaultHwid,
  type DrinkxHost,
  type LabEvent,
  type LabSnapshot,
  type NatsMusterEntry,
} from "@service-monitor/core";
import { ActionButton } from "../ActionButton";
import { HelpTip } from "../HelpTip";
import {
  buildLabChartSyncPayload,
  openLabChartLogViewer,
} from "../ModulesLabCharts";
import {
  availableChartSensorsFromEvents,
  chartHeaterIds,
  chartSensorNamesFromEvents,
  chartValveIdsByModule,
} from "../../lab/modulesLab/labEventLogHelpers";
import { hostHealthBadgeClass } from "./modulesLabToolbarHelpers";

export function ModulesLabToolbar(props: {
  warn: boolean;
  sessionOk: boolean;
  sessionNatsOnline?: boolean;
  sessionNatsUrl?: string | null;
  live: boolean;
  busy: string | null;
  canTryNats: boolean;
  controlsDisabled: boolean;
  labEventsCount: number;
  labEvents?: LabEvent[];
  showCharts: boolean;
  showTrackPanel: boolean;
  host: DrinkxHost;
  hwid: string;
  modules: NatsMusterEntry[];
  labSnap: LabSnapshot;
  toast: { text: string; error?: boolean } | null;
  onConnectNats: () => void;
  onDisconnectNats: () => void;
  onResolveMuster: () => void;
  onToggleCharts: () => void;
  onToggleTracks: () => void;
  onExportCsv: () => void;
  onClearLog: () => void;
  onHostChange: (host: DrinkxHost) => void;
  onHwidChange: (hwid: string) => void;
}) {
  const {
    warn,
    sessionOk,
    sessionNatsOnline,
    sessionNatsUrl,
    live,
    busy,
    canTryNats,
    controlsDisabled,
    labEventsCount,
    labEvents,
    showCharts,
    showTrackPanel,
    host,
    hwid,
    modules,
    labSnap,
    toast,
    onConnectNats,
    onDisconnectNats,
    onResolveMuster,
    onToggleCharts,
    onToggleTracks,
    onExportCsv,
    onClearLog,
    onHostChange,
    onHwidChange,
  } = props;

  return (
    <div className={`panel${warn ? " panel-warn" : ""}`}>
      <h2>Modules Lab</h2>
      <div className="lab-toolbar">
        <span className={`badge${sessionOk ? " on" : " danger"}`}>
          {sessionOk
            ? sessionNatsOnline
              ? `Сессия · NATS probe ok`
              : `Сессия · probe NATS? · ${sessionNatsUrl ?? ""}`
            : "Нет сессии"}
        </span>
        <span className={`badge${live ? " on" : ""}`}>
          {live ? "NATS client ON" : "NATS client OFF"}
        </span>
        <span className="badge">{labEventsCount}</span>
        <ActionButton
          helpId="modules.nats"
          variant="primary"
          className="btn-compact"
          disabled={busy !== null || !canTryNats || live}
          onClick={() => onConnectNats()}
        >
          {busy === "nats" ? "…" : "NATS"}
        </ActionButton>
        <ActionButton
          helpId="modules.off"
          className="btn-compact"
          disabled={busy !== null || !live}
          onClick={() => onDisconnectNats()}
        >
          Off
        </ActionButton>
        <ActionButton
          helpId="modules.muster"
          className="btn-compact"
          disabled={controlsDisabled}
          onClick={() => onResolveMuster()}
        >
          Muster
        </ActionButton>
        <ActionButton
          helpId="modules.charts"
          className="btn-compact"
          disabled={labEventsCount === 0}
          onClick={() => onToggleCharts()}
        >
          {showCharts ? "Графики▾" : "Графики"}
        </ActionButton>
        <ActionButton
          helpId="modules.chartLog"
          className="btn-compact"
          onClick={() => {
            const events = labEvents ?? [];
            const sensors = chartSensorNamesFromEvents(events);
            const available = availableChartSensorsFromEvents(events);
            const payload =
              events.length > 0
                ? buildLabChartSyncPayload(events, available.length ? available : sensors, {
                    focus: sensors[0] ?? null,
                    valvesMap: chartValveIdsByModule(),
                    heaterIds: chartHeaterIds(),
                  })
                : null;
            void openLabChartLogViewer(payload).then((res) => {
              if (!res.ok) {
                window.alert(res.error || "Не удалось открыть окно графика");
              }
            });
          }}
        >
          Лог графика
        </ActionButton>
        <ActionButton
          helpId="modules.tracks"
          className="btn-compact"
          onClick={() => onToggleTracks()}
        >
          {showTrackPanel ? "Треки▾" : "Треки"}
        </ActionButton>
        <ActionButton
          helpId="modules.csv"
          className="btn-compact"
          disabled={labEventsCount === 0}
          onClick={() => onExportCsv()}
        >
          CSV
        </ActionButton>
        <ActionButton
          helpId="modules.clear"
          className="btn-compact"
          disabled={labEventsCount === 0}
          onClick={() => onClearLog()}
        >
          Clear
        </ActionButton>
        <label className="muted lab-select">
          host
          <HelpTip controlId="modules.host" />
          <select
            value={host}
            disabled={!live}
            onChange={(e) => onHostChange(e.target.value as DrinkxHost)}
          >
            {DRINKX_HOSTS.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </label>
        {live
          ? DRINKX_HOSTS.map((h) => {
              const hh = labSnap.hostHealth[h];
              const nats = hh?.natsOk;
              const dx = hh?.dxOk;
              const natsLabel =
                nats === true ? "NATS ok" : nats === false ? "NATS fail" : "NATS ?";
              const dxLabel =
                dx === true ? "DX ok" : dx === false ? "DX fail" : "DX ?";
              return (
                <span
                  key={`health-${h}`}
                  className={hostHealthBadgeClass(nats, dx)}
                  title={`${h}: NATS (pumps/status) · DX HTTP :8000 R_IS`}
                >
                  {h} · {natsLabel} · {dxLabel}
                </span>
              );
            })
          : null}
        <label className="muted lab-select">
          hwid
          <HelpTip controlId="modules.hwid" />
          <select
            value={hwid}
            disabled={!live}
            onChange={(e) => onHwidChange(e.target.value)}
          >
            <option value={defaultHwid(host)}>{defaultHwid(host)}</option>
            {modules
              .filter((m) => m.hwid && m.hwid !== defaultHwid(host))
              .map((m) => (
                <option key={m.hwid} value={m.hwid!}>
                  {m.hwid}
                  {m.role ? ` (${m.role})` : ""}
                </option>
              ))}
          </select>
        </label>
      </div>
      {toast ? (
        <div className={`toast${toast.error ? " error" : ""}`}>
          {toast.text}
        </div>
      ) : null}
    </div>
  );
}
