/**
 * Сессия комплекса: Remote SSH или Local LAN.
 * Красная подсветка — нет сессии / протухла / не в сети с модулями.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ActionButton } from "../components/ActionButton";
import { HelpTip } from "../components/HelpTip";
import {
  buildHealthReport,
  formatHealthReportText,
  healthLevelLabel,
  serviceUrlsForMode,
  type HealthLevel,
  type HealthReport,
  type SessionMode,
} from "@service-monitor/core";
import { gatherHealthReportInput } from "../lab/healthReportProbes";
import { useComplexSession } from "../state/useComplexSession";

export function SessionPage() {
  const { session, warn, connect, disconnect, refreshNetwork } =
    useComplexSession();
  const [mode, setMode] = useState<SessionMode>("remote");
  const [seriesLabel, setSeriesLabel] = useState("4.15");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(
    null
  );
  const [healthReport, setHealthReport] = useState<HealthReport | null>(null);
  const [healthBusy, setHealthBusy] = useState(false);
  const [healthOpenSections, setHealthOpenSections] = useState<Set<string>>(
    new Set()
  );

  useEffect(() => {
    if (session.seriesLabel) setSeriesLabel(session.seriesLabel);
    if (session.mode) setMode(session.mode);
  }, [session.seriesLabel, session.mode]);

  const urls = useMemo(
    () => serviceUrlsForMode(session.mode ?? mode),
    [session.mode, mode]
  );

  const active = session.connected && !warn;
  const sessionActive =
    session.connected ||
    (session.mode === "local" && session.failureReason === "lan_unreachable");

  async function onConnect() {
    setBusy(true);
    setToast(null);
    const snap = await connect({
      mode,
      seriesLabel: mode === "remote" ? seriesLabel : undefined,
    });
    setBusy(false);
    setToast({
      text: snap.message,
      error: !snap.connected || shouldShowError(snap.connected, snap.message),
    });
  }

  async function onDisconnect() {
    setBusy(true);
    await disconnect();
    setBusy(false);
    setToast({ text: "Сессия отключена" });
  }

  async function onRefreshNet() {
    setBusy(true);
    setToast(null);
    const snap = await refreshNetwork();
    setBusy(false);
    setToast({
      text: snap.message,
      error: /ARP ошибка|discovery fail/i.test(snap.message),
    });
  }

  async function onRunHealthReport() {
    if (healthBusy) return;
    setHealthBusy(true);
    try {
      const input = await gatherHealthReportInput(session);
      const report = buildHealthReport(input);
      setHealthReport(report);
      setHealthOpenSections(
        new Set(report.sections.filter((s) => s.level !== "ok").map((s) => s.id))
      );
    } finally {
      setHealthBusy(false);
    }
  }

  function toggleHealthSection(id: string) {
    setHealthOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onCopyHealthReport() {
    if (!healthReport) return;
    const text = formatHealthReportText(healthReport);
    try {
      await navigator.clipboard.writeText(text);
      setToast({ text: "Отчёт скопирован в буфер обмена" });
    } catch (e) {
      setToast({
        text: `Не удалось скопировать: ${e instanceof Error ? e.message : String(e)}`,
        error: true,
      });
    }
  }

  return (
    <div className="stack">
      <div className={`panel${warn ? " panel-warn" : ""}`}>
        <h2>Сессия комплекса</h2>
        <p className="lead">
          <strong>Remote</strong> — SSH через ERP (туннель + NATS :14222).{" "}
          <strong>Local</strong> — вы в Wi‑Fi комплекса (прямые IP 192.168.1.x).
          Без связи с модулями приложение подсвечивается красным.
        </p>

        <div className="row" style={{ marginBottom: 10 }}>
          <button
            type="button"
            className={`mode-chip${mode === "remote" ? " active" : ""}`}
            disabled={sessionActive || busy}
            onClick={() => setMode("remote")}
          >
            Remote SSH
          </button>
          <button
            type="button"
            className={`mode-chip${mode === "local" ? " active" : ""}`}
            disabled={sessionActive || busy}
            onClick={() => setMode("local")}
          >
            Local LAN
          </button>
        </div>

        <div className="row">
          {mode === "remote" ? (
            <div className="field" style={{ maxWidth: 160 }}>
              <label htmlFor="sess-series">Серия</label>
              <input
                id="sess-series"
                value={seriesLabel}
                onChange={(e) => setSeriesLabel(e.target.value)}
                placeholder="4.15"
                disabled={sessionActive || busy}
              />
            </div>
          ) : (
            <span className="muted">
              Проверка: complexos .43 + milk/coffee/water .44–.46
            </span>
          )}
          {!sessionActive ? (
            <ActionButton
              helpId="session.connect"
              variant="primary"
              disabled={busy}
              onClick={() => void onConnect()}
            >
              {busy ? "Подключение…" : "Подключить"}
            </ActionButton>
          ) : (
            <>
              <ActionButton
                helpId="session.connect"
                disabled={busy}
                onClick={() => void onDisconnect()}
              >
                Отключить
              </ActionButton>
              {/ложная сессия|переподключ/i.test(session.message) ? (
                <ActionButton
                  variant="primary"
                  disabled={busy}
                  onClick={() => void onConnect()}
                >
                  {busy ? "…" : "Переподключить"}
                </ActionButton>
              ) : null}
            </>
          )}
          <span className={`badge${active ? " on" : " danger"}`}>
            {session.message}
          </span>
        </div>
        {toast ? (
          <div className={`toast${toast.error ? " error" : ""}`}>
            {toast.text}
          </div>
        ) : null}
      </div>

      <div className="panel">
        <h2>Сервисы</h2>
        <p className="lead">
          {session.mode === "local"
            ? "Прямые адреса LAN."
            : "Через LocalForward (нужен Remote-туннель)."}
        </p>
        <div className="row">
          <ActionButton
            helpId="session.dashboard"
            disabled={!active}
            onClick={() => void window.desktop.openExternal(urls.dashboard)}
          >
            Дашборд
          </ActionButton>
          <ActionButton
            helpId="session.kiosk"
            disabled={!active}
            onClick={() => void window.desktop.openExternal(urls.kiosk)}
          >
            Киоск
          </ActionButton>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <ActionButton
            helpId="session.milkCharts"
            disabled={!active}
            onClick={() => void window.desktop.openExternal(urls.milkCharts)}
          >
            Графики milk
          </ActionButton>
          <ActionButton
            helpId="session.coffeeCharts"
            disabled={!active}
            onClick={() => void window.desktop.openExternal(urls.coffeeCharts)}
          >
            Графики coffee
          </ActionButton>
          <ActionButton
            helpId="session.waterCharts"
            disabled={!active}
            onClick={() => void window.desktop.openExternal(urls.waterCharts)}
          >
            Графики water
          </ActionButton>
          <ActionButton
            helpId="session.router"
            disabled={!active}
            onClick={() => void window.desktop.openExternal(urls.router)}
          >
            Роутер
          </ActionButton>
        </div>
        <p className="muted" style={{ marginTop: 10 }}>
          milk <code>{urls.milkCharts}</code> · coffee{" "}
          <code>{urls.coffeeCharts}</code> · water{" "}
          <code>{urls.waterCharts}</code>
        </p>
      </div>

      <div className="panel">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Health Report</h2>
          <ActionButton
            helpId="session.healthReport"
            variant="primary"
            disabled={healthBusy}
            onClick={() => void onRunHealthReport()}
          >
            {healthBusy ? "Проверка…" : "Запустить проверку"}
          </ActionButton>
        </div>
        <p className="lead">
          Опрашивает комплекс целиком: NATS ядро, модули milk/coffee/water
          (датчики + DX-токи), ComplexOS, сироп-дозатор, кассу/ККТ и бортовой
          лог-логгер (если установлен) — и выдаёт что доступно, что нет и что
          с этим делать.
        </p>
        {!healthReport ? (
          <p className="muted">Нажмите «Запустить проверку», чтобы получить отчёт.</p>
        ) : (
          <>
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
              <span className={`badge${healthBadgeModifier(healthReport.overall)}`}>
                {healthLevelLabel(healthReport.overall)} · {healthReport.summary}
              </span>
              <ActionButton onClick={() => void onCopyHealthReport()}>
                Скопировать отчёт
              </ActionButton>
            </div>
            {healthReport.sections.map((s) => {
              const open = healthOpenSections.has(s.id);
              return (
                <div key={s.id} className="health-report-section">
                  <button
                    type="button"
                    className="row"
                    style={{
                      width: "100%",
                      justifyContent: "space-between",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: 0,
                      color: "inherit",
                      font: "inherit",
                    }}
                    onClick={() => toggleHealthSection(s.id)}
                  >
                    <strong>{s.label}</strong>
                    <span className={`badge${healthBadgeModifier(s.level)}`}>
                      {healthLevelLabel(s.level)} {open ? "▾" : "▸"}
                    </span>
                  </button>
                  {open
                    ? s.checks.map((c) => (
                        <div key={c.id} className="health-report-check">
                          <span className={`health-dot ${c.level}`} />
                          <span>
                            <strong>{c.label}:</strong> {c.message}
                            {c.recommendation ? (
                              <>
                                {" "}
                                <span className="muted">→ {c.recommendation}</span>
                              </>
                            ) : null}
                          </span>
                        </div>
                      ))
                    : null}
                </div>
              );
            })}
            {healthReport.recommendations.length > 0 ? (
              <div className="health-report-section">
                <strong>Рекомендации</strong>
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  {healthReport.recommendations.map((r, i) => (
                    <li key={i} style={{ marginBottom: 4 }}>
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="muted" style={{ marginTop: 8 }}>
              Проверка выполнена: {new Date(healthReport.at).toLocaleString()}
            </p>
          </>
        )}
      </div>

      <div className="panel">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Устройства в сети</h2>
          <ActionButton
            helpId="session.network"
            disabled={busy}
            onClick={() => void onRefreshNet()}
          >
            Обновить
          </ActionButton>
        </div>
        <p className="lead">
          Эталон (complexos/milk/coffee/water/router) — HTTP + NATS. Роутер
          проверяется по веб-морде на :80 (offline часто значит «нет UI», не
          «роутер мёртв» — см. «?»). «Обновить» снимает ARP с complexos и
          показывает другие IP с MAC из ARP complexos (hostname + MAC).
        </p>
        <div className="row" style={{ marginBottom: 8 }}>
          <span
            className={`badge${session.natsOnline ? " on" : " danger"}`}
          >
            NATS {session.natsOnline ? "online" : "offline"}
            {session.natsUrl ? ` · ${session.natsUrl}` : ""}
          </span>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--text-muted)" }}>
              <th style={{ padding: "8px 4px" }}>Имя / MAC</th>
              <th>IP</th>
              <th>Роль</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            {(session.devices ?? []).map((d) => (
              <tr
                key={`${d.role}-${d.ip}`}
                style={{ borderTop: "1px solid var(--stroke)" }}
              >
                <td style={{ padding: "10px 4px" }}>
                  {formatDeviceName(d)}
                </td>
                <td>
                  <code>{d.ip}</code>
                </td>
                <td>
                  {d.role === "unknown" ? (
                    <span style={{ color: "var(--warn)" }}>другое</span>
                  ) : d.role === "router" ? (
                    <span className="row" style={{ gap: 6, alignItems: "center" }}>
                      router
                      <HelpTip controlId="session.router" />
                    </span>
                  ) : (
                    d.role
                  )}
                </td>
                <td
                  style={{
                    color: d.online ? "var(--ok)" : "var(--danger)",
                  }}
                >
                  {d.online
                    ? "online"
                    : d.role === "unknown"
                      ? "idle (ARP TTL)"
                      : d.role === "router"
                        ? "offline (нет веб :80)"
                        : "offline"}
                </td>
              </tr>
            ))}
            {(session.devices ?? []).length === 0 ? (
              <tr>
                <td colSpan={4} className="muted" style={{ padding: 10 }}>
                  Нет данных — нажмите «Обновить»
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatDeviceName(d: {
  role: string;
  hostname: string;
  mac?: string | null;
}): ReactNode {
  const mac = d.mac?.trim() || null;
  const host = d.hostname?.trim() || "";
  const hostIsMac =
    !!mac && host.toLowerCase() === mac.toLowerCase();
  const showHost = host && !hostIsMac && host !== d.role;

  if (d.role === "unknown") {
    if (showHost && mac) {
      return (
        <>
          {host}{" "}
          <code style={{ opacity: 0.85 }}>{mac}</code>
        </>
      );
    }
    if (showHost) return host;
    return <code>{mac ?? host}</code>;
  }

  if (mac) {
    return (
      <>
        {host || d.role}{" "}
        <code style={{ opacity: 0.85 }}>{mac}</code>
      </>
    );
  }
  return host || d.role;
}

function shouldShowError(connected: boolean, message: string): boolean {
  if (!connected) return true;
  return /нет|ошибк|протух|не удалось/i.test(message);
}

function healthBadgeModifier(level: HealthLevel): string {
  switch (level) {
    case "ok":
      return " on";
    case "warn":
      return " warn";
    case "error":
      return " danger";
    case "skip":
      return "";
  }
}
