/**
 * HTTP fetch DX UI (:8000 / туннель 8082–8084) из main — без CORS.
 * Stat-first: во время brew HTML раздувается pid-graph → читаем начало (temps/stat),
 * иначе timeout и токи «пропадают». Water тоже опрашиваем (americano).
 */

import {
  dxUiSnapshotHasData,
  parseDxUiSnapshot,
  serviceUrlsForMode,
  type DxUiSnapshot,
  type SessionMode,
} from "@service-monitor/core";
import { fetchDxUiHtmlViaSsh } from "./drinkx-config";

export type DxUiModuleId = "milk" | "coffee" | "water";

export type DxUiModuleResult = DxUiSnapshot & {
  error?: string;
  via?: "http" | "ssh";
};

export type DxUiFetchResult = Record<DxUiModuleId, DxUiModuleResult>;

async function fetchHtmlCapped(
  url: string,
  timeoutMs: number,
  maxBytes = 256_000
): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  if (!res.body) {
    const t = await res.text();
    return t.length > maxBytes ? t.slice(0, maxBytes) : t;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const divEnd = buf.indexOf("</div>");
      // temps/stat в первом <div> — для токов достаточно; graph огромный при brew
      if (divEnd >= 0 && buf.length >= Math.min(maxBytes, divEnd + 64)) {
        if (buf.length >= maxBytes) break;
        // ещё чуть-чуть на случай маленького graph для PWM
        if (buf.length >= 96_000) break;
      }
      if (buf.length >= maxBytes) break;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
  }
  return buf;
}

const emptySnap = (): DxUiSnapshot => ({
  pump_R_IS: null,
  pump_L_IS: null,
  heater1_pwm: null,
  heater2_pwm: null,
});

const lastGood: Partial<Record<DxUiModuleId, DxUiModuleResult>> = {};
const lastGoodAt: Partial<Record<DxUiModuleId, number>> = {};
const httpFailStreak: Partial<Record<DxUiModuleId, number>> = {};
const lastSshAttemptMs: Partial<Record<DxUiModuleId, number>> = {};
const SSH_COOLDOWN_MS = 8_000;
const SSH_AFTER_FAILS = 2;
/** lastGood для токов: чуть дольше, чтобы не мигать на краткий fail. */
const LAST_GOOD_MAX_AGE_MS = 8_000;

let inFlight: Promise<DxUiFetchResult> | null = null;

async function fetchOneModule(
  mod: DxUiModuleId,
  url: string,
  timeoutMs: number
): Promise<DxUiModuleResult> {
  let httpErr = "";
  try {
    const html = await fetchHtmlCapped(url, timeoutMs);
    const snap = parseDxUiSnapshot(html);
    if (dxUiSnapshotHasData(snap)) {
      httpFailStreak[mod] = 0;
      const ok: DxUiModuleResult = { ...snap, via: "http" };
      lastGood[mod] = ok;
      lastGoodAt[mod] = Date.now();
      return ok;
    }
    httpErr = `HTTP ok, пустой DX UI (${url})`;
    httpFailStreak[mod] = (httpFailStreak[mod] ?? 0) + 1;
  } catch (e) {
    httpErr = e instanceof Error ? e.message : String(e);
    httpFailStreak[mod] = (httpFailStreak[mod] ?? 0) + 1;
  }

  const fails = httpFailStreak[mod] ?? 0;
  const now = Date.now();
  const freshLast =
    lastGood[mod] &&
    now - (lastGoodAt[mod] ?? 0) < LAST_GOOD_MAX_AGE_MS
      ? lastGood[mod]
      : null;

  // SSH fallback только для milk/coffee (есть туннели :22044/:22045)
  if (mod === "water") {
    if (freshLast) return { ...freshLast, error: httpErr };
    return {
      ...emptySnap(),
      error: `${httpErr} · water=.46 / :8084`,
    };
  }

  if (
    fails < SSH_AFTER_FAILS ||
    now - (lastSshAttemptMs[mod] ?? 0) < SSH_COOLDOWN_MS
  ) {
    if (freshLast) return { ...freshLast, error: httpErr };
    return {
      ...emptySnap(),
      error: `${httpErr} · проверьте IP (milk=.44 coffee=.45 water=.46)`,
    };
  }

  lastSshAttemptMs[mod] = now;
  const ssh = await fetchDxUiHtmlViaSsh(mod);
  if (!ssh.ok) {
    if (freshLast) {
      return { ...freshLast, error: `${httpErr}; SSH: ${ssh.error}` };
    }
    return {
      ...emptySnap(),
      error: `${httpErr}; SSH: ${ssh.error} · IP? milk=.44 coffee=.45`,
    };
  }
  // SSH HTML тоже может быть огромным — режем
  const html =
    ssh.html.length > 256_000 ? ssh.html.slice(0, 256_000) : ssh.html;
  const snap = parseDxUiSnapshot(html);
  if (!dxUiSnapshotHasData(snap)) {
    return {
      ...emptySnap(),
      error: `${httpErr}; SSH HTML без pump/pwm`,
      via: "ssh",
    };
  }
  httpFailStreak[mod] = 0;
  const ok: DxUiModuleResult = { ...snap, via: "ssh" };
  lastGood[mod] = ok;
  lastGoodAt[mod] = Date.now();
  return ok;
}

async function doFetch(
  mode: SessionMode | null | undefined,
  timeoutMs: number
): Promise<DxUiFetchResult> {
  const urls = serviceUrlsForMode(mode);
  const [milk, coffee, water] = await Promise.all([
    fetchOneModule("milk", urls.milkCharts, timeoutMs),
    fetchOneModule("coffee", urls.coffeeCharts, timeoutMs),
    fetchOneModule("water", urls.waterCharts, timeoutMs),
  ]);
  return { milk, coffee, water };
}

export async function fetchDxUiSnapshots(
  mode: SessionMode | null | undefined,
  timeoutMs = 2_000
): Promise<DxUiFetchResult> {
  if (inFlight) return inFlight;
  inFlight = doFetch(mode, timeoutMs).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** @deprecated */
export async function fetchDxPumpCurrents(
  mode: SessionMode | null | undefined,
  timeoutMs = 2_000
) {
  const snap = await fetchDxUiSnapshots(mode, timeoutMs);
  return {
    milk: snap.milk.pump_R_IS,
    coffee: snap.coffee.pump_R_IS,
    water: snap.water.pump_R_IS,
    errors: {
      milk: snap.milk.error,
      coffee: snap.coffee.error,
      water: snap.water.error,
    } as Partial<Record<DxUiModuleId, string>>,
  };
}
