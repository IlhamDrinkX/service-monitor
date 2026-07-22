/**
 * Корневой UI: навигация + страницы этапов.
 * Красная рамка / бейдж — если SSH-сессия не установлена или протухла.
 */

import { useMemo, useState } from "react";
import { HelpTip } from "./components/HelpTip";
import { AccessPage } from "./pages/AccessPage";
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
  | "config"
  | "help"
  | "settings";

const TABS: Array<{ id: TabId; label: string; helpId: string; title: string }> =
  [
    { id: "fleet", label: "Флот", helpId: "nav.fleet", title: "Флот комплексов" },
    { id: "access", label: "Доступ", helpId: "nav.access", title: "Доступ и SSH" },
    {
      id: "session",
      label: "Сессия",
      helpId: "nav.session",
      title: "Сессия комплекса",
    },
    {
      id: "modules",
      label: "Модули",
      helpId: "nav.modules",
      title: "Тест модулей и сиропа",
    },
    {
      id: "config",
      label: "Конфиг",
      helpId: "nav.config",
      title: "drinkx.json",
    },
    { id: "help", label: "Справка", helpId: "nav.help", title: "Справка" },
    {
      id: "settings",
      label: "Настройки",
      helpId: "nav.settings",
      title: "Настройки",
    },
  ];

function AppShell() {
  const [tab, setTab] = useState<TabId>("session");
  const current = useMemo(() => TABS.find((t) => t.id === tab)!, [tab]);
  const { session, warn } = useComplexSession();

  return (
    <div className={`app-shell${warn ? " session-warn" : ""}`}>
      <aside className="sidebar">
        <div className="brand">
          Service Monitor
          <span>DrinkX · полевой сервис</span>
        </div>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`nav-btn${tab === t.id ? " active" : ""}${
              t.id === "session" && warn ? " nav-warn" : ""
            }`}
            onClick={() => setTab(t.id)}
          >
            <span>{t.label}</span>
            <HelpTip controlId={t.helpId} />
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
