/**
 * Lightweight, low-frequency poll of onboard lab-logger readiness — feeds the
 * laptop/onboard XOR (shouldThrottleLabPoll, core). Independent of whether the
 * user has the "Бортовой лог" tab open. Soft-fails like every other lab probe;
 * on any error/timeout treats onboard as "not ready" (falls back to dense poll).
 *
 * `enabled` should be false when the XOR mode is "dense" (laptop always full
 * rate) — no reason to spend an extra SSH round-trip on a status probe whose
 * result would never be used.
 */
import { useEffect, useRef, useState } from "react";
import {
  isLabLoggerRealtimeReady,
  isSeries4ForLabLogger,
} from "@service-monitor/core";

const POLL_MS = 20_000;

export function useOnboardRealtimeGate(opts: {
  live: boolean;
  seriesLabel: string | null | undefined;
  enabled: boolean;
}): boolean {
  const [ready, setReady] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    const eligible =
      opts.enabled && opts.live && isSeries4ForLabLogger(opts.seriesLabel);
    if (!eligible) {
      setReady(false);
      return;
    }
    let cancelled = false;

    const check = async () => {
      if (busyRef.current) return;
      if (typeof window.desktop.labLoggerStatus !== "function") return;
      busyRef.current = true;
      try {
        const res = await window.desktop.labLoggerStatus();
        if (cancelled) return;
        setReady(res.ok ? isLabLoggerRealtimeReady(res.status) : false);
      } catch {
        if (!cancelled) setReady(false);
      } finally {
        busyRef.current = false;
      }
    };

    void check();
    const id = window.setInterval(() => void check(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [opts.enabled, opts.live, opts.seriesLabel]);

  return ready;
}
