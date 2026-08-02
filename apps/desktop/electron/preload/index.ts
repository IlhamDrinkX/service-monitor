/**
 * Preload: безопасный мост renderer ↔ main.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type {
  ComplexSessionSnapshot,
  ErpSalesPoint,
  NatsConnectionInfo,
  NatsMusterEntry,
} from "@service-monitor/core";

export type DesktopApi = {
  getPaths: () => Promise<{
    userData: string;
    debugLogs: string;
    identityFile: string;
    pubkeyFile: string;
    sshConfig: string;
  }>;
  setDebugEnabled: (enabled: boolean) => Promise<{ enabled: boolean }>;
  exportDebugLog: () => Promise<string>;
  log: (
    level: "debug" | "info" | "warn" | "error",
    scope: string,
    message: string,
    data?: unknown
  ) => Promise<void>;
  readPubkey: () => Promise<
    | { ok: true; pubkey: string; path: string }
    | { ok: false; error: string; path: string }
  >;
  generateKey: () => Promise<
    | { ok: true; pubkey: string; path: string }
    | { ok: false; error: string; path: string }
  >;
  renderSnippet: (input: {
    seriesLabel: string;
    name?: string;
    includeJumpHost?: boolean;
  }) => Promise<{ profile: unknown; snippet: string }>;
  applyConfig: (input: {
    seriesLabel: string;
    name?: string;
  }) => Promise<{
    ok: true;
    path: string;
    profile: unknown;
    jumpHostAdded: boolean;
    hadJumpHost: boolean;
  }>;
  openSshConfig: () => Promise<
    { ok: true; path: string } | { ok: false; error: string; path: string }
  >;
  openExternal: (
    url: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  hashServicePassword: (password: string) => Promise<string>;
  verifyServicePassword: (
    password: string
  ) => Promise<{ ok: boolean }>;
  verifyCashDevPassword: (
    password: string
  ) => Promise<{ ok: boolean }>;
  erpGetSession: () => Promise<
    { ok: true; email: string } | { ok: false }
  >;
  erpLogin: (input: {
    email: string;
    password: string;
  }) => Promise<
    | { ok: true; email: string; role?: string }
    | { ok: false; error: string }
  >;
  erpLogout: () => Promise<{ ok: true }>;
  erpListSalesPoints: () => Promise<
    | { ok: true; points: ErpSalesPoint[] }
    | { ok: false; error: string }
  >;
  erpDashboardUrl: (
    salesPointId: string
  ) => Promise<{ ok: true; url: string } | { ok: false; error: string }>;
  launchFleetTool: (input: {
    tool: "module_test" | "sirup_test" | "flash_sirup" | "flash_obraz";
    seriesLabel?: string;
  }) => Promise<
    | { ok: true; path: string; pid?: number }
    | { ok: false; error: string }
  >;
  openFleetToolFolder: (
    tool: "module_test" | "sirup_test" | "flash_sirup" | "flash_obraz"
  ) => Promise<
    { ok: true; path: string } | { ok: false; error: string; path: string }
  >;
  sessionGet: () => Promise<ComplexSessionSnapshot>;
  sessionConnect: (input: {
    mode: "remote" | "local";
    seriesLabel?: string;
  }) => Promise<ComplexSessionSnapshot>;
  sessionDisconnect: () => Promise<ComplexSessionSnapshot>;
  sessionHeartbeat: () => Promise<ComplexSessionSnapshot>;
  sessionRefreshNetwork: () => Promise<ComplexSessionSnapshot>;
  onSessionState: (cb: (snap: ComplexSessionSnapshot) => void) => () => void;
  onAppResumed: (
    cb: (payload: { at: string; connected?: boolean; error?: string }) => void
  ) => () => void;
  drinkxRead: (input: {
    role: "milk" | "coffee" | "water";
  }) => Promise<
    | {
        ok: true;
        role: "milk" | "coffee" | "water";
        path: string;
        text: string;
        label: string;
      }
    | { ok: false; error: string }
  >;
  drinkxWrite: (input: {
    role: "milk" | "coffee" | "water";
    text: string;
    unlocked: boolean;
    restart?: boolean;
  }) => Promise<
    | {
        ok: true;
        role: "milk" | "coffee" | "water";
        path: string;
        label: string;
        restarted?: boolean;
        restartDetail?: string;
      }
    | { ok: false; error: string }
  >;
  drinkxRestart: (input: {
    role: "milk" | "coffee" | "water";
  }) => Promise<
    | {
        ok: true;
        role: "milk" | "coffee" | "water";
        label: string;
        detail: string;
      }
    | { ok: false; error: string }
  >;
  natsInfo: () => Promise<NatsConnectionInfo>;
  natsConnect: (server?: string) => Promise<NatsConnectionInfo>;
  natsDisconnect: () => Promise<NatsConnectionInfo>;
  natsMuster: (
    timeoutMs?: number
  ) => Promise<
    | { ok: true; modules: NatsMusterEntry[] }
    | { ok: false; error: string }
  >;
  natsStatus: (
    filter?: Record<string, unknown>
  ) => Promise<{ ok: true; status: unknown } | { ok: false; error: string }>;
  natsRequest: (input: {
    subject: string;
    payload?: unknown;
    timeoutMs?: number;
    priority?: "command" | "poll";
  }) => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>;
  natsRequestMany: (input: {
    subject: string;
    payload?: unknown;
    timeoutMs?: number;
    priority?: "command" | "poll";
  }) => Promise<
    { ok: true; replies: unknown[] } | { ok: false; error: string }
  >;
  natsPublish: (input: {
    subject: string;
    payload?: unknown;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
  natsSubscribeStatus: () => Promise<
    { ok: true } | { ok: false; error: string }
  >;
  natsSubscribeBus: (
    subjects: string[],
    clientId?: string
  ) => Promise<
    { ok: true; subjects: string[] } | { ok: false; error: string }
  >;
  natsUnsubscribeBus: (
    clientId?: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  natsUpdateConfig: (
    patch: Record<string, unknown>
  ) => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>;
  onNatsState: (cb: (info: NatsConnectionInfo) => void) => () => void;
  onNatsStatus: (cb: (payload: unknown) => void) => () => void;
  onNatsBus: (
    cb: (msg: { subject: string; data: unknown }) => void
  ) => () => void;
  syrupCheckSsh: () => Promise<
    { ok: true; message: string } | { ok: false; error: string }
  >;
  /** SSH systemctl/lsusb на complexos (ft-*-drv + USB 2912/0e8d/3513). */
  posProbeHost: () => Promise<
    | {
        ok: true;
        probe: {
          printerUnit: string;
          paymentsUnit: string;
          usb: { atol: boolean; kozen: boolean; niimbot: boolean };
          level: "ok" | "warn" | "error";
          lines: string[];
        };
      }
    | { ok: false; error: string }
  >;
  /** Бортовой lab-logger на complexos (install / status / view / download). */
  labLoggerStatus: () => Promise<
    | { ok: true; status: import("@service-monitor/core").LabLoggerStatus }
    | { ok: false; error: string }
  >;
  labLoggerInstall: (input?: {
    retainHours?: number;
    enableAutostart?: boolean;
  }) => Promise<
    | { ok: true; sha256: string; fileCount: number; message: string }
    | { ok: false; error: string }
  >;
  labLoggerUninstall: (input?: {
    wipeData?: boolean;
  }) => Promise<{ ok: true; message: string } | { ok: false; error: string }>;
  labLoggerSetAutostart: (input: {
    enabled: boolean;
  }) => Promise<{ ok: true; message: string } | { ok: false; error: string }>;
  labLoggerSetRetention: (input: {
    retainHours: number;
  }) => Promise<{ ok: true; message: string } | { ok: false; error: string }>;
  labLoggerFetchHealth: () => Promise<
    | { ok: true; health: import("@service-monitor/core").LabLoggerHealth }
    | { ok: false; error: string }
  >;
  labLoggerFetchSnapshot: () => Promise<
    { ok: true; snapshot: unknown } | { ok: false; error: string }
  >;
  labLoggerFetchEvents: (input?: {
    fromTs?: number;
  }) => Promise<
    { ok: true; events: unknown[] } | { ok: false; error: string }
  >;
  labLoggerDownloadRing: () => Promise<
    | { ok: true; path: string; bytes: number }
    | { ok: false; error: string }
  >;
  syrupModbusScan: (input: {
    mode: "scan" | "motor";
    maxId?: number;
    baud?: number;
    id?: number;
    seconds?: number;
    intensity?: number;
    singleMode?: boolean;
  }) => Promise<
    { ok: true; output: string } | { ok: false; error: string }
  >;
  flashPartA: (config: {
    currentId: number | string;
    newId: number | string;
    currentBaud: number | string;
    newBaud: number | string;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
  flashPartB: (config: {
    newId: number | string;
    newBaud: number | string;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
  onFlashLog: (
    cb: (entry: { level: "log" | "error"; message: string }) => void
  ) => () => void;
  /** DX UI :8000 — pump_R/L_IS (В) + PWM тэнов из pid graph. */
  dxUiPumpCurrents: (input?: {
    mode?: "remote" | "local" | null;
    timeoutMs?: number;
  }) => Promise<
    | {
        ok: true;
        milk: {
          pump_R_IS: number | null;
          pump_L_IS: number | null;
          heater1_pwm: number | null;
          heater2_pwm: number | null;
          error?: string;
          via?: "http" | "ssh";
        };
        coffee: {
          pump_R_IS: number | null;
          pump_L_IS: number | null;
          heater1_pwm: number | null;
          heater2_pwm: number | null;
          error?: string;
          via?: "http" | "ssh";
        };
        water: {
          pump_R_IS: number | null;
          pump_L_IS: number | null;
          heater1_pwm: number | null;
          heater2_pwm: number | null;
          error?: string;
          via?: "http" | "ssh";
        };
      }
    | {
        ok: false;
        error: string;
        milk: {
          pump_R_IS: number | null;
          pump_L_IS: number | null;
          heater1_pwm: number | null;
          heater2_pwm: number | null;
        };
        coffee: {
          pump_R_IS: number | null;
          pump_L_IS: number | null;
          heater1_pwm: number | null;
          heater2_pwm: number | null;
        };
        water: {
          pump_R_IS: number | null;
          pump_L_IS: number | null;
          heater1_pwm: number | null;
          heater2_pwm: number | null;
        };
      }
  >;
  openLabChartWindow: (input?: {
    focusSensor?: string | null;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
  syncLabChartState: (payload: unknown) => Promise<{ ok: true }>;
  pullLabChartState: () => Promise<unknown>;
  labChartIsOpen: () => Promise<{ open: boolean }>;
  closeLabChartWindow: () => Promise<{ ok: true }>;
  labChartToggleFullScreen: () => Promise<
    { ok: true; fullScreen: boolean } | { ok: false }
  >;
  onLabChartState: (cb: (payload: unknown) => void) => () => void;
  onLabChartFocus: (
    cb: (payload: { focusSensor?: string | null }) => void
  ) => () => void;
  onLabChartClosed: (cb: () => void) => () => void;
};

const api: DesktopApi = {
  getPaths: () => ipcRenderer.invoke("app:getPaths"),
  setDebugEnabled: (enabled) => ipcRenderer.invoke("debug:setEnabled", enabled),
  exportDebugLog: () => ipcRenderer.invoke("debug:export"),
  log: (level, scope, message, data) =>
    ipcRenderer.invoke("debug:log", { level, scope, message, data }),
  readPubkey: () => ipcRenderer.invoke("ssh:readPubkey"),
  generateKey: () => ipcRenderer.invoke("ssh:generateKey"),
  renderSnippet: (input) => ipcRenderer.invoke("ssh:renderSnippet", input),
  applyConfig: (input) => ipcRenderer.invoke("ssh:applyConfig", input),
  openSshConfig: () => ipcRenderer.invoke("ssh:openConfig"),
  openExternal: (url) => ipcRenderer.invoke("shell:openExternal", url),
  hashServicePassword: (password) =>
    ipcRenderer.invoke("profiles:hashServicePassword", password),
  verifyServicePassword: (password) =>
    ipcRenderer.invoke("profiles:verifyServicePassword", password),
  verifyCashDevPassword: (password) =>
    ipcRenderer.invoke("profiles:verifyCashDevPassword", password),
  erpGetSession: () => ipcRenderer.invoke("erp:getSession"),
  erpLogin: (input) => ipcRenderer.invoke("erp:login", input),
  erpLogout: () => ipcRenderer.invoke("erp:logout"),
  erpListSalesPoints: () => ipcRenderer.invoke("erp:listSalesPoints"),
  erpDashboardUrl: (salesPointId) =>
    ipcRenderer.invoke("erp:dashboardUrl", salesPointId),
  launchFleetTool: (input) => ipcRenderer.invoke("fleet:launchTool", input),
  openFleetToolFolder: (tool) =>
    ipcRenderer.invoke("fleet:openToolFolder", tool),
  sessionGet: () => ipcRenderer.invoke("session:get"),
  sessionConnect: (input) => ipcRenderer.invoke("session:connect", input),
  sessionDisconnect: () => ipcRenderer.invoke("session:disconnect"),
  sessionHeartbeat: () => ipcRenderer.invoke("session:heartbeat"),
  sessionRefreshNetwork: () => ipcRenderer.invoke("session:refreshNetwork"),
  onSessionState: (cb) => {
    const handler = (_e: IpcRendererEvent, snap: ComplexSessionSnapshot) =>
      cb(snap);
    ipcRenderer.on("session:state", handler);
    return () => ipcRenderer.removeListener("session:state", handler);
  },
  onAppResumed: (cb) => {
    const handler = (
      _e: IpcRendererEvent,
      payload: { at: string; connected?: boolean; error?: string }
    ) => cb(payload);
    ipcRenderer.on("app:resumed", handler);
    return () => ipcRenderer.removeListener("app:resumed", handler);
  },
  drinkxRead: (input) => ipcRenderer.invoke("drinkx:read", input),
  drinkxWrite: (input) => ipcRenderer.invoke("drinkx:write", input),
  drinkxRestart: (input) => ipcRenderer.invoke("drinkx:restart", input),
  natsInfo: () => ipcRenderer.invoke("nats:info"),
  natsConnect: (server) => ipcRenderer.invoke("nats:connect", server),
  natsDisconnect: () => ipcRenderer.invoke("nats:disconnect"),
  natsMuster: (timeoutMs) => ipcRenderer.invoke("nats:muster", timeoutMs),
  natsStatus: (filter) => ipcRenderer.invoke("nats:status", filter),
  natsRequest: (input) => ipcRenderer.invoke("nats:request", input),
  natsRequestMany: (input) => ipcRenderer.invoke("nats:requestMany", input),
  natsPublish: (input) => ipcRenderer.invoke("nats:publish", input),
  natsSubscribeStatus: () => ipcRenderer.invoke("nats:subscribeStatus"),
  natsSubscribeBus: (subjects, clientId) =>
    ipcRenderer.invoke("nats:subscribeBus", subjects, clientId),
  natsUnsubscribeBus: (clientId) =>
    ipcRenderer.invoke("nats:unsubscribeBus", clientId),
  natsUpdateConfig: (patch) => ipcRenderer.invoke("nats:updateConfig", patch),
  onNatsState: (cb) => {
    const handler = (_e: IpcRendererEvent, info: NatsConnectionInfo) =>
      cb(info);
    ipcRenderer.on("nats:state", handler);
    return () => ipcRenderer.removeListener("nats:state", handler);
  },
  onNatsStatus: (cb) => {
    const handler = (_e: IpcRendererEvent, payload: unknown) => cb(payload);
    ipcRenderer.on("nats:status", handler);
    return () => ipcRenderer.removeListener("nats:status", handler);
  },
  onNatsBus: (cb) => {
    const handler = (
      _e: IpcRendererEvent,
      msg: { subject: string; data: unknown }
    ) => cb(msg);
    ipcRenderer.on("nats:bus", handler);
    return () => ipcRenderer.removeListener("nats:bus", handler);
  },
  syrupCheckSsh: () => ipcRenderer.invoke("syrup:checkSsh"),
  posProbeHost: () => ipcRenderer.invoke("pos:probeHost"),
  labLoggerStatus: () => ipcRenderer.invoke("labLogger:status"),
  labLoggerInstall: (input) => ipcRenderer.invoke("labLogger:install", input),
  labLoggerUninstall: (input) =>
    ipcRenderer.invoke("labLogger:uninstall", input),
  labLoggerSetAutostart: (input) =>
    ipcRenderer.invoke("labLogger:setAutostart", input),
  labLoggerSetRetention: (input) =>
    ipcRenderer.invoke("labLogger:setRetention", input),
  labLoggerFetchHealth: () => ipcRenderer.invoke("labLogger:fetchHealth"),
  labLoggerFetchSnapshot: () => ipcRenderer.invoke("labLogger:fetchSnapshot"),
  labLoggerFetchEvents: (input) =>
    ipcRenderer.invoke("labLogger:fetchEvents", input),
  labLoggerDownloadRing: () => ipcRenderer.invoke("labLogger:downloadRing"),
  syrupModbusScan: (input) => ipcRenderer.invoke("syrup:modbusScan", input),
  flashPartA: (config) => ipcRenderer.invoke("flash:partA", config),
  flashPartB: (config) => ipcRenderer.invoke("flash:partB", config),
  onFlashLog: (cb) => {
    const handler = (
      _e: IpcRendererEvent,
      entry: { level: "log" | "error"; message: string }
    ) => cb(entry);
    ipcRenderer.on("flash:log", handler);
    return () => ipcRenderer.removeListener("flash:log", handler);
  },
  dxUiPumpCurrents: (input) => ipcRenderer.invoke("dxUi:pumpCurrents", input),
  openLabChartWindow: (input) => ipcRenderer.invoke("labChart:open", input ?? {}),
  syncLabChartState: (payload) => ipcRenderer.invoke("labChart:sync", payload),
  pullLabChartState: () => ipcRenderer.invoke("labChart:pull"),
  labChartIsOpen: () => ipcRenderer.invoke("labChart:isOpen"),
  closeLabChartWindow: () => ipcRenderer.invoke("labChart:close"),
  labChartToggleFullScreen: () =>
    ipcRenderer.invoke("labChart:toggleFullScreen"),
  onLabChartState: (cb) => {
    const handler = (_e: IpcRendererEvent, payload: unknown) => cb(payload);
    ipcRenderer.on("labChart:state", handler);
    return () => ipcRenderer.removeListener("labChart:state", handler);
  },
  onLabChartFocus: (cb) => {
    const handler = (
      _e: IpcRendererEvent,
      payload: { focusSensor?: string | null }
    ) => cb(payload);
    ipcRenderer.on("labChart:focus", handler);
    return () => ipcRenderer.removeListener("labChart:focus", handler);
  },
  onLabChartClosed: (cb) => {
    const handler = () => cb();
    ipcRenderer.on("labChart:closed", handler);
    return () => ipcRenderer.removeListener("labChart:closed", handler);
  },
};

contextBridge.exposeInMainWorld("desktop", api);
