/**
 * ComplexOS sirup / dispenser motors (sirup-4.0 via cupstorage-drv --sirup4).
 * Field path: NATS on complexos — not Host dozator / flash-cli.
 */

export const SIRUP_SUBJECTS = {
  muster: "complexos.sirup.muster",
  status: (hwid: string | number) => `complexos.sirup.status.${hwid}`,
  pump: (hwid: string | number) => `complexos.sirup.pump.${hwid}`,
  unpump: (hwid: string | number) => `complexos.sirup.unpump.${hwid}`,
  stop: (hwid: string | number) => `complexos.sirup.stop.${hwid}`,
} as const;

export type SirupMotorStatus =
  | "forward"
  | "reverse"
  | "stopped"
  | "unknown"
  | string;

export type SirupStatusReply = {
  success?: boolean;
  hwid?: string | number;
  status?: SirupMotorStatus;
  error?: boolean;
  message?: string;
};

export type SirupPumpReply = {
  success?: boolean;
  seconds?: number;
  hwRestarted?: boolean;
  error?: boolean;
  message?: string;
};

export type SirupMotorAction = "pump" | "unpump" | "stop" | "status";

/** Normalize muster reply cell → hwid string (JSON "5" or plain 5 / "sirup5"). */
export function parseSirupHwid(raw: unknown): string | null {
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
      /* plain string */
    }
    return t.replace(/^"+|"+$/g, "");
  }
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (o.hwid != null) return parseSirupHwid(o.hwid);
    if (o.result != null) return parseSirupHwid(o.result);
  }
  return null;
}

/** Unique sorted hwids from requestMany muster replies. */
export function parseSirupMusterReplies(replies: unknown[]): string[] {
  const set = new Set<string>();
  for (const r of replies) {
    const id = parseSirupHwid(r);
    if (id) set.add(id);
  }
  return [...set].sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return a.localeCompare(b);
  });
}

export function parseSirupStatusReply(data: unknown): SirupStatusReply {
  if (data == null || typeof data !== "object") {
    return { error: true, message: "empty status" };
  }
  const o = data as Record<string, unknown>;
  const result =
    o.result != null && typeof o.result === "object"
      ? (o.result as Record<string, unknown>)
      : o;
  const status =
    result.status != null ? String(result.status) : undefined;
  const hwid =
    result.hwid != null
      ? parseSirupHwid(result.hwid) ?? undefined
      : undefined;
  const err =
    result.error === true ||
    o.error === true ||
    (typeof result.message === "string" &&
      result.success !== true &&
      !status);
  return {
    success: result.success === true || (!err && status != null),
    hwid,
    status,
    error: err || undefined,
    message:
      typeof result.message === "string"
        ? result.message
        : typeof o.message === "string"
          ? o.message
          : undefined,
  };
}

export function parseSirupPumpReply(data: unknown): SirupPumpReply {
  if (data == null || typeof data !== "object") {
    return { error: true, message: "empty reply" };
  }
  const o = data as Record<string, unknown>;
  const result =
    o.result != null && typeof o.result === "object"
      ? (o.result as Record<string, unknown>)
      : o;
  if (result.error === true || o.error === true) {
    return {
      error: true,
      message:
        typeof result.message === "string"
          ? result.message
          : typeof o.message === "string"
            ? o.message
            : "error",
    };
  }
  return {
    success: result.success !== false,
    seconds:
      typeof result.seconds === "number" ? result.seconds : undefined,
    hwRestarted:
      typeof result.hwRestarted === "boolean"
        ? result.hwRestarted
        : undefined,
  };
}

export function sirupPumpPayload(input: {
  seconds: number;
  intensity?: number;
}): { seconds: number; intensity: number } {
  const rawSec = Number(input.seconds);
  const seconds = Math.max(
    0.1,
    Math.min(120, Number.isFinite(rawSec) ? rawSec : 1)
  );
  const rawInt = Number(input.intensity ?? 100);
  const intensity = Math.max(
    0,
    Math.min(100, Number.isFinite(rawInt) ? rawInt : 100)
  );
  return { seconds, intensity };
}

/** Human label for motor status lamp. */
export function sirupStatusLabel(status: SirupMotorStatus | undefined): string {
  switch (status) {
    case "forward":
      return "вперёд";
    case "reverse":
      return "назад";
    case "stopped":
      return "стоп";
    case "unknown":
      return "нет ответа";
    default:
      return status ? String(status) : "—";
  }
}

/** Outcome of one motor status poll (poll-all or single). */
export type SirupPollOutcomeKind = "ok" | "timeout" | "error";

export type SirupPollItem = {
  hwid: string;
  kind: SirupPollOutcomeKind;
  /** Present when kind === "ok" (or error with a status body). */
  status?: SirupMotorStatus;
  message?: string;
};

/** NATS / IPC timeout strings look like `complexos.sirup.status.4 timeout 1200ms`. */
export function isSirupStatusTimeout(errorText: string): boolean {
  return /\btimeout\b/i.test(errorText);
}

export function classifySirupStatusFailure(
  errorText: string
): SirupPollOutcomeKind {
  return isSirupStatusTimeout(errorText) ? "timeout" : "error";
}

/**
 * Format hwids as compact ranges: `1–3, 5, 10–12`.
 * Non-numeric ids stay as-is (sorted among themselves after numerics).
 */
export function formatSirupIdRanges(hwids: string[]): string {
  if (hwids.length === 0) return "";
  const nums: number[] = [];
  const other: string[] = [];
  for (const id of hwids) {
    const n = Number(id);
    if (Number.isFinite(n) && String(n) === id) nums.push(n);
    else other.push(id);
  }
  nums.sort((a, b) => a - b);
  other.sort((a, b) => a.localeCompare(b));

  const parts: string[] = [];
  let i = 0;
  while (i < nums.length) {
    const start = nums[i]!;
    let end = start;
    while (i + 1 < nums.length && nums[i + 1]! === end + 1) {
      i += 1;
      end = nums[i]!;
    }
    parts.push(start === end ? String(start) : `${start}–${end}`);
    i += 1;
  }
  parts.push(...other);
  return parts.join(", ");
}

export type SirupPollSummary = {
  okCount: number;
  timeoutCount: number;
  errorCount: number;
  /** e.g. `ответили: 1–3 (стоп) · нет ответа: 4–30` */
  summaryLine: string;
  /** One line per ok motor for the action log. */
  okLines: string[];
  /** Collapsed no-reply line, or null if none. */
  noReplyLine: string | null;
  /** Non-timeout errors (kept verbose; usually few). */
  errorLines: string[];
  /**
   * Field hint when many timeouts: physically missing motors time out;
   * dashboard-blocked ones can still answer when polled gently (muster may
   * list all MAX_MOTORS slots either way).
   */
  fieldNote: string | null;
};

/**
 * Summarize poll-all results for field techs.
 * Does not invent blocked vs absent — a status timeout may be either, or a
 * bus overload from parallel poll (prefer sequential «Опрос всех»).
 */
export function summarizeSirupPollResults(
  items: SirupPollItem[]
): SirupPollSummary {
  const ok = items.filter((x) => x.kind === "ok");
  const timeouts = items.filter((x) => x.kind === "timeout");
  const errors = items.filter((x) => x.kind === "error");

  const okLines = ok.map(
    (x) =>
      `#${x.hwid} · ${sirupStatusLabel(x.status)}${
        x.message ? ` · ${x.message}` : ""
      }`
  );

  // Group ok ids by status label for the summary phrase.
  const byStatus = new Map<string, string[]>();
  for (const x of ok) {
    const label = sirupStatusLabel(x.status);
    const list = byStatus.get(label) ?? [];
    list.push(x.hwid);
    byStatus.set(label, list);
  }
  const answeredParts: string[] = [];
  for (const [label, ids] of byStatus) {
    const ranges = formatSirupIdRanges(ids);
    answeredParts.push(ranges ? `${ranges} (${label})` : label);
  }
  const answered =
    answeredParts.length > 0
      ? `ответили: ${answeredParts.join(", ")}`
      : null;

  const noReplyRanges = formatSirupIdRanges(timeouts.map((x) => x.hwid));
  const noReplyLine =
    timeouts.length > 0
      ? `нет ответа: ${noReplyRanges} (${timeouts.length})`
      : null;

  const errorLines = errors.map(
    (x) =>
      `#${x.hwid} · ошибка · ${x.message ?? "error"}`
  );
  const errorRanges = formatSirupIdRanges(errors.map((x) => x.hwid));
  const errorPart =
    errors.length > 0
      ? `ошибка: ${errorRanges} (${errors.length})`
      : null;

  const summaryLine = [answered, noReplyLine, errorPart]
    .filter(Boolean)
    .join(" · ");

  const fieldNote =
    timeouts.length > 0
      ? "Физически отсутствующие моторы дают status timeout; заблокированные в дашборде часто отвечают при спокойном (последовательном) опросе. Muster может вернуть все 30 id (MAX_MOTORS) — сверьте слоты с дашбордом."
      : null;

  return {
    okCount: ok.length,
    timeoutCount: timeouts.length,
    errorCount: errors.length,
    summaryLine: summaryLine || "опрос пуст",
    okLines,
    noReplyLine,
    errorLines,
    fieldNote,
  };
}
