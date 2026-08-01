/**
 * HTTP fetch DX UI (:8000 / туннель 8082–8083) из main — без CORS.
 * SSH fallback только после повторных fail HTTP (не блокирует coffee).
 */

import {
  dxUiSnapshotHasData,
  parseDxUiSnapshot,
  serviceUrlsForMode,
  type DxUiSnapshot,
  type SessionMode,
} from "@service-monitor/core";
import { fetchDxUiHtmlViaSsh } from "./drinkx-config";

export type DxUiModuleResult = DxUiSnapshot & {
  error?: string;
  via?: "http" | "ssh";
};

export type DxUiFetchResult = {
  milk: DxUiModuleResult;
  coffee: DxUiModuleResult;
};

async function fetchHtml(url: string, timeoutMs: number): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return await res.text();
}

const emptySnap = (): DxUiSnapshot => ({
  pump_R_IS: null,
  pump_L_IS: null,
  heater1_pwm: null,
  heater2_pwm: null,
});

const lastGood: Partial<Record<"milk" | "coffee", DxUiModuleResult>> = {};
const httpFailStreak: Partial<Record<"milk" | "coffee", number>> = {};
const lastSshAttemptMs: Partial<Record<"milk" | "coffee", number>> = {};
const SSH_COOLDOWN_MS = 8_000;
const SSH_AFTER_FAILS = 2;

let inFlight: Promise<DxUiFetchResult> | null = null;

async function fetchOneModule(
  mod: "milk" | "coffee",
  url: string,
  timeoutMs: number
): Promise<DxUiModuleResult> {
  let httpErr = "";
  try {
    const html = await fetchHtml(url, timeoutMs);
    const snap = parseDxUiSnapshot(html);
    if (dxUiSnapshotHasData(snap)) {
      httpFailStreak[mod] = 0;
      const ok: DxUiModuleResult = { ...snap, via: "http" };
      lastGood[mod] = ok;
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
  if (
    fails < SSH_AFTER_FAILS ||
    now - (lastSshAttemptMs[mod] ?? 0) < SSH_COOLDOWN_MS
  ) {
    if (lastGood[mod]) return { ...lastGood[mod]!, error: httpErr };
    return {
      ...emptySnap(),
      error: `${httpErr} · проверьте IP (milk=.44 coffee=.45 water=.46)`,
    };
  }

  lastSshAttemptMs[mod] = now;
  const ssh = await fetchDxUiHtmlViaSsh(mod);
  if (!ssh.ok) {
    if (lastGood[mod]) {
      return { ...lastGood[mod]!, error: `${httpErr}; SSH: ${ssh.error}` };
    }
    return {
      ...emptySnap(),
      error: `${httpErr}; SSH: ${ssh.error} · IP? milk=.44 coffee=.45`,
    };
  }
  const snap = parseDxUiSnapshot(ssh.html);
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
  return ok;
}

async function doFetch(
  mode: SessionMode | null | undefined,
  timeoutMs: number
): Promise<DxUiFetchResult> {
  const urls = serviceUrlsForMode(mode);
  const [milk, coffee] = await Promise.all([
    fetchOneModule("milk", urls.milkCharts, timeoutMs),
    fetchOneModule("coffee", urls.coffeeCharts, timeoutMs),
  ]);
  return { milk, coffee };
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
    errors: {
      milk: snap.milk.error,
      coffee: snap.coffee.error,
    } as Partial<Record<"milk" | "coffee", string>>,
  };
}
