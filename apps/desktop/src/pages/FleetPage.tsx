/**
 * Этап 2: облачный флот ERP (логин + список комплексов).
 */

import { useEffect, useMemo, useState } from "react";
import type { ErpSalesPoint } from "@service-monitor/core";
import { ActionButton } from "../components/ActionButton";

export function FleetPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [points, setPoints] = useState<ErpSalesPoint[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(
    null
  );

  useEffect(() => {
    void (async () => {
      const session = await window.desktop.erpGetSession();
      if (session.ok) {
        setSessionEmail(session.email);
        setEmail(session.email);
        await refreshList();
      }
    })();
  }, []);

  async function refreshList() {
    setLoading(true);
    setToast(null);
    const res = await window.desktop.erpListSalesPoints();
    setLoading(false);
    if (!res.ok) {
      setToast({ text: res.error, error: true });
      return;
    }
    setPoints(res.points);
    setToast({ text: `Загружено комплексов: ${res.points.length}` });
    await window.desktop.log("info", "fleet", "points loaded", {
      count: res.points.length,
    });
  }

  async function onLogin() {
    setLoading(true);
    setToast(null);
    const res = await window.desktop.erpLogin({ email, password });
    setLoading(false);
    if (!res.ok) {
      setToast({ text: res.error, error: true });
      return;
    }
    setSessionEmail(res.email);
    setPassword("");
    setToast({
      text: `Вход выполнен${res.role ? ` (${res.role})` : ""}`,
    });
    await refreshList();
  }

  async function onLogout() {
    await window.desktop.erpLogout();
    setSessionEmail(null);
    setPoints([]);
    setToast({ text: "Вы вышли из ERP" });
  }

  async function openDashboard(sp: ErpSalesPoint) {
    const res = await window.desktop.erpDashboardUrl(sp.salesPointId);
    if (!res.ok) {
      setToast({ text: res.error, error: true });
      return;
    }
    const open = await window.desktop.openExternal(res.url);
    if (!open.ok) {
      setToast({ text: open.error, error: true });
    }
  }

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return points;
    return points.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.salesPointId.toLowerCase().includes(q) ||
        (p.seriesLabel ?? "").toLowerCase().includes(q) ||
        p.status.toLowerCase().includes(q)
    );
  }, [points, filter]);

  return (
    <div className="stack">
      <div className="panel">
        <h2>Вход в ERP</h2>
        <p className="lead">
          Тот же логин, что на erp.fibbee.com (email + пароль). Токен хранится
          локально — пароль не сохраняем.
        </p>
        {sessionEmail ? (
          <div className="row">
            <span className="badge on">сессия: {sessionEmail}</span>
            <ActionButton helpId="nav.fleet" onClick={() => void onLogout()}>
              Выйти
            </ActionButton>
            <ActionButton
              variant="primary"
              disabled={loading}
              onClick={() => void refreshList()}
            >
              Обновить список
            </ActionButton>
          </div>
        ) : (
          <>
            <div className="row">
              <div className="field">
                <label htmlFor="erp-email">Email</label>
                <input
                  id="erp-email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="erp-pass">Пароль</label>
                <input
                  id="erp-pass"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void onLogin();
                  }}
                />
              </div>
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <ActionButton
                helpId="nav.fleet"
                variant="primary"
                disabled={loading}
                onClick={() => void onLogin()}
              >
                {loading ? "Вход…" : "Войти в ERP"}
              </ActionButton>
            </div>
          </>
        )}
        {toast ? (
          <div className={`toast${toast.error ? " error" : ""}`}>{toast.text}</div>
        ) : null}
      </div>

      <div className="panel">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Комплексы</h2>
          <div className="field" style={{ maxWidth: 280, margin: 0 }}>
            <label htmlFor="flt">Поиск</label>
            <input
              id="flt"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="имя, id, серия, статус"
              disabled={!sessionEmail}
            />
          </div>
        </div>
        <p className="lead">
          Данные из GET /v1/sales-points/list. «Дашборд ERP» открывает облачный
          monitor; локальный дашборд комплекса — на вкладке Сессия после SSH.
        </p>
        {!sessionEmail ? (
          <p className="muted">Войдите, чтобы увидеть флот.</p>
        ) : filtered.length === 0 ? (
          <p className="muted">
            {loading ? "Загрузка…" : "Нет точек по фильтру / список пуст"}
          </p>
        ) : (
          <div style={{ overflow: "auto", maxHeight: "48vh" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--text-muted)" }}>
                  <th style={{ padding: "8px 4px" }}>Имя</th>
                  <th>Статус</th>
                  <th>Серия</th>
                  <th>ID</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr
                    key={p.salesPointId}
                    style={{ borderTop: "1px solid var(--stroke)" }}
                  >
                    <td style={{ padding: "10px 4px" }}>{p.name}</td>
                    <td>
                      <StatusPill status={p.status} />
                    </td>
                    <td className="muted">{p.seriesLabel ?? "—"}</td>
                    <td>
                      <code style={{ fontSize: "0.75rem" }}>
                        {p.salesPointId.slice(0, 10)}…
                      </code>
                    </td>
                    <td>
                      <ActionButton onClick={() => void openDashboard(p)}>
                        Дашборд ERP
                      </ActionButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "production"
      ? "on"
      : status === "archived" || status === "discontinued"
        ? ""
        : "";
  return <span className={`badge${tone ? ` ${tone}` : ""}`}>{status}</span>;
}
