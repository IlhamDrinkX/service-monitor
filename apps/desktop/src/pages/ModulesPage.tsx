/**
 * Встроенный Industrial Service Control (без отдельного окна module_test).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DRINKX_HOSTS,
  FLOW_CALIBRATION_BREW_TIMEOUT_MS,
  FLOW_CALIBRATION_PULSES_POLL_MS,
  FLOW_CALIBRATION_QTYS,
  FLOW_CALIBRATION_SWITCH_DELAY_MS,
  HEATER_IDS,
  HEATER_AUTO_STOP_MS,
  HEATER_LABELS,
  HEATER_TARGET_C,
  MODULE_VALVES,
  NATS_SUBJECTS,
  TEMP_SENSOR_LABELS,
  VALVE_LABELS,
  defaultHwid,
  expectedTempKeys,
  extractEnabledState,
  extractTempMap,
  extractWaterTotalPulses,
  heaterCommandSubject,
  heaterStatusSubject,
  heaterStopSubject,
  milkSystemValveNumbers,
  pumpCommandSubject,
  pumpPowerToPwm,
  pumpStatusSubject,
  pumpStopSubject,
  valveCommandSubject,
  valveStatusSubject,
  type DrinkxHost,
  type NatsConnectionInfo,
  type NatsMusterEntry,
  type TempSensorKey,
} from "@service-monitor/core";
import { ActionButton } from "../components/ActionButton";
import { SyrupFlashPanel } from "../components/SyrupFlashPanel";
import { useComplexSession } from "../state/useComplexSession";

type EnabledMap = Record<string, boolean | null>;

type CalibRow = {
  qty: number;
  pulses?: number;
  actualMl?: number;
  flowFactor?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function ModulesPage() {
  const { session, warn } = useComplexSession();
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(
    null
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [nats, setNats] = useState<NatsConnectionInfo>({
    connected: false,
    server: null,
    message: "NATS не подключён",
  });
  const [host, setHost] = useState<DrinkxHost>("milk");
  const [hwid, setHwid] = useState(defaultHwid("milk"));
  const [modules, setModules] = useState<NatsMusterEntry[]>([]);
  const [valves, setValves] = useState<EnabledMap>({});
  const [pumpOn, setPumpOn] = useState<boolean | null>(null);
  const [heaters, setHeaters] = useState<EnabledMap>({});
  const [milkValves, setMilkValves] = useState<EnabledMap>({});
  const [temps, setTemps] = useState<Partial<Record<TempSensorKey, number>>>(
    {}
  );
  const [waterPulses, setWaterPulses] = useState<number | null>(null);
  const [pumpDuration, setPumpDuration] = useState(3000);
  const [pumpPower, setPumpPower] = useState(100);
  const [pumpWithHeaters, setPumpWithHeaters] = useState(true);
  const [heaterTarget, setHeaterTarget] = useState(HEATER_TARGET_C);
  const [heaterAutoStopSec, setHeaterAutoStopSec] = useState(
    HEATER_AUTO_STOP_MS / 1000
  );
  const [foamTemp, setFoamTemp] = useState(65);
  const [foamAir, setFoamAir] = useState(35);
  const [showLegacy, setShowLegacy] = useState(false);
  const [calibRows, setCalibRows] = useState<CalibRow[]>(
    FLOW_CALIBRATION_QTYS.map((qty) => ({ qty }))
  );
  const [calibLog, setCalibLog] = useState("");
  const [calibStatus, setCalibStatus] = useState("");
  const pollPaused = useRef(false);
  const pollGeneration = useRef(0);
  const autoNatsTried = useRef(false);
  const heaterTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );
  const commandLock = useRef(Promise.resolve());
  const hwidRef = useRef(hwid);
  hwidRef.current = hwid;

  const natsReady = session.connected && session.natsOnline;
  const live = nats.connected;
  const unlocked =
    typeof sessionStorage !== "undefined" &&
    sessionStorage.getItem("sm.writeUnlocked") === "1";

  useEffect(() => {
    void window.desktop.natsInfo().then(setNats).catch(() => undefined);
    return window.desktop.onNatsState(setNats);
  }, []);

  useEffect(() => {
    setHwid(defaultHwid(host));
    setValves({});
    setPumpOn(null);
    setHeaters({});
    setMilkValves({});
    setTemps({});
    setWaterPulses(null);
    setCalibRows(FLOW_CALIBRATION_QTYS.map((qty) => ({ qty })));
    setCalibLog("");
    setCalibStatus("");
  }, [host]);

  const withHwid = useCallback(
    (payload: Record<string, unknown> = {}) => ({
      hwid: hwidRef.current,
      ...payload,
    }),
    []
  );

  const req = useCallback(
    async (
      subject: string,
      payload: Record<string, unknown> = {},
      timeoutMs = 4000
    ) => {
      try {
        return await window.desktop.natsRequest({
          subject,
          payload: withHwid(payload),
          timeoutMs,
        });
      } catch (e) {
        return { ok: false as const, error: errText(e) };
      }
    },
    [withHwid]
  );

  const refreshDevices = useCallback(async () => {
    if (!live || pollPaused.current) return;
    const gen = pollGeneration.current;
    try {
      const valveIds = MODULE_VALVES[host];
      const valveResults = await Promise.all(
        valveIds.map(async (baseId) => {
          const res = await req(valveStatusSubject(host, baseId), {}, 1800);
          return [
            baseId,
            res.ok ? extractEnabledState(res.data) : null,
          ] as const;
        })
      );
      if (pollPaused.current || gen !== pollGeneration.current) return;
      setValves(Object.fromEntries(valveResults));

      const [pumpRes, ...heaterResults] = await Promise.all([
        req(pumpStatusSubject(host), {}, 1800),
        ...HEATER_IDS.map((hid) =>
          req(heaterStatusSubject(host, hid), {}, 1800).then(
            (res) =>
              [hid, res.ok ? extractEnabledState(res.data) : null] as const
          )
        ),
      ]);
      if (pollPaused.current || gen !== pollGeneration.current) return;
      setPumpOn(pumpRes.ok ? extractEnabledState(pumpRes.data) : null);
      setHeaters(Object.fromEntries(heaterResults));

      const statusRes = await req(NATS_SUBJECTS.status, {}, 3000);
      if (pollPaused.current || gen !== pollGeneration.current) return;
      if (statusRes.ok) {
        setTemps(extractTempMap(statusRes.data, host));
        if (host === "water") {
          setWaterPulses(extractWaterTotalPulses(statusRes.data, "water"));
        }
      }
    } catch (e) {
      console.warn("[modules] refresh", e);
    }
  }, [host, live, req]);

  useEffect(() => {
    if (!live) return;
    void refreshDevices();
    // Реже, чем раньше: иначе команды клапанов тонут в статусах.
    const id = setInterval(() => void refreshDevices(), 2500);
    return () => clearInterval(id);
  }, [live, host, hwid, refreshDevices]);

  async function withCommandLock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = commandLock.current;
    let release!: () => void;
    commandLock.current = new Promise<void>((r) => {
      release = r;
    });
    await prev.catch(() => undefined);
    pollPaused.current = true;
    pollGeneration.current += 1;
    try {
      return await fn();
    } finally {
      await sleep(350);
      pollPaused.current = false;
      release();
      void refreshDevices();
    }
  }

  async function ensureValve(
    baseId: string,
    enabled: boolean
  ): Promise<{ ok: boolean; error?: string }> {
    let lastError: string | undefined;
    for (let attempt = 0; attempt < 4; attempt++) {
      const cmd = await req(valveCommandSubject(host, baseId, enabled), {}, 3500);
      if (!cmd.ok) {
        lastError = cmd.error;
        await sleep(180);
        continue;
      }
      const st = await req(valveStatusSubject(host, baseId), {}, 2000);
      const got = st.ok ? extractEnabledState(st.data) : null;
      if (got === enabled) return { ok: true };
      await sleep(180);
    }
    return { ok: false, error: lastError || "состояние клапана не подтвердилось" };
  }

  async function connectNats() {
    if (!natsReady) {
      setToast({
        text: "Нужна сессия с NATS online (вкладка Сессия)",
        error: true,
      });
      return;
    }
    setBusy("nats");
    setToast(null);
    try {
      const info = await window.desktop.natsConnect();
      setNats(info);
      if (!info.connected) {
        setToast({ text: info.message, error: true });
        return;
      }
      try {
        await window.desktop.natsSubscribeStatus();
      } catch (e) {
        console.warn("[modules] subscribe", e);
      }
      try {
        const muster = await window.desktop.natsMuster(900);
        if (muster.ok) {
          setModules(muster.modules);
          const match = muster.modules.find(
            (m) =>
              m.hwid === defaultHwid(host) ||
              m.role === host ||
              (m.hwid ?? "").includes(host)
          );
          if (match?.hwid) setHwid(match.hwid);
        }
      } catch (e) {
        console.warn("[modules] muster", e);
      }
      setToast({ text: info.message });
    } catch (e) {
      setToast({ text: errText(e), error: true });
    } finally {
      setBusy(null);
    }
  }

  // Auto-connect NATS once when session is ready and client is offline.
  useEffect(() => {
    if (!natsReady || nats.connected || autoNatsTried.current) return;
    autoNatsTried.current = true;
    void connectNats();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot on session ready
  }, [natsReady, nats.connected]);

  useEffect(() => {
    if (!natsReady) autoNatsTried.current = false;
  }, [natsReady]);

  // После sleep/wake main шлёт app:resumed — переподключаем NATS.
  useEffect(() => {
    return window.desktop.onAppResumed((payload) => {
      autoNatsTried.current = false;
      if (payload.connected === false) {
        setNats({
          connected: false,
          server: null,
          message: "Сессия после сна не восстановлена",
        });
        return;
      }
      void (async () => {
        try {
          await window.desktop.natsDisconnect();
        } catch {
          // ignore
        }
        if (session.connected && session.natsOnline) {
          autoNatsTried.current = true;
          await connectNats();
        }
      })();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.connected, session.natsOnline]);

  async function disconnectNats() {
    setBusy("nats");
    try {
      for (const t of heaterTimers.current.values()) clearTimeout(t);
      heaterTimers.current.clear();
      const info = await window.desktop.natsDisconnect();
      setNats(info);
    } catch (e) {
      setToast({ text: errText(e), error: true });
    } finally {
      setBusy(null);
    }
  }

  async function resolveMuster() {
    setBusy("muster");
    try {
      const res = await window.desktop.natsMuster(900);
      if (!res.ok) {
        setToast({ text: res.error, error: true });
        return;
      }
      setModules(res.modules);
      const match = res.modules.find(
        (m) =>
          m.hwid === defaultHwid(host) ||
          m.role === host ||
          (m.hwid ?? "").includes(host)
      );
      if (match?.hwid) setHwid(match.hwid);
      setToast({
        text: res.modules.length
          ? `Модулей: ${res.modules.length}`
          : "Muster пуст — используем dx." + host,
        error: res.modules.length === 0,
      });
    } catch (e) {
      setToast({ text: errText(e), error: true });
    } finally {
      setBusy(null);
    }
  }

  async function toggleValve(baseId: string) {
    const next = !(valves[baseId] === true);
    setBusy(`valve-${baseId}`);
    // Оптимистично — чтобы кнопка не «залипала» на null во время verify.
    setValves((v) => ({ ...v, [baseId]: next }));
    try {
      await withCommandLock(async () => {
        const res = await ensureValve(baseId, next);
        if (!res.ok) {
          setToast({
            text: res.error || `Клапан ${baseId}: не подтверждён`,
            error: true,
          });
          const st = await req(valveStatusSubject(host, baseId), {}, 2000);
          setValves((v) => ({
            ...v,
            [baseId]: st.ok ? extractEnabledState(st.data) : null,
          }));
        }
      });
    } catch (e) {
      setToast({ text: errText(e), error: true });
    } finally {
      setBusy(null);
    }
  }

  async function setAllValves(enabled: boolean) {
    setBusy("valves-all");
    setValves((prev) => {
      const next = { ...prev };
      for (const id of MODULE_VALVES[host]) next[id] = enabled;
      return next;
    });
    try {
      await withCommandLock(async () => {
        for (const baseId of MODULE_VALVES[host]) {
          await ensureValve(baseId, enabled);
        }
      });
    } catch (e) {
      setToast({ text: errText(e), error: true });
    } finally {
      setBusy(null);
    }
  }

  async function startHeatersForPump() {
    const autoMs = Math.max(1, heaterAutoStopSec) * 1000;
    for (const hid of HEATER_IDS) {
      try {
        const prev = heaterTimers.current.get(hid);
        if (prev) clearTimeout(prev);
        const res = await req(heaterCommandSubject(host, hid), {
          target: heaterTarget,
        });
        if (res.ok) {
          setHeaters((h) => ({ ...h, [hid]: true }));
          const timer = setTimeout(() => {
            void stopHeater(hid);
          }, autoMs);
          heaterTimers.current.set(hid, timer);
        }
      } catch (e) {
        console.warn("[modules] heater with pump", hid, e);
      }
    }
  }

  async function startPump() {
    pollPaused.current = true;
    setBusy("pump");
    try {
      if (pumpWithHeaters) {
        await startHeatersForPump();
      }
      const res = await req(pumpCommandSubject(host), {
        duration: pumpDuration,
        power: pumpPowerToPwm(pumpPower),
      });
      if (!res.ok) {
        setToast({ text: res.error, error: true });
        pollPaused.current = false;
        return;
      }
      setPumpOn(true);
      setTimeout(() => {
        setPumpOn(false);
        pollPaused.current = false;
        void refreshDevices();
      }, pumpDuration + 200);
    } catch (e) {
      pollPaused.current = false;
      setToast({ text: errText(e), error: true });
    } finally {
      setBusy(null);
    }
  }

  async function stopPump() {
    pollPaused.current = true;
    setBusy("pump");
    try {
      await req(pumpStopSubject(host));
      setPumpOn(false);
    } catch (e) {
      setToast({ text: errText(e), error: true });
    } finally {
      setBusy(null);
      pollPaused.current = false;
    }
  }

  async function togglePump() {
    if (pumpOn) await stopPump();
    else await startPump();
  }

  async function startHeater(heaterId: string) {
    pollPaused.current = true;
    setBusy(`heater-${heaterId}`);
    try {
      const prev = heaterTimers.current.get(heaterId);
      if (prev) clearTimeout(prev);
      const res = await req(heaterCommandSubject(host, heaterId), {
        target: heaterTarget,
      });
      if (!res.ok) {
        setToast({ text: res.error, error: true });
        return;
      }
      setHeaters((h) => ({ ...h, [heaterId]: true }));
      const autoMs = Math.max(1, heaterAutoStopSec) * 1000;
      const timer = setTimeout(() => {
        void stopHeater(heaterId);
      }, autoMs);
      heaterTimers.current.set(heaterId, timer);
    } catch (e) {
      setToast({ text: errText(e), error: true });
    } finally {
      setBusy(null);
      pollPaused.current = false;
    }
  }

  async function stopHeater(heaterId: string) {
    const prev = heaterTimers.current.get(heaterId);
    if (prev) clearTimeout(prev);
    heaterTimers.current.delete(heaterId);
    pollPaused.current = true;
    try {
      await req(heaterStopSubject(host, heaterId));
      setHeaters((h) => ({ ...h, [heaterId]: false }));
    } catch (e) {
      console.warn("[modules] stop heater", e);
    } finally {
      pollPaused.current = false;
    }
  }

  async function toggleHeater(heaterId: string) {
    if (heaters[heaterId] === true) await stopHeater(heaterId);
    else await startHeater(heaterId);
  }

  async function toggleMilkValve(valveNumber: number) {
    const key = String(valveNumber);
    const next = !(milkValves[key] === true);
    setBusy(`milk-v-${valveNumber}`);
    setMilkValves((m) => ({ ...m, [key]: next }));
    try {
      await withCommandLock(async () => {
        const subject = next
          ? "coffeemachine.debug-valves-on"
          : "coffeemachine.debug-valves-off";
        const res = await req(subject, { nozzleId: 0, valves: [valveNumber] });
        if (!res.ok) {
          setToast({ text: res.error, error: true });
          setMilkValves((m) => ({ ...m, [key]: !next }));
        }
      });
    } catch (e) {
      setToast({ text: errText(e), error: true });
    } finally {
      setBusy(null);
    }
  }

  async function runFlush(kind: "milk" | "water") {
    const openValve =
      kind === "water"
        ? MODULE_VALVES[host].includes("waterInput")
          ? "waterInput"
          : "milkInput"
        : "milkInput";

    pollPaused.current = true;
    setBusy("flush");
    setToast(null);
    try {
      await req(valveCommandSubject(host, openValve, true));
      if (MODULE_VALVES[host].includes("drain")) {
        await req(valveCommandSubject(host, "drain", false));
      }
      const duration = 5000;
      await req(pumpCommandSubject(host), { duration });
      await sleep(duration);
      await req(valveCommandSubject(host, openValve, false));
      if (MODULE_VALVES[host].includes("drain")) {
        await req(valveCommandSubject(host, "drain", false));
      }
      setToast({ text: `Flush ${kind} · ${openValve} 5с` });
      void refreshDevices();
    } catch (e) {
      setToast({ text: errText(e), error: true });
    } finally {
      setBusy(null);
      pollPaused.current = false;
    }
  }

  async function foamCook() {
    if (host === "water") return;
    if (foamTemp < 20 || foamTemp > 95) {
      setToast({ text: "Температура 20…95 °C", error: true });
      return;
    }
    pollPaused.current = true;
    setBusy("foam");
    try {
      if (MODULE_VALVES[host].includes("drain")) {
        await req(valveCommandSubject(host, "drain", false));
      }
      if (MODULE_VALVES[host].includes("waterInput")) {
        await req(valveCommandSubject(host, "waterInput", false));
      }
      const res = await req(
        NATS_SUBJECTS.brew,
        {
          nozzleId: 0,
          coffeeRecipe: {
            parts: [
              {
                type: "milk",
                qty: 8000,
                temp: foamTemp,
                airPercent: foamAir,
                productionOrder: 1,
              },
            ],
            valves: [],
          },
        },
        90_000
      );
      if (!res.ok) {
        setToast({ text: res.error, error: true });
        return;
      }
      setToast({ text: "Пена: готово" });
    } catch (e) {
      setToast({ text: errText(e), error: true });
    } finally {
      setBusy(null);
      pollPaused.current = false;
    }
  }

  async function readWaterPulses(): Promise<number | null> {
    try {
      const statusRes = await req(NATS_SUBJECTS.status, {}, 4000);
      if (!statusRes.ok) return null;
      return extractWaterTotalPulses(statusRes.data, "water");
    } catch {
      return null;
    }
  }

  async function brewCalibrationVolume(qty: number): Promise<{
    pulsesDelta: number;
  }> {
    const startPulses = await readWaterPulses();
    if (startPulses == null) {
      throw new Error("Не удалось прочитать стартовое total pulses");
    }

    const brewPromise = req(
      NATS_SUBJECTS.brew,
      {
        nozzleId: 0,
        coffeeRecipe: {
          parts: [
            {
              type: "water",
              qty,
              temp: 20,
              productionOrder: 1,
            },
          ],
          valves: [],
        },
      },
      FLOW_CALIBRATION_BREW_TIMEOUT_MS
    );

    await sleep(FLOW_CALIBRATION_SWITCH_DELAY_MS);
    await req(valveCommandSubject("water", "dump", false));
    await req(valveCommandSubject("water", "drain", false));
    await req(valveCommandSubject("water", "milkInput", true));

    let brewFinished = false;
    let lastObserved = startPulses;
    let detectedReset = false;
    let maxAfterReset = Number.NaN;

    const watcher = (async () => {
      while (!brewFinished) {
        await sleep(FLOW_CALIBRATION_PULSES_POLL_MS);
        const cur = await readWaterPulses();
        if (cur == null) continue;
        if (!detectedReset && cur < lastObserved) {
          detectedReset = true;
          maxAfterReset = cur;
        } else if (detectedReset) {
          maxAfterReset = Number.isFinite(maxAfterReset)
            ? Math.max(maxAfterReset, cur)
            : cur;
        }
        lastObserved = cur;
      }
    })();

    try {
      const brewRes = await brewPromise;
      if (!brewRes.ok) {
        throw new Error(brewRes.error || `Пролив ${qty} мл ошибка`);
      }
    } finally {
      brewFinished = true;
      await watcher;
      try {
        await req(valveCommandSubject("water", "milkInput", false));
      } catch {
        // ignore
      }
    }

    const endPulses = await readWaterPulses();
    const pulsesDelta = detectedReset
      ? maxAfterReset
      : endPulses != null
        ? endPulses - startPulses
        : Number.NaN;

    if (!Number.isFinite(pulsesDelta) || pulsesDelta <= 0) {
      throw new Error(`Нет корректных pulses для шага ${qty} мл`);
    }
    return { pulsesDelta };
  }

  async function persistFlowFactor(flowFactor: number): Promise<string> {
    const normalized = Number(flowFactor.toFixed(6));
    const updateRes = await window.desktop.natsUpdateConfig(
      withHwid({ flowFactor: normalized })
    );
    if (!updateRes.ok) {
      throw new Error(updateRes.error || "update-config failed");
    }

    let persistNote = "runtime update-config OK";
    if (unlocked) {
      try {
        const read = await window.desktop.drinkxRead({ role: "water" });
        if (!read.ok) throw new Error(read.error);
        const obj = JSON.parse(read.text) as Record<string, unknown>;
        obj.flowFactor = normalized;
        const write = await window.desktop.drinkxWrite({
          role: "water",
          text: `${JSON.stringify(obj, null, 2)}\n`,
          unlocked: true,
          restart: false,
        });
        if (!write.ok) throw new Error(write.error);
        persistNote += ` · drinkx.json записан (${normalized})`;
      } catch (e) {
        persistNote += ` · drinkx.json: ${errText(e)}`;
      }
    } else {
      persistNote += " · drinkx.json пропущен (разблокируйте правки)";
    }
    return persistNote;
  }

  async function runFlowCalibration() {
    if (host !== "water") return;
    if (
      !window.confirm(
        "Проливы 100/200/300/400 мл. После каждого шага введите фактический объём. Продолжить?"
      )
    ) {
      setCalibStatus("Калибровка отменена");
      return;
    }

    pollPaused.current = true;
    setBusy("calib");
    const lines = [
      "Калибровка flowmeter · water",
      "flowFactor = total_pulses / фактический_объём_мл",
      "",
    ];
    const rows: CalibRow[] = FLOW_CALIBRATION_QTYS.map((qty) => ({ qty }));
    setCalibRows(rows);
    setCalibLog(lines.join("\n"));
    setCalibStatus("Идёт калибровка…");

    try {
      const factors: number[] = [];
      for (const qty of FLOW_CALIBRATION_QTYS) {
        lines.push(`Шаг ${qty} мл: пролив…`);
        setCalibLog(lines.join("\n"));
        const { pulsesDelta } = await brewCalibrationVolume(qty);
        const row = rows.find((r) => r.qty === qty)!;
        row.pulses = pulsesDelta;
        lines.push(`Шаг ${qty} мл: pulses = ${pulsesDelta}`);
        setCalibRows([...rows]);
        setCalibLog(lines.join("\n"));

        const answer = window.prompt(
          `Фактический объём для ${qty} мл (мл):`,
          String(qty)
        );
        if (answer == null) throw new Error("Остановлено пользователем");
        const actualMl = Number(String(answer).replace(",", "."));
        if (!Number.isFinite(actualMl) || actualMl <= 0) {
          throw new Error(`Некорректный объём для ${qty} мл`);
        }
        const stepFactor = pulsesDelta / actualMl;
        row.actualMl = actualMl;
        row.flowFactor = stepFactor;
        factors.push(stepFactor);
        lines.push(
          `Шаг ${qty} мл: факт = ${actualMl}, flowFactor = ${stepFactor.toFixed(6)}`,
          ""
        );
        setCalibRows([...rows]);
        setCalibLog(lines.join("\n"));
      }

      const avg = factors.reduce((a, b) => a + b, 0) / factors.length;
      lines.push(`Итоговый flowFactor = ${avg.toFixed(6)}`);
      lines.push("Сохраняю…");
      setCalibLog(lines.join("\n"));
      const note = await persistFlowFactor(avg);
      lines.push(note);
      setCalibLog(lines.join("\n"));
      setCalibStatus(`Готово · flowFactor ${avg.toFixed(6)}`);
      setToast({ text: `Калибровка OK · ${avg.toFixed(6)}` });
    } catch (e) {
      lines.push("", `Ошибка: ${errText(e)}`);
      setCalibLog(lines.join("\n"));
      setCalibStatus("Ошибка калибровки");
      setToast({ text: errText(e), error: true });
    } finally {
      setBusy(null);
      pollPaused.current = false;
      void refreshDevices();
    }
  }

  const tempKeys = expectedTempKeys(host);
  const controlsDisabled = !live || busy !== null;

  return (
    <div className="stack">
      <div className={`panel${warn ? " panel-warn" : ""}`}>
        <h2>Модули DrinkX</h2>
        <p className="lead">
          Управление клапанами / насосом / нагревателями прямо в приложении —
          отдельное окно <code>module_test</code> не нужно.
        </p>
        <div className="row">
          <span className={`badge${natsReady ? " on" : " danger"}`}>
            {natsReady
              ? `Сессия · ${session.natsUrl}`
              : "Сессия / NATS offline"}
          </span>
          <span className={`badge${live ? " on" : ""}`}>
            {live ? nats.message : "NATS клиент выкл"}
          </span>
        </div>
        {toast ? (
          <div className={`toast${toast.error ? " error" : ""}`}>
            {toast.text}
          </div>
        ) : null}
        <div className="row" style={{ marginTop: 12 }}>
          <ActionButton
            helpId="modules.nats"
            variant="primary"
            disabled={busy !== null || !natsReady || live}
            onClick={() => void connectNats()}
          >
            {busy === "nats" ? "…" : "Подключить NATS"}
          </ActionButton>
          <ActionButton
            disabled={busy !== null || !live}
            onClick={() => void disconnectNats()}
          >
            Отключить
          </ActionButton>
          <ActionButton
            disabled={controlsDisabled}
            onClick={() => void resolveMuster()}
          >
            Muster
          </ActionButton>
          <label className="muted">
            Модуль{" "}
            <select
              value={host}
              disabled={!live}
              onChange={(e) => setHost(e.target.value as DrinkxHost)}
            >
              {DRINKX_HOSTS.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </label>
          <label className="muted">
            hwid{" "}
            <select
              value={hwid}
              disabled={!live}
              onChange={(e) => setHwid(e.target.value)}
            >
              <option value={defaultHwid(host)}>{defaultHwid(host)}</option>
              {modules
                .filter((m) => m.hwid && m.hwid !== defaultHwid(host))
                .map((m) => (
                  <option key={m.hwid} value={m.hwid!}>
                    {m.hwid}
                    {m.role ? ` (${m.role})` : ""}
                  </option>
                ))}
            </select>
          </label>
        </div>
      </div>

      {host === "milk" ? (
        <div className="panel">
          <h2>Молочные клапана (debug)</h2>
          <div className="device-list">
            {milkSystemValveNumbers().map((v) => (
              <ToggleRow
                key={v.valveNumber}
                label={v.label}
                code={`valve${v.valveNumber}`}
                on={milkValves[String(v.valveNumber)] ?? null}
                disabled={controlsDisabled}
                onToggle={() => void toggleMilkValve(v.valveNumber)}
              />
            ))}
          </div>
        </div>
      ) : null}

      <div className="panel">
        <h2>Клапаны · {host}</h2>
        <div className="row" style={{ marginBottom: 10 }}>
          <ActionButton
            disabled={controlsDisabled}
            onClick={() => void setAllValves(true)}
          >
            Открыть все
          </ActionButton>
          <ActionButton
            disabled={controlsDisabled}
            onClick={() => void setAllValves(false)}
          >
            Закрыть все
          </ActionButton>
        </div>
        <div className="device-list">
          {MODULE_VALVES[host].map((baseId) => (
            <ToggleRow
              key={baseId}
              label={VALVE_LABELS[baseId] ?? baseId}
              code={baseId}
              on={valves[baseId] ?? null}
              disabled={controlsDisabled}
              onToggle={() => void toggleValve(baseId)}
            />
          ))}
        </div>
      </div>

      <div className="panel">
        <h2>Насос · {host}</h2>
        <div className="row" style={{ marginBottom: 10 }}>
          <label className="muted">
            ms{" "}
            <input
              type="number"
              value={pumpDuration}
              min={500}
              max={60000}
              step={500}
              disabled={!live}
              onChange={(e) => setPumpDuration(Number(e.target.value) || 3000)}
              style={{ width: 90 }}
            />
          </label>
          <label className="muted">
            power %{" "}
            <input
              type="number"
              value={pumpPower}
              min={0}
              max={100}
              disabled={!live}
              onChange={(e) => setPumpPower(Number(e.target.value) || 0)}
              style={{ width: 70 }}
            />
          </label>
          <label className="muted" style={{ display: "flex", gap: 6 }}>
            <input
              type="checkbox"
              checked={pumpWithHeaters}
              disabled={!live}
              onChange={(e) => setPumpWithHeaters(e.target.checked)}
            />
            + тены @ {heaterTarget}°C
          </label>
        </div>
        <ToggleRow
          label={`Насос ${host}`}
          code={`pumps.${host}`}
          on={pumpOn}
          disabled={controlsDisabled}
          onToggle={() => void togglePump()}
          actionLabel={pumpOn ? "STOP" : "START"}
        />
      </div>

      <div className="panel">
        <h2>Нагреватели</h2>
        <div className="row" style={{ marginBottom: 10 }}>
          <label className="muted">
            target °C{" "}
            <input
              type="number"
              value={heaterTarget}
              min={20}
              max={95}
              disabled={!live}
              onChange={(e) =>
                setHeaterTarget(Number(e.target.value) || HEATER_TARGET_C)
              }
              style={{ width: 70 }}
            />
          </label>
          <label className="muted">
            авто-стоп с{" "}
            <input
              type="number"
              value={heaterAutoStopSec}
              min={1}
              max={600}
              disabled={!live}
              onChange={(e) =>
                setHeaterAutoStopSec(Number(e.target.value) || 10)
              }
              style={{ width: 70 }}
            />
          </label>
        </div>
        <div className="device-list">
          {HEATER_IDS.map((hid) => (
            <ToggleRow
              key={hid}
              label={HEATER_LABELS[hid]}
              code={hid}
              on={heaters[hid] ?? null}
              disabled={controlsDisabled}
              onToggle={() => void toggleHeater(hid)}
            />
          ))}
        </div>
      </div>

      <div className="panel">
        <h2>Сервисная диагностика</h2>
        <div className="row">
          {(host === "milk" || host === "coffee") && (
            <ActionButton
              disabled={controlsDisabled}
              onClick={() => void runFlush("milk")}
            >
              Flush milk
            </ActionButton>
          )}
          <ActionButton
            disabled={controlsDisabled}
            onClick={() => void runFlush("water")}
          >
            Flush water
          </ActionButton>
          <ActionButton
            disabled={controlsDisabled}
            onClick={() => {
              setPumpDuration(3000);
              void startPump();
            }}
          >
            Pump test 3с
          </ActionButton>
        </div>
        {host === "milk" || host === "coffee" ? (
          <div className="row" style={{ marginTop: 12 }}>
            <label className="muted">
              пена °C{" "}
              <input
                type="number"
                value={foamTemp}
                min={20}
                max={95}
                disabled={!live}
                onChange={(e) => setFoamTemp(Number(e.target.value))}
                style={{ width: 70 }}
              />
            </label>
            <label className="muted">
              air %{" "}
              <input
                type="number"
                value={foamAir}
                min={0}
                max={100}
                disabled={!live}
                onChange={(e) => setFoamAir(Number(e.target.value))}
                style={{ width: 70 }}
              />
            </label>
            <ActionButton
              disabled={controlsDisabled}
              onClick={() => void foamCook()}
            >
              Готовка пены
            </ActionButton>
          </div>
        ) : null}
      </div>

      {host === "water" ? (
        <div className="panel">
          <h2>Калибровка флоуметра</h2>
          <p className="lead">
            Total pulses:{" "}
            <strong className="metric">
              {waterPulses != null ? waterPulses : "—"}
            </strong>
          </p>
          <div className="row">
            <ActionButton
              variant="primary"
              disabled={controlsDisabled}
              onClick={() => void runFlowCalibration()}
            >
              {busy === "calib" ? "Калибровка…" : "Старт калибровки 100–400 мл"}
            </ActionButton>
          </div>
          {calibStatus ? (
            <p className="muted" style={{ marginTop: 10 }}>
              {calibStatus}
            </p>
          ) : null}
          <table className="temps-table" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Цель мл</th>
                <th>Pulses</th>
                <th>Факт мл</th>
                <th>flowFactor</th>
              </tr>
            </thead>
            <tbody>
              {calibRows.map((r) => (
                <tr key={r.qty}>
                  <td>{r.qty}</td>
                  <td>{r.pulses ?? "—"}</td>
                  <td>{r.actualMl ?? "—"}</td>
                  <td>
                    {r.flowFactor != null ? r.flowFactor.toFixed(6) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {calibLog ? (
            <pre className="code-block" style={{ marginTop: 12, maxHeight: 220 }}>
              {calibLog}
            </pre>
          ) : null}
        </div>
      ) : null}

      <div className="panel">
        <h2>Температуры</h2>
        <table className="temps-table">
          <thead>
            <tr>
              <th>Датчик</th>
              <th>°C</th>
            </tr>
          </thead>
          <tbody>
            {tempKeys.map((key) => (
              <tr key={key}>
                <td>{TEMP_SENSOR_LABELS[key]}</td>
                <td className="metric">
                  {temps[key] != null ? temps[key]!.toFixed(1) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <SyrupFlashPanel
        busy={busy}
        setBusy={setBusy}
        onToast={(t) => setToast(t)}
      />

      <div className="panel">
        <h2>
          <button
            type="button"
            className="linkish"
            onClick={() => setShowLegacy((v) => !v)}
            style={{
              background: "none",
              border: "none",
              color: "inherit",
              cursor: "pointer",
              padding: 0,
              font: "inherit",
            }}
          >
            Legacy / flash_obraz {showLegacy ? "▾" : "▸"}
          </button>
        </h2>
        {showLegacy ? (
          <>
            <p className="lead">
              <code>flash_obraz</code> — ansible-деплой образа (отдельное окно;
              полный in-app port позже). Нужны Host <code>ansible</code> /{" "}
              <code>pusk</code> в ssh config.
            </p>
            <div className="row">
              <ActionButton
                disabled={busy !== null || !natsReady}
                onClick={() =>
                  void window.desktop
                    .launchFleetTool({
                      tool: "module_test",
                      seriesLabel: session.seriesLabel ?? undefined,
                    })
                    .catch((e) => setToast({ text: errText(e), error: true }))
                }
              >
                module_test
              </ActionButton>
              <ActionButton
                disabled={busy !== null}
                onClick={() =>
                  void window.desktop
                    .launchFleetTool({ tool: "sirup_test" })
                    .catch((e) => setToast({ text: errText(e), error: true }))
                }
              >
                sirup_test
              </ActionButton>
              <ActionButton
                disabled={busy !== null}
                onClick={() =>
                  void window.desktop
                    .launchFleetTool({ tool: "flash_sirup" })
                    .catch((e) => setToast({ text: errText(e), error: true }))
                }
              >
                flash_sirup (окно)
              </ActionButton>
              <ActionButton
                helpId="modules.flashObraz"
                disabled={busy !== null}
                onClick={() =>
                  void window.desktop
                    .launchFleetTool({
                      tool: "flash_obraz",
                      seriesLabel: session.seriesLabel ?? undefined,
                    })
                    .catch((e) => setToast({ text: errText(e), error: true }))
                }
              >
                flash_obraz
              </ActionButton>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function ToggleRow(props: {
  label: string;
  code: string;
  on: boolean | null;
  disabled: boolean;
  onToggle: () => void;
  actionLabel?: string;
}) {
  const active = props.on === true;
  const lampClass =
    props.on === true ? "lamp on" : props.on === false ? "lamp" : "lamp unk";
  return (
    <div className="device-row">
      <span className={lampClass} title={String(props.on)} />
      <div className="device-label">
        <span className="device-code">{props.code}</span>
        <span className="device-text">{props.label}</span>
      </div>
      <button
        type="button"
        className={`btn toggle-btn${active ? " toggle-on" : ""}`}
        disabled={props.disabled}
        onClick={props.onToggle}
      >
        {props.actionLabel ?? (active ? "ON" : "OFF")}
      </button>
    </div>
  );
}
