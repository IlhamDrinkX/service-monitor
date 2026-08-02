/**
 * Lab event log: pushLab / pushSensorSample / CSV export.
 */

import { useCallback, useRef, useState, type MutableRefObject } from "react";
import {
  createLabEvent,
  labEventsToCsv,
  seriesKey,
  trimLabEvents,
  type DrinkxHost,
  type LabEvent,
  type NatsMusterEntry,
} from "@service-monitor/core";
import { resolveHwid } from "./modulesLabHost";
import {
  labSensorDigits,
  shouldPushLabSensorSample,
} from "./labEventLogHelpers";
import type { ModulesLabPushSensorSample } from "./ModulesLabContext";

export function useLabEventLog(opts: {
  hostRef: MutableRefObject<DrinkxHost>;
  hwidRef: MutableRefObject<string>;
  modulesRef: MutableRefObject<NatsMusterEntry[]>;
  isSensorTracked: (mod: DrinkxHost, name: string) => boolean;
  getHost: () => DrinkxHost;
}) {
  const [labEvents, setLabEvents] = useState<LabEvent[]>([]);
  const lastSensorLog = useRef<Record<string, number>>({});

  const pushLab = useCallback(
    (
      kind: LabEvent["kind"],
      name: string,
      value: LabEvent["value"],
      detail?: string,
      moduleOverride?: DrinkxHost | string
    ) => {
      const mod = moduleOverride ?? opts.hostRef.current;
      const ev = createLabEvent({
        kind,
        module: mod,
        hwid:
          typeof mod === "string" &&
          (mod === "milk" || mod === "coffee" || mod === "water")
            ? resolveHwid(mod, opts.modulesRef.current)
            : opts.hwidRef.current,
        name,
        value,
        detail,
      });
      setLabEvents((prev) => trimLabEvents([...prev, ev]));
    },
    [opts.hostRef, opts.hwidRef, opts.modulesRef]
  );

  const pushSensorSample: ModulesLabPushSensorSample = useCallback(
    (mod, name, value, minDelta = 0.15, sampleOpts) => {
      const key = seriesKey(mod, name);
      const now = Date.now();
      if (
        !shouldPushLabSensorSample({
          name,
          value,
          minDelta,
          force: sampleOpts?.force,
          heartbeatMs: sampleOpts?.heartbeatMs,
          tracked: opts.isSensorTracked(mod, name),
          prevValue: lastSensorLog.current[key],
          prevAt: lastSensorLog.current[`${key}__t`],
          now,
        })
      ) {
        return;
      }
      // NaN sentinel = currently in gap (null samples).
      lastSensorLog.current[key] = value == null ? Number.NaN : value;
      lastSensorLog.current[`${key}__t`] = now;
      if (value == null) {
        pushLab(
          "sensor",
          name,
          null,
          sampleOpts?.detail ?? "telemetry gap",
          mod
        );
        return;
      }
      const digits = labSensorDigits(name, sampleOpts?.digits);
      pushLab("sensor", name, Number(value.toFixed(digits)), undefined, mod);
    },
    [opts.isSensorTracked, pushLab]
  );

  const exportLabLog = useCallback(() => {
    const csv = labEventsToCsv(labEvents);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `modules-lab-${opts.getHost()}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    pushLab("system", "export", labEvents.length, a.download);
    return labEvents.length;
  }, [labEvents, opts.getHost, pushLab]);

  const clearLabLog = useCallback(() => {
    setLabEvents([]);
    pushLab("system", "clear", 0);
  }, [pushLab]);

  return {
    labEvents,
    setLabEvents,
    pushLab,
    pushSensorSample,
    lastSensorLog,
    exportLabLog,
    clearLabLog,
  };
}
