/**
 * Настройки: Debug. Сервисный пароль задаёт админ в коде сборки.
 */

import { useEffect, useState } from "react";
import { ActionButton } from "../components/ActionButton";
import { HelpTip } from "../components/HelpTip";
import { openLabChartLogViewer } from "../components/ModulesLabCharts";
import {
  readLabBgTelemetry,
  writeLabBgTelemetry,
} from "../lib/lab-bg-telemetry";

type Paths = Awaited<ReturnType<Window["desktop"]["getPaths"]>>;

export function SettingsPage() {
  const [debug, setDebug] = useState(false);
  const [labBg, setLabBg] = useState(false);
  const [paths, setPaths] = useState<Paths | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [unlockPassword, setUnlockPassword] = useState("");
  const [writeUnlocked, setWriteUnlocked] = useState(false);
  const [logViewerBusy, setLogViewerBusy] = useState(false);

  useEffect(() => {
    void window.desktop.getPaths().then(setPaths);
    const stored = localStorage.getItem("sm.debug") === "1";
    setDebug(stored);
    if (stored) void window.desktop.setDebugEnabled(true);
    setWriteUnlocked(sessionStorage.getItem("sm.writeUnlocked") === "1");
    setLabBg(readLabBgTelemetry());
  }, []);

  async function toggleDebug(next: boolean) {
    setDebug(next);
    localStorage.setItem("sm.debug", next ? "1" : "0");
    await window.desktop.setDebugEnabled(next);
    await window.desktop.log(
      "info",
      "settings",
      `Debug ${next ? "enabled" : "disabled"}`
    );
    setToast(
      next
        ? `Debug включён. Логи: ${paths?.debugLogs ?? "…"}`
        : "Debug выключен"
    );
  }

  function toggleLabBg(next: boolean) {
    writeLabBgTelemetry(next);
    setLabBg(next);
    setToast(
      next
        ? "Lab опрос в фоне включён — графики пишутся вне вкладки Модули"
        : "Lab опрос только на вкладке Модули"
    );
  }

  async function openChartLog() {
    setLogViewerBusy(true);
    try {
      const res = await openLabChartLogViewer();
      if (!res.ok) {
        setToast(res.error || "Не удалось открыть окно графика");
        return;
      }
      setToast(
        "Окно графика открыто — «Импорт лога» для JSON (service-monitor-lab-chart)"
      );
    } finally {
      setLogViewerBusy(false);
    }
  }

  async function unlockWrite() {
    const res = await window.desktop.verifyServicePassword(unlockPassword);
    if (!res.ok) {
      setToast("Неверный сервисный пароль");
      setWriteUnlocked(false);
      sessionStorage.removeItem("sm.writeUnlocked");
      await window.desktop.log("warn", "settings", "write unlock failed");
      return;
    }
    setWriteUnlocked(true);
    sessionStorage.setItem("sm.writeUnlocked", "1");
    setUnlockPassword("");
    setToast("Правки разблокированы на эту сессию приложения");
    await window.desktop.log("info", "settings", "write unlocked");
  }

  function lockWrite() {
    setWriteUnlocked(false);
    sessionStorage.removeItem("sm.writeUnlocked");
    setToast("Правки снова заблокированы");
  }

  async function copyDebugLog() {
    const text = await window.desktop.exportDebugLog();
    await navigator.clipboard.writeText(
      text || "(пусто — включите Debug и повторите действия)"
    );
    setToast("Debug-лог скопирован в буфер — можно вставить в чат ассистенту");
  }

  return (
    <div className="stack">
      <div className="panel">
        <h2>Debug-режим</h2>
        <p className="lead">
          Сохраняет подробные логи для разбора сбоев. При проблеме скопируйте лог
          и приложите в чат.
        </p>
        <div className="row">
          <ActionButton
            helpId="settings.debug"
            variant={debug ? "primary" : "default"}
            onClick={() => void toggleDebug(!debug)}
          >
            {debug ? "Debug включён" : "Включить Debug"}
          </ActionButton>
          <ActionButton onClick={() => void copyDebugLog()}>
            Копировать лог
          </ActionButton>
          <span className={`badge${debug ? " on" : ""}`}>
            {debug ? "запись на диск" : "выкл"}
          </span>
        </div>
        {paths ? (
          <p className="muted" style={{ marginTop: 12 }}>
            Папка логов: <code>{paths.debugLogs}</code>
          </p>
        ) : null}
        {toast ? <div className="toast">{toast}</div> : null}
      </div>

      <div className="panel">
        <div className="row" style={{ alignItems: "center", gap: 8 }}>
          <h2 style={{ margin: 0 }}>Лог графика комплекса</h2>
          <HelpTip controlId="settings.labChartLog" />
        </div>
        <p className="lead">
          Просмотр сохранённого JSON-лога графика без SSH/NATS. В окне — «Импорт
          лога» (kind: service-monitor-lab-chart).
        </p>
        <div className="row">
          <ActionButton
            helpId="settings.labChartLog"
            variant="primary"
            disabled={logViewerBusy}
            onClick={() => void openChartLog()}
          >
            {logViewerBusy ? "…" : "Открыть лог графика"}
          </ActionButton>
        </div>
      </div>

      <div className="panel">
        <div className="row" style={{ alignItems: "center", gap: 8 }}>
          <h2 style={{ margin: 0 }}>Lab опрос в фоне</h2>
          <HelpTip controlId="settings.labBgTelemetry" />
        </div>
        <p className="lead">
          Держит NATS/DX опрос Modules Lab при уходе с вкладки «Модули», чтобы
          отдельное окно графиков продолжало писать точки.
        </p>
        <div className="row">
          <ActionButton
            helpId="settings.labBgTelemetry"
            variant={labBg ? "primary" : "default"}
            onClick={() => toggleLabBg(!labBg)}
          >
            {labBg ? "Фон включён" : "Включить фон"}
          </ActionButton>
          <span className={`badge${labBg ? " on" : ""}`}>
            {labBg ? "опрос вне Модулей" : "только Модули"}
          </span>
        </div>
      </div>

      <div className="panel">
        <h2>Сервисный пароль (правки конфигов)</h2>
        <p className="lead">
          Пароль задаёт <strong>админ или разработчик</strong> приложения (в
          сборке), не полевой инженер. Это не пароль ERP. Без него — только
          чтение; с ним — разблокировка правок drinkx.json на сессию.
        </p>
        <div className="row">
          <span className={`badge${writeUnlocked ? " on" : ""}`}>
            {writeUnlocked ? "правки разрешены" : "только чтение"}
          </span>
        </div>
        {!writeUnlocked ? (
          <div className="row" style={{ marginTop: 12 }}>
            <div className="field">
              <label htmlFor="sp-unlock">Сервисный пароль</label>
              <input
                id="sp-unlock"
                type="password"
                value={unlockPassword}
                onChange={(e) => setUnlockPassword(e.target.value)}
                autoComplete="off"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void unlockWrite();
                }}
              />
            </div>
            <ActionButton
              helpId="session.unlockWrite"
              variant="primary"
              onClick={() => void unlockWrite()}
            >
              Разблокировать правки
            </ActionButton>
          </div>
        ) : (
          <div className="row" style={{ marginTop: 12 }}>
            <ActionButton onClick={lockWrite}>Заблокировать</ActionButton>
          </div>
        )}
      </div>
    </div>
  );
}
