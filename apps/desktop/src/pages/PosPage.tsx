/**
 * Касса / ККТ / платежи: health + CashDev-gated commit / barcode test.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  PAYMENTS_SUBJECTS,
  POS_DEFAULT_HWID_HINT,
  POS_STATUS_AUTO_COMMIT_WARNING,
  PRINTER_SUBJECTS,
  formatPosHostProbeLog,
  formatPosStatusLine,
  parsePaymentsCheckReply,
  parsePaymentsStatusReply,
  parsePosActionReply,
  parsePosMusterReplies,
  parsePrinterStatusReply,
  posBarcodeTestPayload,
  posWorkdayLabel,
  type PaymentsCheckReply,
  type PaymentsStatusReply,
  type PosHostProbe,
  type PrinterStatusReply,
} from "@service-monitor/core";
import { ActionButton } from "../components/ActionButton";
import { ConfirmModal } from "../components/ConfirmModal";
import { HelpTip } from "../components/HelpTip";
import {
  CASH_DEV_SESSION_KEY,
  fmtBool,
  fmtReadyLine,
  isCashDevSessionFlag,
  posStatusCardClass,
} from "../lib/pos-ui";
import { useComplexSession } from "../state/useComplexSession";

const LOG_MAX = 200;
const STATUS_TIMEOUT_MS = 4_000;
const ACTION_TIMEOUT_MS = 30_000;

function isCashDevUnlocked(): boolean {
  return isCashDevSessionFlag(sessionStorage.getItem(CASH_DEV_SESSION_KEY));
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

type LogLevel = "info" | "ok" | "err";
type LogEntry = { id: number; ts: number; level: LogLevel; text: string };

type PendingAction =
  | {
      kind: "barcodeTest";
      title: string;
      danger: string;
      cheatSheet: string[];
      confirmLabel: string;
    }
  | {
      kind: "printerCommit";
      title: string;
      danger: string;
      cheatSheet: string[];
      confirmLabel: string;
    }
  | {
      kind: "paymentsCommit";
      title: string;
      danger: string;
      cheatSheet: string[];
      confirmLabel: string;
    };

export function PosPage() {
  const { session, warn } = useComplexSession();
  const live = session.connected === true;

  const [cashUnlocked, setCashUnlocked] = useState(isCashDevUnlocked);
  const [password, setPassword] = useState("");
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [printerHwid, setPrinterHwid] = useState("");
  const [paymentsHwid, setPaymentsHwid] = useState("");
  const [printerStatus, setPrinterStatus] = useState<PrinterStatusReply | null>(
    null
  );
  const [paymentsStatus, setPaymentsStatus] =
    useState<PaymentsStatusReply | null>(null);
  const [paymentsCheck, setPaymentsCheck] = useState<PaymentsCheckReply | null>(
    null
  );
  const [hostProbe, setHostProbe] = useState<PosHostProbe | null>(null);
  const [hostProbeError, setHostProbeError] = useState<string | null>(null);

  const [log, setLog] = useState<LogEntry[]>([]);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const logIdRef = useRef(0);
  const logElRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    const t = window.setInterval(
      () => setCashUnlocked(isCashDevUnlocked()),
      2000
    );
    return () => window.clearInterval(t);
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
      timeoutMs = STATUS_TIMEOUT_MS
    ) => {
      return window.desktop.natsRequest({ subject, payload, timeoutMs });
    },
    []
  );

  async function unlockCash() {
    setUnlockError(null);
    const res = await window.desktop.verifyCashDevPassword(password);
    if (!res.ok) {
      sessionStorage.removeItem(CASH_DEV_SESSION_KEY);
      setCashUnlocked(false);
      setUnlockError("Неверный пароль");
      appendLog("err", "пароль кассы: отказ");
      await window.desktop.log("warn", "pos", "cashDev unlock failed");
      return;
    }
    sessionStorage.setItem(CASH_DEV_SESSION_KEY, "1");
    setCashUnlocked(true);
    setPassword("");
    appendLog("ok", "пароль кассы: разблокировано");
    await window.desktop.log("info", "pos", "cashDev unlocked");
  }

  function lockCash() {
    sessionStorage.removeItem(CASH_DEV_SESSION_KEY);
    setCashUnlocked(false);
    appendLog("info", "пароль кассы: заблокировано");
    void window.desktop.log("info", "pos", "cashDev locked");
  }

  const resolveHwid = useCallback(
    (prefer: string, fallbackOther: string) =>
      prefer.trim() || fallbackOther.trim() || POS_DEFAULT_HWID_HINT,
    []
  );

  async function runPrinterMuster() {
    if (!live || busy) return;
    setBusy("printer-muster");
    try {
      const many = await window.desktop.natsRequestMany({
        subject: PRINTER_SUBJECTS.muster,
        payload: {},
        timeoutMs: STATUS_TIMEOUT_MS,
        priority: "poll",
      });
      if (!many.ok) throw new Error(many.error || "muster failed");
      const ids = parsePosMusterReplies(many.replies ?? []);
      const hwid = ids[0] ?? "";
      setPrinterHwid(hwid);
      appendLog(
        hwid ? "ok" : "err",
        hwid
          ? `printer muster → ${ids.join(", ")}`
          : "printer muster пуст — ft-printer-drv?"
      );
    } catch (e) {
      appendLog("err", `printer muster: ${errText(e)}`);
    } finally {
      setBusy(null);
    }
  }

  async function runPaymentsMuster() {
    if (!live || busy) return;
    setBusy("payments-muster");
    try {
      const many = await window.desktop.natsRequestMany({
        subject: PAYMENTS_SUBJECTS.muster,
        payload: {},
        timeoutMs: STATUS_TIMEOUT_MS,
        priority: "poll",
      });
      if (!many.ok) throw new Error(many.error || "muster failed");
      const ids = parsePosMusterReplies(many.replies ?? []);
      const hwid = ids[0] ?? "";
      setPaymentsHwid(hwid);
      appendLog(
        hwid ? "ok" : "err",
        hwid
          ? `payments muster → ${ids.join(", ")}`
          : "payments muster пуст — ft-payments-drv?"
      );
    } catch (e) {
      appendLog("err", `payments muster: ${errText(e)}`);
    } finally {
      setBusy(null);
    }
  }

  async function runPrinterStatus(hwidIn?: string) {
    if (!live || busy) return;
    const hwid = hwidIn || resolveHwid(printerHwid, paymentsHwid);
    setBusy("printer-status");
    try {
      appendLog("info", POS_STATUS_AUTO_COMMIT_WARNING);
      const res = await natsReq(PRINTER_SUBJECTS.status(hwid), {}, STATUS_TIMEOUT_MS);
      if (!res.ok) throw new Error(res.error || "status failed");
      const parsed = parsePrinterStatusReply(res.data);
      setPrinterStatus(parsed);
      if (!printerHwid) setPrinterHwid(hwid);
      appendLog(
        parsed.error ? "err" : "ok",
        `${formatPosStatusLine("printer", parsed)} @ ${hwid}`
      );
    } catch (e) {
      appendLog("err", `printer status: ${errText(e)}`);
    } finally {
      setBusy(null);
    }
  }

  async function runPaymentsStatus(hwidIn?: string) {
    if (!live || busy) return;
    const hwid = hwidIn || resolveHwid(paymentsHwid, printerHwid);
    setBusy("payments-status");
    try {
      appendLog("info", POS_STATUS_AUTO_COMMIT_WARNING);
      const res = await natsReq(
        PAYMENTS_SUBJECTS.status(hwid),
        {},
        STATUS_TIMEOUT_MS
      );
      if (!res.ok) throw new Error(res.error || "status failed");
      const parsed = parsePaymentsStatusReply(res.data);
      setPaymentsStatus(parsed);
      if (!paymentsHwid) setPaymentsHwid(hwid);
      appendLog(
        parsed.error ? "err" : "ok",
        `${formatPosStatusLine("payments", parsed)} @ ${hwid}`
      );
    } catch (e) {
      appendLog("err", `payments status: ${errText(e)}`);
    } finally {
      setBusy(null);
    }
  }

  async function runPaymentsCheck() {
    if (!live || busy) return;
    const hwid = resolveHwid(paymentsHwid, printerHwid);
    setBusy("payments-check");
    try {
      const res = await natsReq(
        PAYMENTS_SUBJECTS.check(hwid),
        {},
        STATUS_TIMEOUT_MS
      );
      if (!res.ok) throw new Error(res.error || "check failed");
      const parsed = parsePaymentsCheckReply(res.data);
      setPaymentsCheck(parsed);
      appendLog(
        parsed.error ? "err" : "ok",
        `payments check @ ${hwid}: ready=${String(parsed.ready)} ${
          parsed.message ?? ""
        }`
      );
    } catch (e) {
      appendLog("err", `payments check: ${errText(e)}`);
    } finally {
      setBusy(null);
    }
  }

  async function runHealthRefresh() {
    if (!live || busy) return;
    setBusy("health");
    try {
      appendLog("info", "health: muster + status…");
      appendLog("info", POS_STATUS_AUTO_COMMIT_WARNING);

      const [pMuster, payMuster] = await Promise.all([
        window.desktop.natsRequestMany({
          subject: PRINTER_SUBJECTS.muster,
          payload: {},
          timeoutMs: STATUS_TIMEOUT_MS,
          priority: "poll",
        }),
        window.desktop.natsRequestMany({
          subject: PAYMENTS_SUBJECTS.muster,
          payload: {},
          timeoutMs: STATUS_TIMEOUT_MS,
          priority: "poll",
        }),
      ]);

      const pIds = pMuster.ok
        ? parsePosMusterReplies(pMuster.replies ?? [])
        : [];
      const payIds = payMuster.ok
        ? parsePosMusterReplies(payMuster.replies ?? [])
        : [];
      const pH = pIds[0] || printerHwid || POS_DEFAULT_HWID_HINT;
      const payH = payIds[0] || paymentsHwid || pH;
      if (pIds[0]) setPrinterHwid(pIds[0]);
      if (payIds[0]) setPaymentsHwid(payIds[0]);
      appendLog(
        "info",
        `muster printer=[${pIds.join(",") || "—"}] payments=[${
          payIds.join(",") || "—"
        }]`
      );

      const [pSt, paySt, payCk] = await Promise.all([
        natsReq(PRINTER_SUBJECTS.status(pH), {}, STATUS_TIMEOUT_MS),
        natsReq(PAYMENTS_SUBJECTS.status(payH), {}, STATUS_TIMEOUT_MS),
        natsReq(PAYMENTS_SUBJECTS.check(payH), {}, STATUS_TIMEOUT_MS),
      ]);

      if (pSt.ok) {
        const parsed = parsePrinterStatusReply(pSt.data);
        setPrinterStatus(parsed);
        appendLog(
          parsed.error ? "err" : "ok",
          formatPosStatusLine("printer", parsed)
        );
      } else {
        appendLog("err", `printer status: ${pSt.error}`);
      }
      if (paySt.ok) {
        const parsed = parsePaymentsStatusReply(paySt.data);
        setPaymentsStatus(parsed);
        appendLog(
          parsed.error ? "err" : "ok",
          formatPosStatusLine("payments", parsed)
        );
      } else {
        appendLog("err", `payments status: ${paySt.error}`);
      }
      if (payCk.ok) {
        const parsed = parsePaymentsCheckReply(payCk.data);
        setPaymentsCheck(parsed);
        appendLog(
          parsed.error ? "err" : "ok",
          `payments check: ready=${String(parsed.ready)}`
        );
      } else {
        appendLog("err", `payments check: ${payCk.error}`);
      }

      if (typeof window.desktop.posProbeHost === "function") {
        const hostRes = await window.desktop.posProbeHost();
        if (hostRes.ok) {
          setHostProbe(hostRes.probe);
          setHostProbeError(null);
          appendLog(
            hostRes.probe.level === "error" ? "err" : "ok",
            formatPosHostProbeLog(hostRes.probe)
          );
        } else {
          setHostProbe(null);
          setHostProbeError(hostRes.error);
          appendLog("err", `host USB/systemd: ${hostRes.error}`);
        }
      } else {
        setHostProbe(null);
        setHostProbeError("posProbeHost недоступен в этой сборке");
      }
    } catch (e) {
      appendLog("err", `health: ${errText(e)}`);
    } finally {
      setBusy(null);
    }
  }

  function askBarcodeTest() {
    if (!live || !cashUnlocked) return;
    const hwid = resolveHwid(printerHwid, paymentsHwid);
    const payload = posBarcodeTestPayload();
    setPending({
      kind: "barcodeTest",
      title: "Тест этикетки (barcode)",
      danger:
        "Напечатает тестовую этикетку на принтере (--format=barcode / NIIMBOT). На фискальном atol-wr это может уйти в print-cheque как чек — не используйте на ATOL-точках как «тест».",
      cheatSheet: [
        `NATS ${PRINTER_SUBJECTS.printCheque(hwid)}`,
        `payload: barcode=${payload.barcode}, ordernumber=${payload.ordernumber}`,
        "Нужен пароль кассы · бумага / лента будет израсходована",
      ],
      confirmLabel: "Напечатать тест",
    });
  }

  function askPrinterCommit() {
    if (!live || !cashUnlocked) return;
    const hwid = resolveHwid(printerHwid, paymentsHwid);
    setPending({
      kind: "printerCommit",
      title: "Закрыть смену ККТ",
      danger:
        "Закрытие смены принтера/ККТ. На ATOL печатается Z-отчёт. На barcode-режиме часто no-op. Необратимо для текущей смены.",
      cheatSheet: [
        `NATS ${PRINTER_SUBJECTS.commit(hwid)}`,
        "Эквивалент закрытия смены на ККТ",
        "Сначала лучше status (VIEW), если не уверены",
      ],
      confirmLabel: "Закрыть смену ККТ",
    });
  }

  function askPaymentsCommit() {
    if (!live || !cashUnlocked) return;
    const hwid = resolveHwid(paymentsHwid, printerHwid);
    setPending({
      kind: "paymentsCommit",
      title: "Закрыть смену эквайринга",
      danger:
        "Закрытие смены эквайринга (ft-payments-drv). Не charge и не refund, но смена на терминале будет закрыта.",
      cheatSheet: [
        `NATS ${PAYMENTS_SUBJECTS.commit(hwid)}`,
        "После — новая смена откроется при следующей операции",
      ],
      confirmLabel: "Закрыть смену эквайринга",
    });
  }

  async function runPending() {
    if (!pending || !cashUnlocked) return;
    const action = pending;
    setPending(null);
    const hwid =
      action.kind === "paymentsCommit"
        ? resolveHwid(paymentsHwid, printerHwid)
        : resolveHwid(printerHwid, paymentsHwid);

    setBusy(action.kind);
    try {
      if (action.kind === "barcodeTest") {
        const payload = posBarcodeTestPayload();
        const subject = PRINTER_SUBJECTS.printCheque(hwid);
        appendLog("info", `→ ${subject} ${JSON.stringify(payload)}`);
        const res = await natsReq(subject, { ...payload }, ACTION_TIMEOUT_MS);
        if (!res.ok) throw new Error(res.error || "print failed");
        const parsed = parsePosActionReply(res.data);
        appendLog(
          parsed.error ? "err" : "ok",
          parsed.error
            ? `barcode test: ${parsed.message ?? "error"}`
            : `barcode test ok @ ${hwid}`
        );
      } else if (action.kind === "printerCommit") {
        const subject = PRINTER_SUBJECTS.commit(hwid);
        appendLog("info", `→ ${subject}`);
        const res = await natsReq(subject, {}, ACTION_TIMEOUT_MS);
        if (!res.ok) throw new Error(res.error || "commit failed");
        const parsed = parsePosActionReply(res.data);
        appendLog(
          parsed.error ? "err" : "ok",
          parsed.error
            ? `printer commit: ${parsed.message ?? "error"}`
            : `printer commit ok @ ${hwid}`
        );
      } else {
        const subject = PAYMENTS_SUBJECTS.commit(hwid);
        appendLog("info", `→ ${subject}`);
        const res = await natsReq(subject, {}, ACTION_TIMEOUT_MS);
        if (!res.ok) throw new Error(res.error || "commit failed");
        const parsed = parsePosActionReply(res.data);
        appendLog(
          parsed.error ? "err" : "ok",
          parsed.error
            ? `payments commit: ${parsed.message ?? "error"}`
            : `payments commit ok @ ${hwid}`
        );
      }
    } catch (e) {
      appendLog("err", `${action.kind}: ${errText(e)}`);
    } finally {
      setBusy(null);
    }
  }

  const controlsDisabled = !live || busy !== null;
  const dangerDisabled = controlsDisabled || !cashUnlocked;

  return (
    <div className="stack">
      <div className={`panel${warn ? " panel-warn" : ""}`}>
        <h2 className="row" style={{ gap: 8, alignItems: "center" }}>
          Касса / ККТ / платежи
          <HelpTip controlId="nav.pos" />
        </h2>
        <p className="lead">
          NATS <code>complexos.printer.*</code> /{" "}
          <code>complexos.payments.*</code> (ft-*-drv). Health — без пароля;
          закрытие смены и тест этикетки — после пароля кассы. Подробности —
          Справка → «Касса, ККТ и платежи».
        </p>
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          <span className={`badge${live ? " on" : ""}`}>
            {live ? "NATS live" : "нет сессии"}
          </span>
          <span className={`badge${cashUnlocked ? " on" : ""}`}>
            {cashUnlocked ? "сервис открыт" : "сервис закрыт"}
          </span>
          {busy ? <span className="badge">{busy}…</span> : null}
        </div>
      </div>

      <div className="panel panel-compact">
        <h2>Health</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
          {POS_STATUS_AUTO_COMMIT_WARNING}
        </p>
        <div className="row" style={{ flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
          <ActionButton
            helpId="pos.healthRefresh"
            variant="primary"
            disabled={controlsDisabled}
            onClick={() => void runHealthRefresh()}
          >
            Опрос health
          </ActionButton>
          <ActionButton
            helpId="pos.printerMuster"
            disabled={controlsDisabled}
            onClick={() => void runPrinterMuster()}
          >
            Printer muster
          </ActionButton>
          <ActionButton
            helpId="pos.printerStatus"
            disabled={controlsDisabled}
            onClick={() => void runPrinterStatus()}
          >
            Printer status
          </ActionButton>
          <ActionButton
            helpId="pos.paymentsMuster"
            disabled={controlsDisabled}
            onClick={() => void runPaymentsMuster()}
          >
            Payments muster
          </ActionButton>
          <ActionButton
            helpId="pos.paymentsStatus"
            disabled={controlsDisabled}
            onClick={() => void runPaymentsStatus()}
          >
            Payments status
          </ActionButton>
          <ActionButton
            helpId="pos.paymentsCheck"
            disabled={controlsDisabled}
            onClick={() => void runPaymentsCheck()}
          >
            Payments check
          </ActionButton>
        </div>

        <div className="row" style={{ flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
          <label className="muted">
            printer hwid
            <input
              value={printerHwid}
              placeholder={POS_DEFAULT_HWID_HINT}
              disabled={!live}
              onChange={(e) => setPrinterHwid(e.target.value)}
              style={{ width: 100, marginLeft: 6 }}
            />
          </label>
          <label className="muted">
            payments hwid
            <input
              value={paymentsHwid}
              placeholder={POS_DEFAULT_HWID_HINT}
              disabled={!live}
              onChange={(e) => setPaymentsHwid(e.target.value)}
              style={{ width: 100, marginLeft: 6 }}
            />
          </label>
        </div>

        <div className="pos-status-grid">
          <StatusCard
            title="Printer"
            hwid={printerHwid || "—"}
            lines={[
              `connected: ${fmtBool(printerStatus?.connected)}`,
              `смена: ${posWorkdayLabel(printerStatus?.workday)}`,
              printerStatus?.message
                ? `msg: ${printerStatus.message}`
                : "msg: —",
            ]}
            ok={printerStatus?.connected === true}
            warn={printerStatus?.workday === "expired"}
          />
          <StatusCard
            title="Payments"
            hwid={paymentsHwid || "—"}
            lines={[
              // payments.status не отдаёт connected — связь/готовность = check.ready
              paymentsStatus?.connected != null
                ? `connected: ${fmtBool(paymentsStatus.connected)}`
                : `терминал: ${fmtReadyLine(paymentsCheck?.ready ?? paymentsStatus?.ready)}`,
              `ready (check): ${fmtBool(paymentsCheck?.ready ?? paymentsStatus?.ready)}`,
              `смена: ${posWorkdayLabel(paymentsStatus?.workday)}`,
              paymentsStatus?.openedAt != null
                ? `openedAt: ${String(paymentsStatus.openedAt)}`
                : "openedAt: —",
            ]}
            ok={
              paymentsCheck?.ready === true ||
              paymentsStatus?.ready === true ||
              paymentsStatus?.connected === true
            }
            warn={paymentsStatus?.workday === "expired"}
          />
          <StatusCard
            title="Host USB / systemd"
            hwid="complexos"
            lines={
              hostProbe
                ? hostProbe.lines
                : hostProbeError
                  ? [
                      `Проба SSH: ${hostProbeError}`,
                      "NATS printer/payments — в соседних карточках",
                      "Повтор: «Обновить health»",
                    ]
                  : live
                    ? [
                        "Жмите «Обновить health»",
                        "SSH: systemctl ft-printer-drv / ft-payments-drv",
                        "USB: ATOL 2912 · Kozen 0e8d · NIIMBOT 3513",
                      ]
                    : [
                        "Нужна сессия (LAN или Remote SSH)",
                        "Тогда health снимет systemctl + lsusb с complexos",
                        "Без сессии карточка не подсветится — это ожидаемо",
                      ]
            }
            ok={hostProbe?.level === "ok"}
            warn={hostProbe?.level === "warn"}
            error={hostProbe?.level === "error" || Boolean(hostProbeError)}
            stub={!hostProbe && !hostProbeError && !live}
          />
        </div>
      </div>

      <div className="panel panel-compact">
        <h2 className="row" style={{ gap: 8, alignItems: "center" }}>
          Сервис
          <HelpTip controlId="pos.unlock" />
        </h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
          Предпочитайте status/check (просмотр) перед commit/печатью. Charge и
          refund из SM не вызываем.
        </p>
        {!cashUnlocked ? (
          <div className="unlock-row">
            <div className="field field-compact">
              <label htmlFor="cash-unlock">Пароль</label>
              <input
                id="cash-unlock"
                type="password"
                value={password}
                autoComplete="off"
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void unlockCash();
                }}
              />
            </div>
            <ActionButton
              helpId="pos.unlock"
              variant="primary"
              onClick={() => void unlockCash()}
            >
              Разблокировать
            </ActionButton>
            {unlockError ? (
              <span className="badge danger">{unlockError}</span>
            ) : null}
          </div>
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
              <ActionButton
                helpId="pos.barcodeTest"
                disabled={dangerDisabled}
                onClick={askBarcodeTest}
              >
                Тест этикетки
              </ActionButton>
              <ActionButton
                helpId="pos.printerCommit"
                disabled={dangerDisabled}
                onClick={askPrinterCommit}
              >
                Закрыть смену ККТ
              </ActionButton>
              <ActionButton
                helpId="pos.paymentsCommit"
                disabled={dangerDisabled}
                onClick={askPaymentsCommit}
              >
                Закрыть смену эквайринга
              </ActionButton>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <ActionButton helpId="pos.unlock" onClick={lockCash}>
                Заблокировать
              </ActionButton>
            </div>
          </div>
        )}
      </div>

      <div className="panel panel-compact">
        <h2>Скоро / вне scope</h2>
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          <ActionButton helpId="pos.fnView" disabled>
            Статус ФН (VIEW)
          </ActionButton>
          <ActionButton helpId="pos.ofdSettings" disabled>
            ОФД / регистрация
          </ActionButton>
          <ActionButton helpId="pos.charge" disabled>
            Charge / refund
          </ActionButton>
          <ActionButton helpId="pos.factoryWipe" disabled>
            Factory wipe
          </ActionButton>
        </div>
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          «?» у каждой кнопки — почему недоступно. VIEW ФН/ОФД появится после
          расширения atol-fptr10.py + NATS.
        </p>
      </div>

      <div className="panel panel-compact">
        <div className="row sirup-log-head">
          <h2 style={{ margin: 0 }}>Лог действий</h2>
          <button
            type="button"
            className="btn btn-compact"
            onClick={() => setLog([])}
          >
            Очистить
          </button>
        </div>
        <pre className="sirup-action-log" ref={logElRef}>
          {log.length === 0
            ? "— пусто —"
            : log
                .map(
                  (e) =>
                    `${fmtTime(e.ts)} [${e.level}] ${e.text}`
                )
                .join("\n")}
        </pre>
      </div>

      <ConfirmModal
        open={pending != null}
        title={pending?.title ?? ""}
        danger={pending?.danger ?? ""}
        cheatSheet={pending?.cheatSheet}
        confirmLabel={pending?.confirmLabel}
        busy={busy != null}
        onCancel={() => setPending(null)}
        onConfirm={() => void runPending()}
      />
    </div>
  );
}

function StatusCard(props: {
  title: string;
  hwid: string;
  lines: string[];
  ok?: boolean;
  warn?: boolean;
  error?: boolean;
  stub?: boolean;
}) {
  const cls = posStatusCardClass(props);
  return (
    <div className={cls}>
      <div className="pos-status-card-title">
        {props.title}
        <span className="muted"> · {props.hwid}</span>
      </div>
      <ul>
        {props.lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </div>
  );
}
