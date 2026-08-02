/**
 * React binding for LabTelemetryController.
 */

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import {
  emptyLabSnapshot,
  type DrinkxHost,
  type LabSnapshot,
} from "@service-monitor/core";
import { LabTelemetryController } from "./LabTelemetryController";

export function useLabTelemetry(opts: {
  live: boolean;
  getActiveHost: () => DrinkxHost;
  resolveHwid: (host: DrinkxHost) => string;
  getSessionMode: () => "remote" | "local" | null | undefined;
  valveHoldUntil?: Map<string, number>;
  isModuleTracked?: (host: DrinkxHost) => boolean;
  /** XOR laptop/onboard: reduce laptop poll cadence (see shouldThrottleLabPoll in core). */
  throttled?: boolean;
}): {
  snap: LabSnapshot;
  controllerRef: MutableRefObject<LabTelemetryController | null>;
} {
  const [snap, setSnap] = useState<LabSnapshot>(emptyLabSnapshot);
  const controllerRef = useRef<LabTelemetryController | null>(null);
  const depsRef = useRef({
    getActiveHost: opts.getActiveHost,
    resolveHwid: opts.resolveHwid,
    getSessionMode: opts.getSessionMode,
    valveHoldUntil: opts.valveHoldUntil,
    isModuleTracked: opts.isModuleTracked,
  });
  depsRef.current.getActiveHost = opts.getActiveHost;
  depsRef.current.resolveHwid = opts.resolveHwid;
  depsRef.current.getSessionMode = opts.getSessionMode;
  depsRef.current.valveHoldUntil = opts.valveHoldUntil;
  depsRef.current.isModuleTracked = opts.isModuleTracked;

  useEffect(() => {
    if (!opts.live) {
      controllerRef.current?.stop();
      controllerRef.current = null;
      setSnap(emptyLabSnapshot());
      return;
    }

    const ctrl = new LabTelemetryController({
      getActiveHost: () => depsRef.current.getActiveHost(),
      resolveHwid: (h) => depsRef.current.resolveHwid(h),
      getSessionMode: () => depsRef.current.getSessionMode(),
      valveHoldUntil: depsRef.current.valveHoldUntil,
      isModuleTracked: (h) => depsRef.current.isModuleTracked?.(h) !== false,
    });
    ctrl.setThrottled(opts.throttled === true);
    controllerRef.current = ctrl;
    const unsub = ctrl.subscribe(setSnap);
    ctrl.start();
    return () => {
      unsub();
      ctrl.stop();
      if (controllerRef.current === ctrl) controllerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.live]);

  // XOR laptop/onboard: apply cadence changes to the running controller
  // without tearing it down (recreating would reset generations/pause state).
  useEffect(() => {
    controllerRef.current?.setThrottled(opts.throttled === true);
  }, [opts.throttled]);

  return { snap, controllerRef };
}
