/**
 * Electron main process.
 * Отвечает за окно, debug-логи на диск, SSH config apply, ключи.
 */

import { app, BrowserWindow, ipcMain, shell, powerMonitor } from "electron";
import { join } from "path";
import { mkdir, readFile, writeFile, copyFile, access } from "fs/promises";
import { existsSync } from "fs";
import { homedir } from "os";
import { spawn, spawnSync } from "child_process";
import {
  DebugLogger,
  FibbeeAuthError,
  FibbeeClient,
  mergeSshConfig,
  profileFromSeriesLabel,
  renderSshSnippet,
  type ComplexSessionSnapshot,
  type ErpSalesPoint,
} from "@service-monitor/core";
import { verifyServicePassword } from "@service-monitor/core/security/password";
import { sshSessionManager } from "./ssh-session-manager";
import {
  readDrinkxJson,
  restartCmDrv,
  writeDrinkxJson,
} from "./drinkx-config";
import {
  getNatsInfo,
  natsConnect,
  natsDisconnect,
  natsMuster,
  natsPublish,
  natsRequest,
  natsRequestMany,
  natsStatus,
  natsSubscribeStatus,
  natsUpdateConfig,
} from "./nats-service";
import { syrupCheckSsh, syrupModbusScan } from "./syrup-service";
import { flashPartA, flashPartB } from "./flash-service";
import {
  clearSessionPrefs,
  loadSessionPrefs,
  saveSessionPrefs,
} from "./session-prefs";

const logger = new DebugLogger({ enabled: false });
const erpClient = new FibbeeClient();

let mainWindow: BrowserWindow | null = null;
let resumeBusy = false;

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

function broadcastSession(snap: ComplexSessionSnapshot): void {
  broadcast("session:state", snap);
}

function userDataPath(...parts: string[]): string {
  return join(app.getPath("userData"), ...parts);
}

function defaultIdentityPath(): string {
  return join(homedir(), ".ssh", "id_ed25519");
}

function defaultPubkeyPath(): string {
  return join(homedir(), ".ssh", "id_ed25519.pub");
}

function sshConfigPath(): string {
  return join(homedir(), ".ssh", "config");
}

function erpSessionPath(): string {
  return userDataPath("erp-session.json");
}

/** Корень fleet-foundry с module_test / sirup_test. */
function fleetFoundryRoot(): string {
  const candidates = [
    join("C:", "myApp", "complex soft", "fleet-foundry"),
    join("C:", "complex soft", "fleet-foundry"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0];
}

type FleetToolId =
  | "module_test"
  | "sirup_test"
  | "flash_sirup"
  | "flash_obraz";

function fleetToolPath(tool: FleetToolId): string {
  return join(fleetFoundryRoot(), tool);
}

async function loadErpSession(): Promise<{
  email: string;
  token: string;
} | null> {
  try {
    const raw = await readFile(erpSessionPath(), "utf8");
    const data = JSON.parse(raw) as { email?: string; token?: string };
    if (data.email && data.token) {
      erpClient.setToken(data.token);
      return { email: data.email, token: data.token };
    }
  } catch {
    // нет файла — ок
  }
  return null;
}

async function saveErpSession(email: string, token: string): Promise<void> {
  await mkdir(userDataPath(), { recursive: true });
  await writeFile(
    erpSessionPath(),
    JSON.stringify({ email, token, savedAt: new Date().toISOString() }),
    "utf8"
  );
}

async function clearErpSession(): Promise<void> {
  erpClient.setToken(null);
  try {
    await writeFile(erpSessionPath(), "{}", "utf8");
  } catch {
    // ignore
  }
}

async function ensureDebugSink(enabled: boolean): Promise<void> {
  logger.setEnabled(enabled);
  if (!enabled) {
    logger.setSink(null);
    return;
  }
  const dir = userDataPath("debug-logs");
  await mkdir(dir, { recursive: true });
  const file = join(
    dir,
    `session-${new Date().toISOString().replace(/[:.]/g, "-")}.log`
  );
  logger.setSink({
    append: async (line) => {
      await writeFile(file, line, { flag: "a", encoding: "utf8" });
    },
  });
  logger.info("main", "Debug log file ready", { file });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#0f1419",
    title: "Service Monitor",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
}

function registerIpc(): void {
  ipcMain.handle("app:getPaths", () => ({
    userData: app.getPath("userData"),
    debugLogs: userDataPath("debug-logs"),
    identityFile: defaultIdentityPath(),
    pubkeyFile: defaultPubkeyPath(),
    sshConfig: sshConfigPath(),
  }));

  ipcMain.handle("debug:setEnabled", async (_e, enabled: boolean) => {
    await ensureDebugSink(Boolean(enabled));
    return { enabled: logger.isEnabled() };
  });

  ipcMain.handle("debug:export", () => logger.exportText());

  ipcMain.handle(
    "debug:log",
    (_e, payload: { level: string; scope: string; message: string; data?: unknown }) => {
      const { level, scope, message, data } = payload;
      if (level === "error") logger.error(scope, message, data);
      else if (level === "warn") logger.warn(scope, message, data);
      else if (level === "debug") logger.debug(scope, message, data);
      else logger.info(scope, message, data);
    }
  );

  ipcMain.handle("ssh:readPubkey", async () => {
    try {
      await access(defaultPubkeyPath());
      const text = await readFile(defaultPubkeyPath(), "utf8");
      return { ok: true as const, pubkey: text.trim(), path: defaultPubkeyPath() };
    } catch {
      return { ok: false as const, error: "Pubkey not found", path: defaultPubkeyPath() };
    }
  });

  /**
   * Генерация ed25519: предпочитаем ssh-keygen, fallback — crypto OpenSSH-ish через ssh-keygen only.
   * Без ssh-keygen создаём сырую пару и просим пользователя использовать OpenSSH.
   */
  ipcMain.handle("ssh:generateKey", async () => {
    const priv = defaultIdentityPath();
    const pub = defaultPubkeyPath();
    await mkdir(join(homedir(), ".ssh"), { recursive: true });

    const existing = await access(priv).then(() => true).catch(() => false);
    if (existing) {
      logger.warn("ssh", "Key already exists, refuse overwrite", { priv });
      return {
        ok: false as const,
        error: "Ключ уже существует — удалите вручную или используйте текущий pubkey",
        path: pub,
      };
    }

    const gen = spawnSync(
      "ssh-keygen",
      ["-t", "ed25519", "-f", priv, "-N", "", "-C", "service-monitor"],
      { encoding: "utf8" }
    );

    if (gen.status === 0) {
      const pubkey = (await readFile(pub, "utf8")).trim();
      logger.info("ssh", "Key generated via ssh-keygen");
      return { ok: true as const, pubkey, path: pub };
    }

    // Fallback: только сообщить — OpenSSH формат руками не собираем (безопасность/совместимость).
    logger.error("ssh", "ssh-keygen failed", { stderr: gen.stderr });
    return {
      ok: false as const,
      error: `ssh-keygen недоступен: ${gen.stderr || gen.error?.message || "unknown"}`,
      path: pub,
    };
  });

  ipcMain.handle(
    "ssh:renderSnippet",
    (
      _e,
      input: { seriesLabel: string; name?: string; includeJumpHost?: boolean }
    ) => {
      const profile = profileFromSeriesLabel(input.seriesLabel, input.name);
      // По умолчанию только блок комплекса — jump не дублируем.
      const snippet = renderSshSnippet({
        profile,
        identityFile: defaultIdentityPath(),
        includeJumpHost: input.includeJumpHost === true,
      });
      logger.info("ssh", "Snippet rendered", {
        port: profile.sshPort,
        withJump: input.includeJumpHost === true,
      });
      return { profile, snippet };
    }
  );

  ipcMain.handle(
    "ssh:applyConfig",
    async (_e, input: { seriesLabel: string; name?: string }) => {
      const profile = profileFromSeriesLabel(input.seriesLabel, input.name);
      const path = sshConfigPath();
      await mkdir(join(homedir(), ".ssh"), { recursive: true });

      let existing = "";
      try {
        existing = await readFile(path, "utf8");
      } catch {
        existing = "";
      }

      if (existing) {
        const bak = `${path}.bak-${Date.now()}`;
        await copyFile(path, bak);
        logger.info("ssh", "Backup ssh config", { bak });
      }

      // Jump добавляется только если его ещё нет; иначе — только Host комплекса.
      const merged = mergeSshConfig(existing, {
        profile,
        identityFile: defaultIdentityPath(),
      });
      await writeFile(path, merged.config, "utf8");
      logger.info("ssh", "Applied ssh config", {
        port: profile.sshPort,
        jumpHostAdded: merged.jumpHostAdded,
        hadJumpHost: merged.hadJumpHost,
      });
      console.log(
        "[ssh] apply",
        profile.sshPort,
        "jumpAdded=",
        merged.jumpHostAdded,
        "hadJump=",
        merged.hadJumpHost
      );
      return {
        ok: true as const,
        path,
        profile,
        jumpHostAdded: merged.jumpHostAdded,
        hadJumpHost: merged.hadJumpHost,
      };
    }
  );

  ipcMain.handle("ssh:openConfig", async () => {
    const path = sshConfigPath();
    await mkdir(join(homedir(), ".ssh"), { recursive: true });
    try {
      await access(path);
    } catch {
      // Создаём минимальный файл, чтобы редактор открылся.
      await writeFile(
        path,
        "# Service Monitor — SSH config\n# Добавьте Host erp.fibbee.com (User tun) и блоки комплексов.\n",
        "utf8"
      );
    }
    const err = await shell.openPath(path);
    if (err) {
      logger.error("ssh", "openConfig failed", { err, path });
      return { ok: false as const, error: err, path };
    }
    logger.info("ssh", "Opened ssh config", { path });
    console.log("[ssh] openConfig", path);
    return { ok: true as const, path };
  });

  ipcMain.handle("shell:openExternal", async (_e, url: string) => {
    // localhost через SSH-туннель; 192.168.1.x в Local LAN; ERP dashboard
    const localOk =
      /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|\?|$)/i.test(url);
    const lanOk =
      /^https?:\/\/192\.168\.1\.\d{1,3}(:\d+)?(\/|\?|$)/i.test(url);
    const erpOk = /^https?:\/\/erp\.fibbee\.com(\/|\?|$)/i.test(url);
    if (!localOk && !lanOk && !erpOk) {
      logger.warn("shell", "Blocked external open", { url });
      console.warn("[shell] blocked url", url);
      return { ok: false as const, error: "URL not allowed" };
    }
    console.log("[shell] openExternal", url);
    await shell.openExternal(url);
    return { ok: true as const };
  });

  ipcMain.handle("profiles:verifyServicePassword", (_e, password: string) => {
    const ok = verifyServicePassword(String(password ?? ""));
    if (!ok) {
      logger.warn("security", "Service password rejected");
      console.warn("[security] service password rejected");
    } else {
      logger.info("security", "Service password accepted");
      console.log("[security] service password ok");
    }
    return { ok };
  });

  // ---- Stage 3: общая SSH-сессия комплекса ---------------------------------

  ipcMain.handle("session:get", () => sshSessionManager.getSnapshot());

  ipcMain.handle(
    "session:connect",
    async (
      _e,
      input: { mode?: "remote" | "local"; seriesLabel?: string }
    ) => {
      const mode = input.mode === "local" ? "local" : "remote";
      logger.info("session", "Connect requested", {
        mode,
        series: input.seriesLabel,
      });
      console.log("[session] connect", mode, input.seriesLabel);
      const snap = await sshSessionManager.connect({
        mode,
        seriesLabel: input.seriesLabel,
        identityFile: defaultIdentityPath(),
      });
      if (snap.connected) {
        await saveSessionPrefs({
          mode,
          seriesLabel: input.seriesLabel,
        });
      }
      logger.info("session", "Connect result", {
        connected: snap.connected,
        mode: snap.mode,
        message: snap.message,
      });
      console.log("[session] result", snap.connected, snap.mode, snap.message);
      broadcastSession(snap);
      return snap;
    }
  );

  ipcMain.handle("session:disconnect", async () => {
    logger.info("session", "Disconnect");
    console.log("[session] disconnect");
    await natsDisconnect();
    await clearSessionPrefs();
    const snap = await sshSessionManager.disconnect();
    broadcastSession(snap);
    return snap;
  });

  ipcMain.handle("session:heartbeat", async () => {
    return sshSessionManager.heartbeat();
  });

  ipcMain.handle("session:refreshNetwork", async () => {
    return sshSessionManager.refreshNetwork();
  });

  ipcMain.handle(
    "drinkx:read",
    async (_e, input: { role: "milk" | "coffee" | "water" }) => {
      return readDrinkxJson(input.role);
    }
  );

  ipcMain.handle(
    "drinkx:write",
    async (
      _e,
      input: {
        role: "milk" | "coffee" | "water";
        text: string;
        unlocked: boolean;
        restart?: boolean;
      }
    ) => {
      return writeDrinkxJson(input);
    }
  );

  ipcMain.handle(
    "drinkx:restart",
    async (_e, input: { role: "milk" | "coffee" | "water" }) => {
      return restartCmDrv(input.role);
    }
  );

  // ---- Stage 5: встроенный NATS + сироп через dozator -----------------------

  ipcMain.handle("nats:info", () => getNatsInfo());
  ipcMain.handle("nats:connect", async (_e, server?: string) => {
    logger.info("nats", "Connect", { server });
    return natsConnect(typeof server === "string" ? server : undefined);
  });
  ipcMain.handle("nats:disconnect", async () => natsDisconnect());
  ipcMain.handle("nats:muster", async (_e, timeoutMs?: number) => {
    try {
      const modules = await natsMuster(
        typeof timeoutMs === "number" ? timeoutMs : 900
      );
      return { ok: true as const, modules };
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  });
  ipcMain.handle(
    "nats:status",
    async (_e, filter?: Record<string, unknown>) => {
      try {
        const status = await natsStatus(filter ?? {});
        return { ok: true as const, status };
      } catch (e) {
        return {
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }
  );
  ipcMain.handle(
    "nats:request",
    async (
      _e,
      input: {
        subject: string;
        payload?: unknown;
        timeoutMs?: number;
        priority?: "command" | "poll";
      }
    ) => {
      try {
        const data = await natsRequest(
          input.subject,
          input.payload ?? {},
          input.timeoutMs ?? 5_000,
          input.priority ?? "command"
        );
        return { ok: true as const, data };
      } catch (e) {
        return {
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }
  );
  ipcMain.handle(
    "nats:requestMany",
    async (
      _e,
      input: {
        subject: string;
        payload?: unknown;
        timeoutMs?: number;
        priority?: "command" | "poll";
      }
    ) => {
      try {
        const replies = await natsRequestMany(
          input.subject,
          input.payload ?? {},
          input.timeoutMs ?? 900,
          input.priority ?? "poll"
        );
        return { ok: true as const, replies };
      } catch (e) {
        return {
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }
  );
  ipcMain.handle(
    "nats:publish",
    async (_e, input: { subject: string; payload?: unknown }) => {
      try {
        await natsPublish(input.subject, input.payload ?? {});
        return { ok: true as const };
      } catch (e) {
        return {
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }
  );
  ipcMain.handle("nats:subscribeStatus", async () => {
    try {
      await natsSubscribeStatus();
      return { ok: true as const };
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  });
  ipcMain.handle(
    "nats:updateConfig",
    async (_e, patch: Record<string, unknown>) => {
      try {
        const data = await natsUpdateConfig(patch);
        return { ok: true as const, data };
      } catch (e) {
        return {
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }
  );

  ipcMain.handle("syrup:checkSsh", async () => syrupCheckSsh());
  ipcMain.handle(
    "syrup:modbusScan",
    async (
      _e,
      input: {
        mode: "scan" | "motor";
        maxId?: number;
        baud?: number;
        id?: number;
        seconds?: number;
        intensity?: number;
        singleMode?: boolean;
      }
    ) => syrupModbusScan(input)
  );

  ipcMain.handle(
    "flash:partA",
    async (
      _e,
      config: {
        currentId: number | string;
        newId: number | string;
        currentBaud: number | string;
        newBaud: number | string;
      }
    ) => {
      try {
        return await flashPartA(config);
      } catch (e) {
        return {
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }
  );
  ipcMain.handle(
    "flash:partB",
    async (
      _e,
      config: { newId: number | string; newBaud: number | string }
    ) => {
      try {
        return await flashPartB(config);
      } catch (e) {
        return {
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }
  );

  // ---- Модули / сироп (fleet-foundry fallback) ------------------------------

  ipcMain.handle(
    "fleet:launchTool",
    async (
      _e,
      input: { tool: FleetToolId; seriesLabel?: string }
    ) => {
      const tool = input.tool;
      const dir = fleetToolPath(tool);
      if (!existsSync(join(dir, "package.json"))) {
        const msg = `Не найден ${tool} в ${dir}`;
        logger.error("fleet", msg);
        console.error("[fleet]", msg);
        return { ok: false as const, error: msg };
      }

      const session = sshSessionManager.getSnapshot();
      // DrinkX module_test опирается на туннель вкладки Сессия (NATS :14222).
      if (tool === "module_test" && !session.connected) {
        const msg =
          "Сначала подключите сессию на вкладке «Сессия» — SSH для модулей общий";
        logger.warn("fleet", msg);
        return { ok: false as const, error: msg };
      }

      const series =
        input.seriesLabel || session.seriesLabel || "";

      console.log(
        "[fleet] launch",
        tool,
        "from",
        dir,
        "series=",
        series,
        "nats=",
        session.natsUrl
      );
      logger.info("fleet", "Launch tool", {
        tool,
        dir,
        series,
        nats: session.natsUrl,
      });

      // Windows: npm.cmd start в отдельном окне/процессе
      const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
      const child = spawn(npmCmd, ["start"], {
        cwd: dir,
        detached: true,
        stdio: "ignore",
        shell: process.platform === "win32",
        env: {
          ...process.env,
          SERVICE_MONITOR_SERIES: series,
          SERVICE_MONITOR_NATS_URL: session.natsUrl ?? "",
          // Подсказка module_test: не поднимать свой ssh — туннель уже есть
          SERVICE_MONITOR_SESSION: session.connected ? "1" : "0",
        },
      });
      child.unref();

      return { ok: true as const, path: dir, pid: child.pid };
    }
  );

  ipcMain.handle(
    "fleet:openToolFolder",
    async (_e, tool: FleetToolId) => {
      const dir = fleetToolPath(tool);
      if (!existsSync(dir)) {
        return {
          ok: false as const,
          error: `Папка не найдена: ${dir}`,
          path: dir,
        };
      }
      const err = await shell.openPath(dir);
      if (err) {
        return { ok: false as const, error: err, path: dir };
      }
      console.log("[fleet] open folder", dir);
      return { ok: true as const, path: dir };
    }
  );

  // ---- Stage 2: ERP cloud (fibbee) -----------------------------------------

  ipcMain.handle("erp:getSession", async () => {
    const session = await loadErpSession();
    if (!session) return { ok: false as const };
    return { ok: true as const, email: session.email };
  });

  ipcMain.handle(
    "erp:login",
    async (_e, input: { email: string; password: string }) => {
      const email = input.email?.trim();
      if (!email || !input.password) {
        return { ok: false as const, error: "Укажите email и пароль" };
      }
      try {
        console.log("[erp] login start", email);
        const session = await erpClient.login(email, input.password);
        await saveErpSession(session.email, session.token);
        logger.info("erp", "Login ok", { email, role: session.role });
        console.log("[erp] login ok", email, "role=", session.role);
        return {
          ok: true as const,
          email: session.email,
          role: session.role,
        };
      } catch (err) {
        const message =
          err instanceof FibbeeAuthError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err);
        logger.error("erp", "Login failed", { message });
        console.error("[erp] login failed", message);
        return { ok: false as const, error: message };
      }
    }
  );

  ipcMain.handle("erp:logout", async () => {
    await clearErpSession();
    logger.info("erp", "Logged out");
    console.log("[erp] logout");
    return { ok: true as const };
  });

  ipcMain.handle("erp:listSalesPoints", async () => {
    try {
      if (!erpClient.getToken()) {
        await loadErpSession();
      }
      if (!erpClient.getToken()) {
        return { ok: false as const, error: "Сначала войдите в ERP" };
      }
      console.log("[erp] listSalesPoints…");
      const points: ErpSalesPoint[] = await erpClient.listSalesPoints();
      console.log("[erp] listSalesPoints count=", points.length);
      logger.info("erp", "Sales points loaded", { count: points.length });
      return { ok: true as const, points };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err);
      logger.error("erp", "listSalesPoints failed", { message });
      console.error("[erp] listSalesPoints failed", message);
      return { ok: false as const, error: message };
    }
  });

  ipcMain.handle(
    "erp:dashboardUrl",
    async (_e, salesPointId: string) => {
      try {
        if (!erpClient.getToken()) await loadErpSession();
        const url = erpClient.buildDashboardUrl(salesPointId);
        return { ok: true as const, url };
      } catch (err) {
        return {
          ok: false as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
  );
}

app.whenReady().then(async () => {
  registerIpc();
  const restored = await loadErpSession();
  if (restored) {
    console.log("[erp] restored session for", restored.email);
  }
  createWindow();

  const recoverAfterSleep = async () => {
    if (resumeBusy) return;
    resumeBusy = true;
    console.log("[power] resume — восстанавливаем сессию");
    try {
      const prefs = await loadSessionPrefs();
      let snap = sshSessionManager.getSnapshot();
      const tunnelAlive =
        snap.mode === "local"
          ? snap.connected
          : sshSessionManager.isRemoteTunnelAlive();

      // Не рвём живой SSH: после сна сеть мигает — жёсткий reconnect только если процесс умер.
      if (!tunnelAlive && prefs?.mode) {
        await natsDisconnect();
        snap = await sshSessionManager.connect({
          mode: prefs.mode,
          seriesLabel: prefs.seriesLabel,
          identityFile: defaultIdentityPath(),
        });
        console.log(
          "[power] reconnect",
          snap.connected,
          snap.mode,
          snap.message
        );
      } else {
        snap = await sshSessionManager.heartbeat();
        console.log(
          "[power] soft recover",
          snap.connected,
          snap.natsOnline,
          snap.message
        );
        // TCP NATS после сна часто мёртвый — мягко переподключаем клиент.
        await natsDisconnect();
        if (snap.connected && snap.natsUrl) {
          try {
            await natsConnect(snap.natsUrl);
          } catch (e) {
            console.warn("[power] nats reconnect", e);
          }
        }
      }
      broadcastSession(snap);
      broadcast("app:resumed", {
        at: new Date().toISOString(),
        connected: snap.connected,
      });
    } catch (e) {
      console.warn("[power] resume recover failed", e);
      broadcast("app:resumed", {
        at: new Date().toISOString(),
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      resumeBusy = false;
    }
  };

  powerMonitor.on("resume", () => {
    // Сети/Wi‑Fi после крышки поднимаются с задержкой.
    setTimeout(() => void recoverAfterSleep(), 2500);
  });
  powerMonitor.on("unlock-screen", () => {
    setTimeout(() => void recoverAfterSleep(), 1500);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  void sshSessionManager.disconnect();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
