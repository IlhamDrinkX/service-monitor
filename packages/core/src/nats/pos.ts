/**
 * ComplexOS printer / payments (ft-printer-drv / ft-payments-drv).
 * Subjects — только из printer-drv.js / payments-drv.js (не выдумывать).
 */

export const PRINTER_SUBJECTS = {
  muster: "complexos.printer.muster",
  status: (hwid: string) => `complexos.printer.status.${hwid}`,
  commit: (hwid: string) => `complexos.printer.commit.${hwid}`,
  printCheque: (hwid: string) => `complexos.printer.print-cheque.${hwid}`,
  printRefund: (hwid: string) => `complexos.printer.print-refund.${hwid}`,
} as const;

export const PAYMENTS_SUBJECTS = {
  muster: "complexos.payments.muster",
  status: (hwid: string) => `complexos.payments.status.${hwid}`,
  check: (hwid: string) => `complexos.payments.check.${hwid}`,
  commit: (hwid: string) => `complexos.payments.commit.${hwid}`,
  charge: (hwid: string) => `complexos.payments.charge.${hwid}`,
  refund: (hwid: string) => `complexos.payments.refund.${hwid}`,
} as const;

/** Типичный hwid на DrinkX 4.x (после muster). */
export const POS_DEFAULT_HWID_HINT = "kiosk2";

/** Тестовый barcode для NIIMBOT / --format=barcode (не фискал). */
export const POS_BARCODE_TEST = {
  barcode: "TEST1234567890",
  ordernumber: "0",
} as const;

export type PosWorkday = "open" | "closed" | "expired" | string;

export type PrinterStatusReply = {
  success?: boolean;
  connected?: boolean;
  workday?: PosWorkday;
  error?: boolean;
  message?: string;
  raw?: Record<string, unknown>;
};

export type PaymentsStatusReply = {
  success?: boolean;
  connected?: boolean;
  ready?: boolean;
  workday?: PosWorkday;
  openedAt?: string | number;
  error?: boolean;
  message?: string;
  raw?: Record<string, unknown>;
};

export type PaymentsCheckReply = {
  success?: boolean;
  ready?: boolean;
  error?: boolean;
  message?: string;
  raw?: Record<string, unknown>;
};

export type PosActionReply = {
  success?: boolean;
  error?: boolean;
  message?: string;
  raw?: Record<string, unknown>;
};

function unwrapResult(data: unknown): Record<string, unknown> | null {
  if (data == null) return null;
  if (typeof data === "string") {
    const t = data.trim();
    if (!t) return null;
    try {
      const parsed = JSON.parse(t) as unknown;
      if (parsed != null && typeof parsed === "object") {
        return unwrapResult(parsed);
      }
      return { value: parsed };
    } catch {
      return { value: t };
    }
  }
  if (typeof data !== "object") return { value: data };
  const o = data as Record<string, unknown>;
  if (o.result != null && typeof o.result === "object") {
    return o.result as Record<string, unknown>;
  }
  return o;
}

/** Normalize muster reply → hwid string (обычно "kiosk2"). */
export function parsePosHwid(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return null;
    try {
      const parsed = JSON.parse(t) as unknown;
      if (typeof parsed === "number" && Number.isFinite(parsed)) {
        return String(parsed);
      }
      if (typeof parsed === "string" && parsed.trim()) return parsed.trim();
    } catch {
      /* plain */
    }
    return t.replace(/^"+|"+$/g, "");
  }
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (o.hwid != null) return parsePosHwid(o.hwid);
    if (o.result != null) return parsePosHwid(o.result);
    if (o.value != null) return parsePosHwid(o.value);
  }
  return null;
}

export function parsePosMusterReplies(replies: unknown[]): string[] {
  const set = new Set<string>();
  for (const r of replies) {
    const id = parsePosHwid(r);
    if (id) set.add(id);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

function readBool(
  obj: Record<string, unknown>,
  key: string
): boolean | undefined {
  const v = obj[key];
  if (typeof v === "boolean") return v;
  return undefined;
}

export function parsePrinterStatusReply(data: unknown): PrinterStatusReply {
  const result = unwrapResult(data);
  if (!result) return { error: true, message: "empty status" };
  const err =
    result.error === true ||
    (typeof result.message === "string" &&
      result.success !== true &&
      result.connected == null &&
      result.workday == null);
  return {
    success: result.success === true || (!err && (result.connected != null || result.workday != null)),
    connected: readBool(result, "connected"),
    workday:
      result.workday != null ? String(result.workday) : undefined,
    error: err || undefined,
    message:
      typeof result.message === "string" ? result.message : undefined,
    raw: result,
  };
}

export function parsePaymentsStatusReply(data: unknown): PaymentsStatusReply {
  const result = unwrapResult(data);
  if (!result) return { error: true, message: "empty status" };
  const err =
    result.error === true ||
    (typeof result.message === "string" &&
      result.success !== true &&
      result.workday == null &&
      result.connected == null &&
      result.ready == null);
  return {
    success:
      result.success === true ||
      (!err &&
        (result.workday != null ||
          result.connected != null ||
          result.ready != null ||
          result.status != null)),
    connected: readBool(result, "connected"),
    ready: readBool(result, "ready"),
    workday:
      result.workday != null ? String(result.workday) : undefined,
    openedAt:
      typeof result.openedAt === "string" || typeof result.openedAt === "number"
        ? result.openedAt
        : undefined,
    error: err || undefined,
    message:
      typeof result.message === "string" ? result.message : undefined,
    raw: result,
  };
}

export function parsePaymentsCheckReply(data: unknown): PaymentsCheckReply {
  const result = unwrapResult(data);
  if (!result) return { error: true, message: "empty check" };
  const err = result.error === true;
  return {
    success: result.success === true || (!err && result.ready != null),
    ready: readBool(result, "ready"),
    error: err || undefined,
    message:
      typeof result.message === "string" ? result.message : undefined,
    raw: result,
  };
}

export function parsePosActionReply(data: unknown): PosActionReply {
  const result = unwrapResult(data);
  if (!result) return { error: true, message: "empty reply" };
  if (result.error === true) {
    return {
      error: true,
      message:
        typeof result.message === "string" ? result.message : "error",
      raw: result,
    };
  }
  return {
    success: result.success !== false,
    message:
      typeof result.message === "string" ? result.message : undefined,
    raw: result,
  };
}

/** Payload теста этикетки (--format=barcode / NIIMBOT). */
export function posBarcodeTestPayload(input?: {
  barcode?: string;
  ordernumber?: string;
}): { barcode: string; ordernumber: string } {
  const barcode = (input?.barcode ?? POS_BARCODE_TEST.barcode).trim();
  const ordernumber = String(
    input?.ordernumber ?? POS_BARCODE_TEST.ordernumber
  ).trim();
  return {
    barcode: barcode || POS_BARCODE_TEST.barcode,
    ordernumber: ordernumber || POS_BARCODE_TEST.ordernumber,
  };
}

export function posWorkdayLabel(workday: PosWorkday | undefined): string {
  switch (workday) {
    case "open":
      return "открыта";
    case "closed":
      return "закрыта";
    case "expired":
      return "истекла (>24ч)";
    default:
      return workday ? String(workday) : "—";
  }
}

/**
 * Предупреждение: side-effect только при workday=expired (не при closed/open).
 * closed после Z / ночи — норма; смена ККТ обычно откроется на следующей печати/продаже.
 */
export const POS_STATUS_AUTO_COMMIT_WARNING =
  "Side-effect: если смена уже «истекла» (>24ч), printer.status / payments.status на драйвере могут сами сделать commit. При «закрыта»/«открыта» опрос status смену не закрывает. Это complexos, не SM.";

export function formatPosStatusLine(
  kind: "printer" | "payments",
  status: PrinterStatusReply | PaymentsStatusReply
): string {
  const parts: string[] = [kind];
  if (status.connected != null) {
    parts.push(status.connected ? "connected" : "disconnected");
  }
  if ("ready" in status && status.ready != null) {
    parts.push(status.ready ? "ready" : "not-ready");
  }
  if (status.workday != null) {
    parts.push(`смена: ${posWorkdayLabel(status.workday)}`);
  }
  if (
    kind === "payments" &&
    "openedAt" in status &&
    status.openedAt != null
  ) {
    parts.push(`openedAt=${String(status.openedAt)}`);
  }
  if (status.message) parts.push(status.message);
  if (status.error) parts.push("ошибка");
  return parts.join(" · ");
}

/** Read-only SSH на complexos: active units + USB vendor IDs. */
export const POS_HOST_PROBE_CMD = [
  'echo "###UNITS###"',
  "systemctl is-active ft-printer-drv 2>/dev/null || echo unknown",
  "systemctl is-active ft-payments-drv 2>/dev/null || echo unknown",
  'echo "###USB###"',
  "lsusb 2>/dev/null || true",
].join("; ");

export type PosUnitActiveState =
  | "active"
  | "inactive"
  | "failed"
  | "activating"
  | "deactivating"
  | "unknown"
  | string;

export type PosHostProbeLevel = "ok" | "warn" | "error";

export type PosHostUsbFlags = {
  atol: boolean;
  kozen: boolean;
  niimbot: boolean;
};

export type PosHostProbe = {
  printerUnit: PosUnitActiveState;
  paymentsUnit: PosUnitActiveState;
  usb: PosHostUsbFlags;
  level: PosHostProbeLevel;
  lines: string[];
};

function normalizeUnitState(raw: string): PosUnitActiveState {
  const s = raw.trim().toLowerCase();
  if (!s) return "unknown";
  return s;
}

function unitOk(state: PosUnitActiveState): boolean {
  return state === "active";
}

function scorePosHostProbe(
  printerUnit: PosUnitActiveState,
  paymentsUnit: PosUnitActiveState,
  usb: PosHostUsbFlags
): PosHostProbeLevel {
  const anyFailed =
    printerUnit === "failed" || paymentsUnit === "failed";
  const bothDown = !unitOk(printerUnit) && !unitOk(paymentsUnit);
  if (anyFailed || bothDown) return "error";
  const usbAny = usb.atol || usb.kozen || usb.niimbot;
  if (!unitOk(printerUnit) || !unitOk(paymentsUnit) || !usbAny) {
    return "warn";
  }
  return "ok";
}

function usbLine(usb: PosHostUsbFlags): string {
  const parts = [
    `ATOL 2912: ${usb.atol ? "да" : "нет"}`,
    `Kozen 0e8d: ${usb.kozen ? "да" : "нет"}`,
    `NIIMBOT 3513: ${usb.niimbot ? "да" : "нет"}`,
  ];
  return parts.join(" · ");
}

/**
 * Разбор stdout SSH-пробы (см. POS_HOST_PROBE_CMD).
 */
export function parsePosHostProbeOutput(stdout: string): PosHostProbe {
  const text = String(stdout ?? "").replace(/\r\n/g, "\n");
  const unitsIdx = text.indexOf("###UNITS###");
  const usbIdx = text.indexOf("###USB###");
  let printerUnit: PosUnitActiveState = "unknown";
  let paymentsUnit: PosUnitActiveState = "unknown";
  if (unitsIdx >= 0) {
    const end = usbIdx >= 0 ? usbIdx : text.length;
    const block = text.slice(unitsIdx + "###UNITS###".length, end);
    const lines = block
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines[0]) printerUnit = normalizeUnitState(lines[0]);
    if (lines[1]) paymentsUnit = normalizeUnitState(lines[1]);
  }
  const usbBlock =
    usbIdx >= 0 ? text.slice(usbIdx + "###USB###".length) : text;
  const lower = usbBlock.toLowerCase();
  const usb: PosHostUsbFlags = {
    atol: /2912/.test(lower),
    kozen: /0e8d/.test(lower),
    niimbot: /3513/.test(lower),
  };
  const level = scorePosHostProbe(printerUnit, paymentsUnit, usb);
  const lines = [
    `ft-printer-drv: ${printerUnit}`,
    `ft-payments-drv: ${paymentsUnit}`,
    usbLine(usb),
  ];
  return { printerUnit, paymentsUnit, usb, level, lines };
}

export function formatPosHostProbeLog(probe: PosHostProbe): string {
  return `host USB/systemd · ${probe.level} · ${probe.lines.join(" · ")}`;
}
