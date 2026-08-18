/**
 * Доступность хостов (sm-host-ping) — отдельно от «Бортовой лог».
 * IP/MAC планшета — поля на странице (не window.prompt; в Electron он часто ломается).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  HOST_PING_REMOTE_ROOT,
  HOST_PING_USER_UNIT_REL,
  formatHostPingStatusLine,
  isHostPingSessionAllowed,
  type HostPingStatus,
} from "@service-monitor/core";
import { HelpTip } from "../components/HelpTip";
import { readTabletTargetsFromFields } from "../lib/host-ping-targets";
import { useComplexSession } from "../state/useComplexSession";

type LogKind = "ok" | "err" | "info";

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export { readTabletTargetsFromFields };

export function HostPingPage() {
  const { session } = useComplexSession();
  const live = session.connected === true;
  const controlsDisabled = !isHostPingSessionAllowed(session);

  const [status, setStatus] = useState<HostPingStatus | null>(null);
  const [tabletIp, setTabletIp] = useState("");
  const [tabletMac, setTabletMac] = useState("");
  const [targetError, setTargetError] = useState<string | null>(null);
  const [autostart, setAutostart] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [recent, setRecent] = useState("");
  const [log, setLog] = useState<Array<{ kind: LogKind; text: string }>>([]);

  const ipRef = useRef<HTMLInputElement>(null);
  const macRef = useRef<HTMLInputElement>(null);

  const pushLog = useCallback((kind: LogKind, text: string) => {
    setLog((prev) => [{ kind, text }, ...prev].slice(0, 40));
  }, []);

  const focusTargets = useCallback((focus: "ip" | "mac" | "both") => {
    const el =
      focus === "mac" ? macRef.current : ipRef.current ?? macRef.current;
    el?.focus();
    el?.select();
  }, []);

  const takeTargetsFromForm = useCallback(() => {
    const next = readTabletTargetsFromFields({
      ip: tabletIp,
      mac: tabletMac,
    });
    if (!next.ok) {
      setTargetError(next.error);
      focusTargets(next.focus);
      pushLog("err", next.error);
      return null;
    }
    setTargetError(null);
    setTabletIp(next.ip);
    setTabletMac(next.mac);
    return next;
  }, [focusTargets, pushLog, tabletIp, tabletMac]);

  const refreshStatus = useCallback(async () => {
    if (!live) return;
    if (typeof window.desktop.hostPingStatus !== "function") {
      pushLog("err", "IPC hostPing не доступен — перезапустите SM один раз");
      return;
    }
    try {
      const res = await window.desktop.hostPingStatus();
      if (!res.ok) {
        pushLog("err", res.error);
        return;
      }
      setStatus(res.status);
      if (res.status.tabletIp) setTabletIp(res.status.tabletIp);
      if (res.status.tabletMac) setTabletMac(res.status.tabletMac);
      pushLog("ok", formatHostPingStatusLine(res.status));
    } catch (e) {
      pushLog("err", errText(e));
    }
  }, [live, pushLog]);

  useEffect(() => {
    if (live) void refreshStatus();
  }, [live, refreshStatus]);

  const runSetTargets = useCallback(async () => {
    if (controlsDisabled) return;
    const next = takeTargetsFromForm();
    if (!next) return;
    pushLog(
      "ok",
      `Цели: IP=${next.ip || "—"} MAC=${next.mac || "—"}`
    );
    if (!status?.installed) {
      pushLog(
        "info",
        "Цели сохранены локально — будут в config при «Установить»"
      );
      return;
    }
    setBusy("targets");
    try {
      const res = await window.desktop.hostPingSetTablet({
        tabletIp: next.tabletIp,
        tabletMac: next.tabletMac,
      });
      if (!res.ok) {
        pushLog("err", res.error);
        return;
      }
      pushLog("ok", res.message);
      await refreshStatus();
    } catch (e) {
      pushLog("err", errText(e));
    } finally {
      setBusy(null);
    }
  }, [
    controlsDisabled,
    pushLog,
    refreshStatus,
    status?.installed,
    takeTargetsFromForm,
  ]);

  const runInstall = useCallback(async () => {
    if (controlsDisabled) return;
    const next = takeTargetsFromForm();
    if (!next) {
      pushLog("err", "Установка отменена: нужен IP или MAC планшета");
      return;
    }
    setBusy("install");
    try {
      const res = await window.desktop.hostPingInstall({
        tabletIp: next.tabletIp,
        tabletMac: next.tabletMac,
        enableAutostart: autostart,
      });
      if (!res.ok) {
        pushLog("err", res.error);
        return;
      }
      pushLog("ok", res.message);
      await refreshStatus();
    } catch (e) {
      pushLog("err", errText(e));
    } finally {
      setBusy(null);
    }
  }, [autostart, controlsDisabled, pushLog, refreshStatus, takeTargetsFromForm]);

  const runUninstall = useCallback(async () => {
    if (controlsDisabled) return;
    if (
      typeof window.confirm === "function" &&
      !window.confirm("Удалить sm-host-ping на complexos (код + data + unit)?")
    ) {
      return;
    }
    setBusy("uninstall");
    try {
      const res = await window.desktop.hostPingUninstall({ wipeData: true });
      if (!res.ok) {
        pushLog("err", res.error);
        return;
      }
      pushLog("ok", res.message);
      await refreshStatus();
    } catch (e) {
      pushLog("err", errText(e));
    } finally {
      setBusy(null);
    }
  }, [controlsDisabled, pushLog, refreshStatus]);

  const runAutostart = useCallback(
    async (enabled: boolean) => {
      if (controlsDisabled) return;
      setBusy("autostart");
      try {
        const res = await window.desktop.hostPingSetAutostart({ enabled });
        if (!res.ok) {
          pushLog("err", res.error);
          return;
        }
        setAutostart(enabled);
        pushLog("ok", res.message);
        await refreshStatus();
      } catch (e) {
        pushLog("err", errText(e));
      } finally {
        setBusy(null);
      }
    },
    [controlsDisabled, pushLog, refreshStatus]
  );

  const runDownload = useCallback(async () => {
    if (controlsDisabled) return;
    setBusy("download");
    try {
      const res = await window.desktop.hostPingDownloadRing();
      if (!res.ok) {
        pushLog("err", res.error);
        return;
      }
      pushLog("ok", `Сохранено ${res.bytes} байт → ${res.path}`);
    } catch (e) {
      pushLog("err", errText(e));
    } finally {
      setBusy(null);
    }
  }, [controlsDisabled, pushLog]);

  const runRecent = useCallback(async () => {
    if (controlsDisabled) return;
    setBusy("recent");
    try {
      const res = await window.desktop.hostPingFetchRecent({ lines: 40 });
      if (!res.ok) {
        pushLog("err", res.error);
        return;
      }
      setRecent(res.text || "(пусто)");
      pushLog("ok", "Последние смены загружены");
    } catch (e) {
      pushLog("err", errText(e));
    } finally {
      setBusy(null);
    }
  }, [controlsDisabled, pushLog]);

  return (
    <div className="page lab-logger-page">
      <header className="page-head">
        <h2>
          Доступность
          <HelpTip controlId="nav.hostPing" />
        </h2>
        <p className="muted">
          Отдельный агент <strong>sm-host-ping</strong> на complexos (не бортовой
          лог). Ping ~30с (LAN + erp.fibbee.com + 91.206.15.66 + 8.8.8.8), snapshot каждые
          5 мин, traceroute при недоступности WAN, retention ≥14 дней.
        </p>
      </header>

      {!live ? (
        <p className="warn">Нужна активная сессия (вкладка Сессия).</p>
      ) : controlsDisabled ? (
        <p className="warn">Серия 4.x (Remote) или Local LAN.</p>
      ) : null}

      <section className="card">
        <h3>
          Путь <HelpTip controlId="hostPing.install" />
        </h3>
        <p className="mono">
          {HOST_PING_REMOTE_ROOT} · unit {HOST_PING_USER_UNIT_REL}
        </p>
        <p className="muted">
          Цели по умолчанию: .43 / .44 / .45 / .46 / .1 + планшет (IP и/или MAC)
          + erp.fibbee.com + 91.206.15.66 + 8.8.8.8.
        </p>
      </section>

      <section className="card">
        <h3>
          Планшет <HelpTip controlId="hostPing.targets" />
        </h3>
        <p className="muted">
          Укажите IP и/или MAC ниже — «Установить» и «Задать цели…» берут значения
          из этих полей (без системного prompt).
        </p>
        <div className="row" style={{ marginTop: 12, flexWrap: "wrap", gap: 12 }}>
          <div className="field" style={{ minWidth: 200, flex: 1 }}>
            <label htmlFor="host-ping-tablet-ip">IP планшета</label>
            <input
              id="host-ping-tablet-ip"
              ref={ipRef}
              className="mono"
              value={tabletIp}
              disabled={controlsDisabled || busy != null}
              placeholder="192.168.1.28"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => {
                setTabletIp(e.target.value);
                if (targetError) setTargetError(null);
              }}
            />
          </div>
          <div className="field" style={{ minWidth: 220, flex: 1 }}>
            <label htmlFor="host-ping-tablet-mac">MAC планшета</label>
            <input
              id="host-ping-tablet-mac"
              ref={macRef}
              className="mono"
              value={tabletMac}
              disabled={controlsDisabled || busy != null}
              placeholder="aa:bb:cc:dd:ee:ff"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => {
                setTabletMac(e.target.value);
                if (targetError) setTargetError(null);
              }}
            />
          </div>
        </div>
        {targetError ? (
          <p className="warn" style={{ marginTop: 8 }} role="alert">
            {targetError}
          </p>
        ) : (
          <p className="muted" style={{ marginTop: 8 }}>
            Достаточно одного поля. MAC: aa:bb:… / aa-bb-… / aabb… — сохранится как
            aa:bb:….
          </p>
        )}
        <div className="row" style={{ marginTop: 12, gap: 8 }}>
          <button
            type="button"
            disabled={controlsDisabled || busy != null}
            onClick={() => void runSetTargets()}
          >
            {busy === "targets" ? "Запись…" : "Задать цели…"}
          </button>
        </div>
      </section>

      <section className="card">
        <h3>Управление</h3>
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          <button
            type="button"
            disabled={controlsDisabled || busy != null}
            onClick={() => void runInstall()}
          >
            {busy === "install" ? "Установка…" : "Установить"}
          </button>
          <label className="row" style={{ gap: 6, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={autostart}
              disabled={controlsDisabled || busy != null}
              onChange={(e) => setAutostart(e.target.checked)}
            />
            Autostart
          </label>
          <button
            type="button"
            disabled={controlsDisabled || busy != null || !status?.installed}
            onClick={() => void runAutostart(true)}
          >
            Вкл autostart
          </button>
          <button
            type="button"
            disabled={controlsDisabled || busy != null || !status?.installed}
            onClick={() => void runAutostart(false)}
          >
            Выкл autostart
          </button>
          <button
            type="button"
            disabled={controlsDisabled || busy != null}
            onClick={() => void refreshStatus()}
          >
            Статус
          </button>
          <button
            type="button"
            className="danger"
            disabled={controlsDisabled || busy != null}
            onClick={() => void runUninstall()}
          >
            Удалить
          </button>
        </div>
        {status ? (
          <p className="mono muted" style={{ marginTop: "0.75rem" }}>
            {formatHostPingStatusLine(status)}
          </p>
        ) : null}
      </section>

      <section className="card">
        <h3>
          Лог <HelpTip controlId="hostPing.download" />
        </h3>
        <div className="row" style={{ gap: 8 }}>
          <button
            type="button"
            disabled={controlsDisabled || busy != null}
            onClick={() => void runDownload()}
          >
            Скачать лог
          </button>
          <button
            type="button"
            disabled={controlsDisabled || busy != null}
            onClick={() => void runRecent()}
          >
            Показать недавние смены
          </button>
        </div>
        {recent ? (
          <pre className="mono" style={{ maxHeight: 240, overflow: "auto" }}>
            {recent}
          </pre>
        ) : null}
      </section>

      <section className="card">
        <h3>Журнал</h3>
        <ul className="log-list">
          {log.map((e, i) => (
            <li key={`${i}-${e.text.slice(0, 24)}`} className={e.kind}>
              {e.text}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
