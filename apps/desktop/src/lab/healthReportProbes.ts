/**
 * Health Report — сбор сырых данных со всего комплекса через уже
 * существующие IPC-методы `window.desktop.*` (никаких новых main/preload
 * каналов не требуется). Каждый пробник изолированно soft-fail'ится —
 * падение одного не должно портить остальные разделы отчёта.
 *
 * Разбор ответов делаем здесь же существующими парсерами core
 * (`parseComplexStatusTuple`, `parseSirupStatusReply`, …), а
 * `buildHealthReport()` (core) остаётся чистой функцией без сети.
 */

import {
  COMPLEXOS_SUBJECTS,
  NATS_SUBJECTS,
  PAYMENTS_SUBJECTS,
  POS_DEFAULT_HWID_HINT,
  PRINTER_SUBJECTS,
  SIRUP_SUBJECTS,
  classifySirupStatusFailure,
  parseComplexStatusTuple,
  parsePaymentsCheckReply,
  parsePaymentsStatusReply,
  parsePosMusterReplies,
  parsePrinterStatusReply,
  parseSirupMusterReplies,
  parseSirupStatusReply,
  type ComplexSessionSnapshot,
  type HealthReportInput,
} from "@service-monitor/core";

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Sirup spot-check: at most this many motors, sequentially (avoid bus overload). */
const SIRUP_SAMPLE_MAX = 3;
const MUSTER_TIMEOUT_MS = 1_500;
const STATUS_TIMEOUT_MS = 2_000;
const DX_TIMEOUT_MS = 3_000;
const COMPLEXOS_TIMEOUT_MS = 4_000;
const SIRUP_STATUS_TIMEOUT_MS = 1_200;

async function safe<T>(fn: () => Promise<T>): Promise<T | { ok: false; error: string }> {
  try {
    return await fn();
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
}

async function natsReq(subject: string, payload: unknown, timeoutMs: number) {
  return safe(() =>
    window.desktop.natsRequest({ subject, payload, timeoutMs, priority: "poll" })
  );
}

async function natsReqMany(subject: string, payload: unknown, timeoutMs: number) {
  return safe(() =>
    window.desktop.natsRequestMany({ subject, payload, timeoutMs, priority: "poll" })
  );
}

async function gatherMuster(): Promise<HealthReportInput["muster"]> {
  const res = await safe(() => window.desktop.natsMuster(MUSTER_TIMEOUT_MS));
  if (!res.ok) return { ok: false, modules: [], error: res.error };
  return { ok: true, modules: res.modules };
}

async function gatherStatusTuple(): Promise<HealthReportInput["statusTuple"]> {
  const res = await natsReqMany(NATS_SUBJECTS.status, {}, STATUS_TIMEOUT_MS);
  if (!res.ok) return { ok: false, error: res.error };
  const replies = res.replies ?? [];
  if (replies.length === 0) {
    return { ok: false, error: "no replies" };
  }
  return { ok: true, tuple: parseComplexStatusTuple(replies) };
}

async function gatherDx(
  mode: ComplexSessionSnapshot["mode"]
): Promise<HealthReportInput["dx"]> {
  const res = await safe(() =>
    window.desktop.dxUiPumpCurrents({ mode, timeoutMs: DX_TIMEOUT_MS })
  );
  // The generic safe() catch-fallback ({ok:false,error}) has no milk/coffee/water
  // at all — distinguish it from a handled ok:false (which still carries per-host
  // nulls) via the "milk" key, not "ok" (both branches always have "ok").
  if (!("milk" in res)) return { ok: false, error: res.error };
  if (!res.ok) return { ok: false, error: res.error, data: res };
  return { ok: true, data: res };
}

async function gatherComplexOs(): Promise<HealthReportInput["complexOs"]> {
  const res = await natsReq(COMPLEXOS_SUBJECTS.status, {}, COMPLEXOS_TIMEOUT_MS);
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true };
}

async function gatherSirup(): Promise<HealthReportInput["sirup"]> {
  const musterRes = await natsReqMany(SIRUP_SUBJECTS.muster, {}, MUSTER_TIMEOUT_MS);
  if (!musterRes.ok) return { ok: false, error: musterRes.error, hwids: [], sample: [] };
  const hwids = parseSirupMusterReplies(musterRes.replies ?? []);
  const sample: NonNullable<HealthReportInput["sirup"]>["sample"] = [];
  for (const hwid of hwids.slice(0, SIRUP_SAMPLE_MAX)) {
    const r = await natsReq(SIRUP_SUBJECTS.status(hwid), {}, SIRUP_STATUS_TIMEOUT_MS);
    if (!r.ok) {
      sample.push({ hwid, kind: classifySirupStatusFailure(r.error), message: r.error });
      continue;
    }
    const parsed = parseSirupStatusReply(r.data);
    sample.push(
      parsed.error
        ? { hwid, kind: "error", message: parsed.message }
        : { hwid, kind: "ok", status: parsed.status }
    );
  }
  return { ok: true, hwids, sample };
}

async function gatherPos(): Promise<HealthReportInput["pos"]> {
  const [pMuster, payMuster] = await Promise.all([
    natsReqMany(PRINTER_SUBJECTS.muster, {}, MUSTER_TIMEOUT_MS),
    natsReqMany(PAYMENTS_SUBJECTS.muster, {}, MUSTER_TIMEOUT_MS),
  ]);
  const printerMusterOk = pMuster.ok;
  const paymentsMusterOk = payMuster.ok;
  const pIds = pMuster.ok ? parsePosMusterReplies(pMuster.replies ?? []) : [];
  const payIds = payMuster.ok ? parsePosMusterReplies(payMuster.replies ?? []) : [];
  const pH = pIds[0] || POS_DEFAULT_HWID_HINT;
  const payH = payIds[0] || pH;

  const [pSt, paySt, payCk, hostProbe] = await Promise.all([
    printerMusterOk ? natsReq(PRINTER_SUBJECTS.status(pH), {}, STATUS_TIMEOUT_MS) : null,
    paymentsMusterOk ? natsReq(PAYMENTS_SUBJECTS.status(payH), {}, STATUS_TIMEOUT_MS) : null,
    paymentsMusterOk ? natsReq(PAYMENTS_SUBJECTS.check(payH), {}, STATUS_TIMEOUT_MS) : null,
    typeof window.desktop.posProbeHost === "function"
      ? safe(() => window.desktop.posProbeHost())
      : Promise.resolve(null),
  ]);

  const result: NonNullable<HealthReportInput["pos"]> = {
    printerMusterOk,
    paymentsMusterOk,
  };
  if (pSt?.ok) result.printer = parsePrinterStatusReply(pSt.data);
  if (paySt?.ok) result.payments = parsePaymentsStatusReply(paySt.data);
  if (payCk?.ok) result.paymentsCheck = parsePaymentsCheckReply(payCk.data);
  if (hostProbe && "ok" in hostProbe) {
    if (hostProbe.ok) result.hostProbe = hostProbe.probe;
    else result.hostProbeError = hostProbe.error;
  }
  return result;
}

async function gatherLabLogger(): Promise<HealthReportInput["labLogger"]> {
  const res = await safe(() => window.desktop.labLoggerStatus());
  if (!res.ok) return { installed: false, error: res.error };
  return { installed: res.status.installed, status: res.status };
}

/**
 * Собирает всё нужное для `buildHealthReport()`. Если сессия не подключена —
 * возвращает input с `session.connected=false` без единого сетевого вызова
 * (buildHealthReport сам пометит остальные разделы как "не проверено").
 */
export async function gatherHealthReportInput(
  session: ComplexSessionSnapshot
): Promise<HealthReportInput> {
  if (!session.connected) {
    return {
      session: {
        connected: false,
        mode: session.mode,
        natsOnline: session.natsOnline,
      },
      muster: null,
      statusTuple: null,
      dx: null,
      complexOs: null,
      sirup: null,
      pos: null,
      labLogger: null,
      topology: null,
    };
  }

  const [muster, statusTuple, dx, complexOs, sirup, pos, labLogger] =
    await Promise.all([
      gatherMuster(),
      gatherStatusTuple(),
      gatherDx(session.mode),
      gatherComplexOs(),
      gatherSirup(),
      gatherPos(),
      gatherLabLogger(),
    ]);

  return {
    session: {
      connected: true,
      mode: session.mode,
      natsOnline: session.natsOnline,
    },
    muster,
    statusTuple,
    dx,
    complexOs,
    sirup,
    pos,
    labLogger,
    topology: session.mode === "local" ? { devices: session.devices ?? [] } : null,
  };
}
