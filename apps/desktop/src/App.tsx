/**
 * Корневой UI: сворачиваемый side nav + страницы.
 * Красная рамка / бейдж — если SSH-сессия не установлена или протухла.
 */

import { useEffect, useMemo, useState } from "react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { HelpTip } from "./components/HelpTip";
import { AccessPage } from "./pages/AccessPage";
import { ComplexOsPage } from "./pages/ComplexOsPage";
import { ConfigPage } from "./pages/ConfigPage";
import { FleetPage } from "./pages/FleetPage";
import { HelpPage } from "./pages/HelpPage";
import { ModulesPage } from "./pages/ModulesPage";
import { PeripheralsPage } from "./pages/PeripheralsPage";
import { PosPage } from "./pages/PosPage";
import { SessionPage } from "./pages/SessionPage";
import { SettingsPage } from "./pages/SettingsPage";
import { LabChartWindowPage } from "./components/ModulesLabCharts";
import {
  LAB_BG_TELEMETRY_EVENT,
  readLabBgTelemetry,
} from "./lib/lab-bg-telemetry";
import { smLog } from "./lib/sm-log";
import { SessionProvider } from "./state/SessionContext";
import { useComplexSession } from "./state/useComplexSession";

function isLabChartView(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("view") === "lab-chart";
  } catch {
    return false;
  }
}

type TabId =
  | "fleet"
  | "access"
  | "session"
  | "modules"
  | "peripherals"
  | "pos"
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
    title: "DrinkX · Industrial Control",
  },
  {
    id: "peripherals",
    label: "Дозатор",
    icon: "⬡",
    helpId: "nav.peripherals",
    title: "Дозатор · Flash / flash_obraz",
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
  {
    id: "pos",
    label: "Касса / ККТ",
    icon: "▤",
    helpId: "nav.pos",
    title: "Касса · ККТ / платежи",
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
  const [labBgTelemetry, setLabBgTelemetry] = useState(readLabBgTelemetry);
  const current = useMemo(() => TABS.find((t) => t.id === tab)!, [tab]);
  const { session, warn } = useComplexSession();

  const keepModulesAlive = labBgTelemetry && session.connected === true;
  const modulesVisible = tab === "modules";
  const modulesMounted = modulesVisible || keepModulesAlive;

  useEffect(() => {
    try {
      localStorage.setItem(NAV_COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch {
      // ignore
    }
  }, [collapsed]);

  useEffect(() => {
    smLog("info", "nav", `tab → ${tab}`);
  }, [tab]);

  useEffect(() => {
    const onPref = (e: Event) => {
      const detail = (e as CustomEvent<{ enabled: boolean }>).detail;
      if (detail && typeof detail.enabled === "boolean") {
        setLabBgTelemetry(detail.enabled);
      } else {
        setLabBgTelemetry(readLabBgTelemetry());
      }
    };
    window.addEventListener(LAB_BG_TELEMETRY_EVENT, onPref);
    return () => window.removeEventListener(LAB_BG_TELEMETRY_EVENT, onPref);
  }, []);

  /** Уход с Модулей → закрыть окно графиков, если фон-опрос выкл.
   * Без сессии окно не трогаем — нужен offline-просмотр импортированного лога. */
  useEffect(() => {
    if (tab === "modules") return;
    if (keepModulesAlive) return;
    if (!session.connected) return;
    void window.desktop.closeLabChartWindow?.();
  }, [tab, keepModulesAlive, session.connected]);

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
          <div key={t.id} className="nav-row">
            <button
              type="button"
              className={`nav-btn${tab === t.id ? " active" : ""}`}
              onClick={() => setTab(t.id)}
              title={collapsed ? t.title : undefined}
            >
              <span className="nav-icon" aria-hidden>
                {t.icon}
              </span>
              <span className="nav-label">{t.label}</span>
            </button>
            {!collapsed ? <HelpTip controlId={t.helpId} /> : null}
          </div>
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
          {labBgTelemetry && session.connected ? (
            <span className="badge on" title="Lab опрос в фоне для графиков">
              Lab фон
            </span>
          ) : null}
        </header>
        <main className="content">
          {modulesMounted ? (
            <div
              hidden={!modulesVisible}
              aria-hidden={!modulesVisible}
              style={modulesVisible ? undefined : { display: "none" }}
            >
              <ErrorBoundary label="modules">
                <ModulesPage />
              </ErrorBoundary>
            </div>
          ) : null}
          {tab !== "modules" ? (
            <ErrorBoundary label={tab} key={tab}>
              {tab === "fleet" ? <FleetPage /> : null}
              {tab === "access" ? <AccessPage /> : null}
              {tab === "session" ? <SessionPage /> : null}
              {tab === "peripherals" ? <PeripheralsPage /> : null}
              {tab === "pos" ? <PosPage /> : null}
              {tab === "complexos" ? <ComplexOsPage /> : null}
              {tab === "config" ? <ConfigPage /> : null}
              {tab === "help" ? <HelpPage /> : null}
              {tab === "settings" ? <SettingsPage /> : null}
            </ErrorBoundary>
          ) : null}
        </main>
      </div>
    </div>
  );
}

export function App() {
  if (isLabChartView()) {
    return (
      <ErrorBoundary label="lab-chart">
        <LabChartWindowPage />
      </ErrorBoundary>
    );
  }
  return (
    <SessionProvider>
      <AppShell />
    </SessionProvider>
  );
}
