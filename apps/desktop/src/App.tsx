/**
 * Корневой UI: сворачиваемый side nav + страницы.
 * Красная рамка / бейдж — если SSH-сессия не установлена или протухла.
 */

import { useEffect, useMemo, useState } from "react";
import { HelpTip } from "./components/HelpTip";
import { AccessPage } from "./pages/AccessPage";
import { ComplexOsPage } from "./pages/ComplexOsPage";
import { ConfigPage } from "./pages/ConfigPage";
import { FleetPage } from "./pages/FleetPage";
import { HelpPage } from "./pages/HelpPage";
import { ModulesPage } from "./pages/ModulesPage";
import { SessionPage } from "./pages/SessionPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SessionProvider } from "./state/SessionContext";
import { useComplexSession } from "./state/useComplexSession";

type TabId =
  | "fleet"
  | "access"
  | "session"
  | "modules"
  | "complexos"
  | "config"
  | "help"
  | "settings";

const NAV_COLLAPSE_KEY = "sm.navCollapsed";

const TABS: Array<{
  id: TabId;
  label: string;
  icon: string;
  helpId: string;
  title: string;
}> = [
  { id: "fleet", label: "Флот", icon: "◈", helpId: "nav.fleet", title: "Флот комплексов" },
  { id: "access", label: "Доступ", icon: "⌁", helpId: "nav.access", title: "Доступ и SSH" },
  {
    id: "session",
    label: "Сессия",
    icon: "◎",
    helpId: "nav.session",
    title: "Сессия комплекса",
  },
  {
    id: "modules",
    label: "Модули",
    icon: "▣",
    helpId: "nav.modules",
    title: "Тест модулей и сиропа",
  },
  {
    id: "complexos",
    label: "ComplexOS",
    icon: "⊞",
    helpId: "nav.complexos",
    title: "ComplexOS · сервис",
  },
  {
    id: "config",
    label: "Конфиг",
    icon: "⚙",
    helpId: "nav.config",
    title: "Конфиги drinkx / ComplexOS",
  },
  { id: "help", label: "Справка", icon: "?", helpId: "nav.help", title: "Справка" },
  {
    id: "settings",
    label: "Настройки",
    icon: "···",
    helpId: "nav.settings",
    title: "Настройки",
  },
];

function AppShell() {
  const [tab, setTab] = useState<TabId>("session");
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(NAV_COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const current = useMemo(() => TABS.find((t) => t.id === tab)!, [tab]);
  const { session, warn } = useComplexSession();

  useEffect(() => {
    try {
      localStorage.setItem(NAV_COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch {
      // ignore
    }
  }, [collapsed]);

  return (
    <div
      className={`app-shell${warn ? " session-warn" : ""}${
        collapsed ? " nav-collapsed" : ""
      }`}
    >
      <aside className="sidebar" aria-label="Навигация">
        <div className="brand">
          {collapsed ? (
            <span className="brand-mark" title="Service Monitor">
              SM
            </span>
          ) : (
            <>
              Service Monitor
              <span>DrinkX · полевой сервис</span>
            </>
          )}
        </div>
        <button
          type="button"
          className="nav-toggle"
          title={collapsed ? "Развернуть меню" : "Свернуть в иконки"}
          aria-label={collapsed ? "Развернуть меню" : "Свернуть меню"}
          onClick={() => setCollapsed((v) => !v)}
        >
          {collapsed ? "»" : "«"}
        </button>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`nav-btn${tab === t.id ? " active" : ""}${
              t.id === "session" && warn ? " nav-warn" : ""
            }`}
            title={t.title}
            onClick={() => setTab(t.id)}
          >
            <span className="nav-icon" aria-hidden>
              {t.icon}
            </span>
            <span className="nav-label">{t.label}</span>
            {!collapsed ? <HelpTip controlId={t.helpId} /> : null}
          </button>
        ))}
      </aside>

      <div className="main">
        <header className="topbar">
          <h1>{current.title}</h1>
          <span className={`badge${warn ? " danger" : " on"}`}>
            {warn
              ? !session.connected
                ? "Сессия не установлена"
                : session.message || "Сессия нестабильна"
              : session.mode === "local"
                ? "Local LAN · ok"
                : `Remote ${session.seriesLabel} · ok`}
          </span>
        </header>
        <main className="content">
          {tab === "fleet" ? <FleetPage /> : null}
          {tab === "access" ? <AccessPage /> : null}
          {tab === "session" ? <SessionPage /> : null}
          {tab === "modules" ? <ModulesPage /> : null}
          {tab === "complexos" ? <ComplexOsPage /> : null}
          {tab === "config" ? <ConfigPage /> : null}
          {tab === "help" ? <HelpPage /> : null}
          {tab === "settings" ? <SettingsPage /> : null}
        </main>
      </div>
    </div>
  );
}

export function App() {
  return (
    <SessionProvider>
      <AppShell />
    </SessionProvider>
  );
}
