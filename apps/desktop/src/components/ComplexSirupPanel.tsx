/**
 * Полевые сиропы через NATS (complexos.sirup.*) при живой сессии.
 * Status одного мотора / status-all последовательно — без блокировки UI.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  SIRUP_SUBJECTS,
  classifySirupStatusFailure,
  parseSirupMusterReplies,
  parseSirupPumpReply,
  parseSirupStatusReply,
  sirupPumpPayload,
  sirupStatusLabel,
  summarizeSirupPollResults,
  type SirupMotorStatus,
  type SirupPollItem,
} from "@service-monitor/core";
import { ActionButton } from "./ActionButton";
import { HelpTip } from "./HelpTip";
import { useComplexSession } from "../state/useComplexSession";

const LOG_MAX = 200;
/** Stop-all can stay modestly parallel; status-all must not (serial bus / ft-sirup-drv). */
const STOP_ALL_CONCURRENCY = 4;
/** Single-motor Status: enabled motors answer quickly. */
const STATUS_TIMEOUT_MS = 1_200;
/**
 * Poll-all: sequential only (concurrency 1). Longer wait — driver may still be
 * busy from the previous request; parallel 4×1200ms caused false timeouts.
 */
const STATUS_ALL_TIMEOUT_MS = 3_000;
/** Brief gap between sequential status requests so the serial bus can settle. */
const STATUS_ALL_GAP_MS = 75;

const SERVICE_PRESETS: { label: string; seconds: number; intensity: number }[] =
  [
    { label: "0.5с/50%", seconds: 0.5, intensity: 50 },
    { label: "2с/50%", seconds: 2, intensity: 50 },
    { label: "5с/80%", seconds: 5, intensity: 80 },
  ];

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isWriteUnlocked(): boolean {
  return sessionStorage.getItem("sm.writeUnlocked") === "1";
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

async function mapConcurrent<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
  shouldCancel: () => boolean
): Promise<void> {
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, Math.max(items.length, 1)) },
    async () => {
      while (true) {
        if (shouldCancel()) return;
        const i = next++;
        if (i >= items.length) return;
        await fn(items[i]!);
      }
    }
  );
  await Promise.all(workers);
}

type Props = {
  busy: string | null;
  setBusy: (v: string | null) => void;
  onToast: (t: { text: string; error?: boolean }) => void;
};

type MotorRow = {
  hwid: string;
  status?: SirupMotorStatus;
  lastMsg?: string;
  error?: boolean;
};

type LogLevel = "info" | "ok" | "err";

type LogEntry = {
  id: number;
  ts: number;
  level: LogLevel;
  text: string;
};

type DebugSnap = {
  subject: string;
  reply: unknown;
};

export function ComplexSirupPanel({ busy, setBusy, onToast }: Props) {
  const { session } = useComplexSession();
  const live = session.connected === true;
  const [motors, setMotors] = useState<MotorRow[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [seconds, setSeconds] = useState(1);
  const [intensity, setIntensity] = useState(50);
  const [pollOn, setPollOn] = useState(true);
  const [unlocked, setUnlocked] = useState(isWriteUnlocked);
  /** Local soft busy — не блокирует весь экран Дозатора */
  const [localBusy, setLocalBusy] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [debug, setDebug] = useState<DebugSnap | null>(null);
  const pollInFlight = useRef(false);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const logIdRef = useRef(0);
  const logElRef = useRef<HTMLPreElement | null>(null);
  const cancelBatchRef = useRef(false);

  useEffect(() => {
    const t = window.setInterval(() => setUnlocked(isWriteUnlocked()), 2000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const el = logElRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [log]);

  const appendLog = useCallback((level: LogLevel, text: string) => {
    const id = ++logIdRef.current;
    setLog((prev) => {
      const next = [...prev, { id, ts: Date.now(), level, text }];
      return next.length > LOG_MAX ? next.slice(next.length - LOG_MAX) : next;
    });
  }, []);

  const natsReq = useCallback(
    async (
      subject: string,
      payload: Record<string, unknown> = {},
      timeoutMs = 1_500
    ) => {
      return window.desktop.natsRequest({
        subject,
        payload,
        timeoutMs,
        priority: "poll",
      });
    },
    []
  );

  const patchMotor = useCallback((row: MotorRow) => {
    setMotors((prev) => {
      const i = prev.findIndex((m) => m.hwid === row.hwid);
      if (i < 0) return [...prev, row];
      const next = prev.slice();
      next[i] = { ...prev[i]!, ...row };
      return next;
    });
  }, []);

  /** Один мотор — быстро; не трогаем остальные. */
  const refreshOne = useCallback(
    async (
      hwid: string,
      opts?: { silent?: boolean }
    ): Promise<{ status?: SirupMotorStatus; error?: boolean } | null> => {
      if (!live || !hwid) return null;
      const subject = SIRUP_SUBJECTS.status(hwid);
      try {
        const res = await natsReq(subject, {}, STATUS_TIMEOUT_MS);
        setDebug({ subject, reply: res.ok ? res.data : { error: res.error } });
        if (!res.ok) {
          const errMsg = String(res.error);
          const kind = classifySirupStatusFailure(errMsg);
          patchMotor({
            hwid,
            status: "unknown",
            error: true,
            lastMsg: errMsg,
          });
          if (!opts?.silent) {
            appendLog(
              "err",
              kind === "timeout"
                ? `status #${hwid}: нет ответа (timeout)`
                : `status #${hwid}: ${errMsg}`
            );
          }
          return { status: "unknown", error: true };
        }
        const parsed = parseSirupStatusReply(res.data);
        patchMotor({
          hwid,
          status: parsed.status ?? "unknown",
          error: parsed.error === true,
          lastMsg: parsed.message,
        });
        if (!opts?.silent) {
          appendLog(
            parsed.error ? "err" : "ok",
            `status #${hwid}: ${sirupStatusLabel(parsed.status)}${
              parsed.message ? ` · ${parsed.message}` : ""
            }`
          );
        }
        return {
          status: parsed.status ?? "unknown",
          error: parsed.error === true,
        };
      } catch (e) {
        const msg = errText(e);
        patchMotor({
          hwid,
          status: "unknown",
          error: true,
          lastMsg: msg,
        });
        if (!opts?.silent) appendLog("err", `status #${hwid}: ${msg}`);
        return { status: "unknown", error: true };
      }
    },
    [live, natsReq, patchMotor, appendLog]
  );

  async function runMuster() {
    if (!live) {
      onToast({ text: "Нужна живая сессия (NATS)", error: true });
      return;
    }
    setLocalBusy("muster");
    appendLog("info", "muster…");
    try {
      const many = await window.desktop.natsRequestMany({
        subject: SIRUP_SUBJECTS.muster,
        payload: {},
        timeoutMs: 2_000,
        priority: "poll",
      });
      setDebug({
        subject: SIRUP_SUBJECTS.muster,
        reply: many.ok
          ? { replies: many.replies }
          : { error: many.error },
      });
      if (!many.ok) {
        onToast({ text: String(many.error), error: true });
        appendLog("err", `muster: ${String(many.error)}`);
        return;
      }
      const ids = parseSirupMusterReplies(
        Array.isArray(many.replies) ? many.replies : []
      );
      if (ids.length === 0) {
        onToast({
          text: "muster пуст — ft-sirup-drv / cupstorage --sirup4?",
          error: true,
        });
        appendLog("err", "muster пуст");
        setMotors([]);
        setSelected("");
        return;
      }
      const pick =
        selected && ids.includes(selected) ? selected : (ids[0] as string);
      setSelected(pick);
      // Список сразу, без ожидания 30×status
      setMotors(ids.map((hwid) => ({ hwid, status: undefined })));
      onToast({ text: `Найдено ${ids.length} · выбран #${pick}` });
      appendLog("ok", `muster → ${ids.length} моторов · выбран #${pick}`);
      void refreshOne(pick, { silent: true });
    } catch (e) {
      const msg = errText(e);
      onToast({ text: msg, error: true });
      appendLog("err", `muster: ${msg}`);
    } finally {
      setLocalBusy(null);
    }
  }

  // Poll только выбранный id
  useEffect(() => {
    if (!live || !pollOn || !selected) return;
    const tick = () => {
      if (pollInFlight.current || busy || localBusy) return;
      pollInFlight.current = true;
      void refreshOne(selectedRef.current, { silent: true }).finally(() => {
        pollInFlight.current = false;
      });
    };
    tick();
    const t = window.setInterval(tick, 2_000);
    return () => clearInterval(t);
  }, [live, pollOn, selected, busy, localBusy, refreshOne]);

  async function runAction(action: "pump" | "unpump" | "stop") {
    if (!live) {
      onToast({ text: "Нужна живая сессия (NATS)", error: true });
      return;
    }
    const hwid = selected;
    if (!hwid) {
      onToast({ text: "Выберите мотор в сетке или нажмите Muster", error: true });
      return;
    }
    if ((action === "pump" || action === "unpump") && !unlocked) {
      onToast({
        text: "Разблокируйте сервисный пароль в Настройках",
        error: true,
      });
      appendLog("err", "pump заблокирован — нужен сервисный пароль");
      return;
    }
    if (action === "pump" || action === "unpump") {
      const ok = window.confirm(
        `${action === "pump" ? "Вперёд (pump)" : "Назад (unpump)"} · #${hwid} · ${seconds}с @ ${intensity}% ?`
      );
      if (!ok) return;
    }

    // pump/unpump держат parent busy (как Lab); status/stop — local
    const useParent = action === "pump" || action === "unpump";
    if (useParent) setBusy(`sirup-${action}`);
    else setLocalBusy(action);

    try {
      if (action === "stop") {
        const subject = SIRUP_SUBJECTS.stop(hwid);
        appendLog("info", `stop #${hwid}`);
        const res = await natsReq(subject, {}, 3_000);
        setDebug({ subject, reply: res.ok ? res.data : { error: res.error } });
        if (!res.ok) {
          onToast({ text: String(res.error), error: true });
          appendLog("err", `stop #${hwid}: ${String(res.error)}`);
          return;
        }
        onToast({ text: `Стоп #${hwid}` });
        appendLog("ok", `stop #${hwid} OK`);
        await refreshOne(hwid, { silent: true });
        return;
      }

      const payload = sirupPumpPayload({ seconds, intensity });
      const subject =
        action === "pump"
          ? SIRUP_SUBJECTS.pump(hwid)
          : SIRUP_SUBJECTS.unpump(hwid);
      appendLog(
        "info",
        `${action} #${hwid} · ${payload.seconds}с @ ${payload.intensity}%`
      );
      const res = await natsReq(subject, payload, 8_000);
      setDebug({ subject, reply: res.ok ? res.data : { error: res.error } });
      if (!res.ok) {
        onToast({ text: String(res.error), error: true });
        appendLog("err", `${action} #${hwid}: ${String(res.error)}`);
        return;
      }
      const parsed = parseSirupPumpReply(res.data);
      if (parsed.error) {
        onToast({
          text: `${action} #${hwid}: ${parsed.message ?? "error"}`,
          error: true,
        });
        appendLog(
          "err",
          `${action} #${hwid}: ${parsed.message ?? "error"}`
        );
      } else {
        onToast({
          text: `${action === "pump" ? "Вперёд" : "Назад"} #${hwid}${
            parsed.seconds != null ? ` · ${parsed.seconds.toFixed(1)}с` : ""
          }`,
        });
        appendLog(
          "ok",
          `${action} #${hwid} OK${
            parsed.seconds != null ? ` · ${parsed.seconds.toFixed(1)}с` : ""
          }`
        );
      }
      await refreshOne(hwid, { silent: true });
    } catch (e) {
      const msg = errText(e);
      onToast({ text: msg, error: true });
      appendLog("err", `${action}: ${msg}`);
    } finally {
      if (useParent) setBusy(null);
      else setLocalBusy(null);
    }
  }

  async function runStatus() {
    if (!selected) return;
    setLocalBusy("status");
    try {
      const got = await refreshOne(selected);
      onToast({
        text: `#${selected}: ${sirupStatusLabel(got?.status)}`,
        error: got?.error === true,
      });
    } finally {
      setLocalBusy(null);
    }
  }

  async function runStatusAll() {
    if (!live) {
      onToast({ text: "Нужна живая сессия (NATS)", error: true });
      return;
    }
    const ids = motors.map((m) => m.hwid);
    if (ids.length === 0) {
      onToast({ text: "Сначала Muster", error: true });
      return;
    }
    cancelBatchRef.current = false;
    setLocalBusy("status-all");
    appendLog(
      "info",
      `опрос всех · ${ids.length} · последовательно (concurrency 1)`
    );
    const results: SirupPollItem[] = [];
    try {
      // Sequential only: parallel status overloads ft-sirup-drv / serial bus
      // and yields false «нет ответа» on motors that answer one-by-one Status.
      for (let i = 0; i < ids.length; i++) {
        if (cancelBatchRef.current) break;
        const hwid = ids[i]!;
        const subject = SIRUP_SUBJECTS.status(hwid);
        try {
          const res = await natsReq(subject, {}, STATUS_ALL_TIMEOUT_MS);
          setDebug({
            subject,
            reply: res.ok ? res.data : { error: res.error },
          });
          if (!res.ok) {
            const errMsg = String(res.error);
            const kind = classifySirupStatusFailure(errMsg);
            patchMotor({
              hwid,
              status: "unknown",
              error: true,
              lastMsg: errMsg,
            });
            results.push({ hwid, kind, message: errMsg });
            // Timeouts collapsed in summary — skip per-motor spam.
            if (kind === "error") {
              appendLog("err", `#${hwid} · ошибка · ${errMsg}`);
            }
          } else {
            const parsed = parseSirupStatusReply(res.data);
            const st = parsed.status ?? "unknown";
            const bad = parsed.error === true;
            patchMotor({
              hwid,
              status: st,
              error: bad,
              lastMsg: parsed.message,
            });
            if (bad) {
              results.push({
                hwid,
                kind: "error",
                status: st,
                message: parsed.message ?? "error",
              });
              appendLog(
                "err",
                `#${hwid} · ${sirupStatusLabel(st)}${
                  parsed.message ? ` · ${parsed.message}` : ""
                }`
              );
            } else {
              results.push({
                hwid,
                kind: "ok",
                status: st,
                message: parsed.message,
              });
              appendLog("ok", `#${hwid} · ${sirupStatusLabel(st)}`);
            }
          }
        } catch (e) {
          const msg = errText(e);
          const kind = classifySirupStatusFailure(msg);
          patchMotor({
            hwid,
            status: "unknown",
            error: true,
            lastMsg: msg,
          });
          results.push({ hwid, kind, message: msg });
          if (kind === "error") {
            appendLog("err", `#${hwid} · ошибка · ${msg}`);
          }
        }
        if (
          !cancelBatchRef.current &&
          i + 1 < ids.length &&
          STATUS_ALL_GAP_MS > 0
        ) {
          await new Promise((r) => setTimeout(r, STATUS_ALL_GAP_MS));
        }
      }
      const cancelled = cancelBatchRef.current;
      const summary = summarizeSirupPollResults(results);
      if (summary.noReplyLine) {
        appendLog("err", summary.noReplyLine);
      }
      if (summary.fieldNote && summary.timeoutCount > 0) {
        appendLog("info", summary.fieldNote);
      }
      const prefix = cancelled ? "опрос отменён · " : "";
      const msg = `${prefix}${summary.summaryLine}`;
      const hasFail = summary.timeoutCount + summary.errorCount > 0;
      onToast({ text: msg, error: hasFail && !cancelled });
      appendLog(hasFail ? "err" : "ok", msg);
    } finally {
      cancelBatchRef.current = false;
      setLocalBusy(null);
    }
  }

  async function runStopAll() {
    if (!live) {
      onToast({ text: "Нужна живая сессия (NATS)", error: true });
      return;
    }
    const ids = motors.map((m) => m.hwid);
    if (ids.length === 0) {
      onToast({ text: "Сначала Muster", error: true });
      return;
    }
    const okConfirm = window.confirm(
      `Стоп всем известным моторам (${ids.length})?`
    );
    if (!okConfirm) return;

    cancelBatchRef.current = false;
    setLocalBusy("stop-all");
    appendLog("info", `stop all · ${ids.length}`);
    let ok = 0;
    let fail = 0;
    try {
      await mapConcurrent(
        ids,
        STOP_ALL_CONCURRENCY,
        async (hwid) => {
          if (cancelBatchRef.current) return;
          const subject = SIRUP_SUBJECTS.stop(hwid);
          try {
            const res = await natsReq(subject, {}, 3_000);
            setDebug({
              subject,
              reply: res.ok ? res.data : { error: res.error },
            });
            if (!res.ok) {
              fail += 1;
              return;
            }
            ok += 1;
            patchMotor({
              hwid,
              status: "stopped",
              error: false,
              lastMsg: undefined,
            });
          } catch {
            fail += 1;
          }
        },
        () => cancelBatchRef.current
      );
      const cancelled = cancelBatchRef.current;
      const msg = cancelled
        ? `stop all отменён · ok ${ok} · err ${fail}`
        : `stop all · ok ${ok} · err ${fail}`;
      onToast({ text: msg, error: fail > 0 && !cancelled });
      appendLog(fail > 0 ? "err" : "ok", msg);
    } finally {
      cancelBatchRef.current = false;
      setLocalBusy(null);
    }
  }

  function cancelBatch() {
    cancelBatchRef.current = true;
    appendLog("info", "отмена batch…");
  }

  async function copyText(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      onToast({ text: `${label} скопирован` });
      appendLog("info", `copy ${label}`);
    } catch (e) {
      onToast({ text: errText(e), error: true });
    }
  }

  function copySubject() {
    if (debug?.subject) {
      void copyText("subject", debug.subject);
      return;
    }
    if (selected) {
      void copyText("subject", SIRUP_SUBJECTS.status(selected));
      return;
    }
    onToast({ text: "Нет subject для копирования", error: true });
  }

  function copyLastReply() {
    if (debug == null) {
      onToast({ text: "Нет последнего ответа", error: true });
      return;
    }
    try {
      void copyText(
        "reply JSON",
        JSON.stringify(debug.reply, null, 2)
      );
    } catch (e) {
      onToast({ text: errText(e), error: true });
    }
  }

  const cmdBusy = busy !== null || localBusy !== null;
  const canCmd = live && !!selected && !cmdBusy;
  const batchBusy =
    localBusy === "status-all" || localBusy === "stop-all";

  const selectedRow = motors.find((m) => m.hwid === selected);

  return (
    <div className="panel panel-compact">
      <h2 className="row" style={{ gap: 8, alignItems: "center" }}>
        Сиропы комплекса · NATS
        <HelpTip controlId="modules.sirupNats" />
      </h2>
      <ol
        className="muted"
        style={{ margin: "0 0 10px", paddingLeft: 18, fontSize: 12 }}
      >
        <li>
          <strong>Muster</strong> — список моторов (быстро)
        </li>
        <li>Клик по номеру в сетке — выбор</li>
        <li>
          <strong>Status</strong> / Вперёд / Назад / Стоп — только выбранный
        </li>
        <li>
          <strong>Опрос всех</strong> — последовательно (по одному); ответившие
          в лог; таймауты схлопываются в диапазоны (можно Отмена)
        </li>
      </ol>
      <p className="muted" style={{ margin: "0 0 10px", fontSize: 12 }}>
        Status = только движение (вперёд / назад / стоп). Muster часто отдаёт
        все 30 id (MAX_MOTORS): включённые и заблокированные в дашборде обычно
        отвечают при спокойном опросе; физически отсутствующие — timeout.
        Параллельный bulk перегружает шину и даёт ложные «нет ответа». Ток/В —
        только стенд Modbus/flash.
      </p>

      <div className="row" style={{ flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
        <span className={`badge${live ? " on" : ""}`}>
          {live ? "NATS live" : "нет сессии"}
        </span>
        <span
          className={`badge${unlocked ? " on" : ""}`}
          title={
            unlocked
              ? "Сервисный пароль разблокирован — pump/unpump доступны"
              : "Нужен сервисный пароль в Настройках"
          }
        >
          {unlocked ? "pump разрешён" : "pump: нужен пароль"}
        </span>
        {selected ? (
          <span className="badge on">
            #{selected} · {sirupStatusLabel(selectedRow?.status)}
          </span>
        ) : null}
        {localBusy ? <span className="badge">{localBusy}…</span> : null}
        <label className="muted" style={{ display: "inline-flex", gap: 6 }}>
          <input
            type="checkbox"
            checked={pollOn}
            disabled={!live}
            onChange={(e) => setPollOn(e.target.checked)}
          />
          poll выбранного
        </label>
      </div>

      <div className="row" style={{ flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        <ActionButton
          helpId="modules.sirupNats"
          disabled={!live || cmdBusy}
          onClick={() => void runMuster()}
        >
          {localBusy === "muster" ? "Muster…" : "1. Muster"}
        </ActionButton>
        <label className="muted">
          сек
          <input
            type="number"
            min={0.2}
            max={30}
            step={0.1}
            value={seconds}
            disabled={!live}
            onChange={(e) => setSeconds(Number(e.target.value) || 1)}
            style={{ width: 56, marginLeft: 6 }}
          />
        </label>
        <label className="muted">
          %
          <input
            type="number"
            min={1}
            max={100}
            value={intensity}
            disabled={!live}
            onChange={(e) => setIntensity(Number(e.target.value) || 50)}
            style={{ width: 52, marginLeft: 6 }}
          />
        </label>
        <span className="sirup-presets" aria-label="Пресеты сек/%">
          {SERVICE_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              className="btn btn-compact sirup-preset-btn"
              disabled={!live}
              title={`сек=${p.seconds}, intensity=${p.intensity}`}
              onClick={() => {
                setSeconds(p.seconds);
                setIntensity(p.intensity);
                appendLog("info", `preset ${p.label}`);
              }}
            >
              {p.label}
            </button>
          ))}
        </span>
        <ActionButton disabled={!canCmd} onClick={() => void runStatus()}>
          Status
        </ActionButton>
        <ActionButton
          disabled={!canCmd || !unlocked}
          onClick={() => void runAction("pump")}
        >
          Вперёд
        </ActionButton>
        <ActionButton
          disabled={!canCmd || !unlocked}
          onClick={() => void runAction("unpump")}
        >
          Назад
        </ActionButton>
        <ActionButton disabled={!canCmd} onClick={() => void runAction("stop")}>
          Стоп
        </ActionButton>
      </div>

      <div
        className="row"
        style={{ flexWrap: "wrap", gap: 8, marginBottom: 10 }}
      >
        <span className="muted" style={{ fontSize: 12, alignSelf: "center" }}>
          Сервис:
        </span>
        <ActionButton
          className="btn-compact"
          disabled={!live || motors.length === 0 || (cmdBusy && !batchBusy)}
          title="Опрос status всех моторов после Muster → лог действий"
          onClick={() => void runStatusAll()}
        >
          {localBusy === "status-all" ? "Опрос…" : "Опрос всех"}
        </ActionButton>
        <ActionButton
          className="btn-compact"
          disabled={!live || motors.length === 0 || (cmdBusy && !batchBusy)}
          onClick={() => void runStopAll()}
        >
          {localBusy === "stop-all" ? "Stop all…" : "Stop all"}
        </ActionButton>
        {batchBusy ? (
          <ActionButton className="btn-compact" onClick={cancelBatch}>
            Отмена
          </ActionButton>
        ) : null}
        <ActionButton
          className="btn-compact"
          disabled={!selected && !debug}
          onClick={copySubject}
        >
          Copy subject
        </ActionButton>
        <ActionButton
          className="btn-compact"
          disabled={debug == null}
          onClick={copyLastReply}
        >
          Copy reply
        </ActionButton>
      </div>

      {motors.length > 0 ? (
        <div
          className="sirup-chip-grid"
          role="listbox"
          aria-label="Сиропные моторы"
        >
          {motors.map((m) => {
            const st = m.status;
            const noReply = st === "unknown" || (m.error === true && st == null);
            const cls =
              st === "forward" || st === "reverse"
                ? "on"
                : noReply || m.error
                  ? "noreply"
                  : st === "stopped"
                    ? "off"
                    : "idle";
            const stLabel =
              st == null
                ? "ещё не опрашивали"
                : noReply || (m.error && st === "unknown")
                  ? "нет ответа"
                  : sirupStatusLabel(st);
            return (
              <button
                key={m.hwid}
                type="button"
                role="option"
                aria-selected={selected === m.hwid}
                className={`sirup-chip${selected === m.hwid ? " selected" : ""} ${cls}`}
                title={
                  m.lastMsg ? `${stLabel} · ${m.lastMsg}` : stLabel
                }
                onClick={() => {
                  setSelected(m.hwid);
                  void refreshOne(m.hwid);
                }}
              >
                <span className="sirup-chip-id">{m.hwid}</span>
                <span className="sirup-chip-st">
                  {st == null
                    ? "·"
                    : st === "forward"
                      ? "→"
                      : st === "reverse"
                        ? "←"
                        : st === "stopped"
                          ? "■"
                          : "?"}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          Нажмите <strong>Muster</strong> при живой сессии.
        </p>
      )}

      <div className="sirup-log-wrap">
        <div className="row sirup-log-head">
          <span className="muted" style={{ fontSize: 12 }}>
            Лог действий
          </span>
          <ActionButton
            className="btn-compact"
            disabled={log.length === 0}
            onClick={() => setLog([])}
          >
            Clear log
          </ActionButton>
        </div>
        <pre
          className="sirup-action-log"
          ref={logElRef}
          aria-label="Лог действий сиропов"
        >
          {log.length === 0
            ? "— лог пуст —"
            : log
                .map((e) => {
                  const mark =
                    e.level === "err" ? "!" : e.level === "ok" ? "·" : " ";
                  return `${fmtTime(e.ts)} ${mark} ${e.text}`;
                })
                .join("\n")}
        </pre>
      </div>
    </div>
  );
}
