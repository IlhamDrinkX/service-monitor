/**
 * Настройки: Debug. Сервисный пароль задаёт админ в коде сборки.
 */

import { useEffect, useState } from "react";
import { ActionButton } from "../components/ActionButton";

type Paths = Awaited<ReturnType<Window["desktop"]["getPaths"]>>;

export function SettingsPage() {
  const [debug, setDebug] = useState(false);
  const [paths, setPaths] = useState<Paths | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [unlockPassword, setUnlockPassword] = useState("");
  const [writeUnlocked, setWriteUnlocked] = useState(false);

  useEffect(() => {
    void window.desktop.getPaths().then(setPaths);
    const stored = localStorage.getItem("sm.debug") === "1";
    setDebug(stored);
    if (stored) void window.desktop.setDebugEnabled(true);
    setWriteUnlocked(sessionStorage.getItem("sm.writeUnlocked") === "1");
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
