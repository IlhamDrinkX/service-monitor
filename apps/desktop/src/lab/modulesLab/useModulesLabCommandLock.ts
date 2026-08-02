/**
 * Command serialization + NATS req / ensureValve primitives for Modules Lab.
 */

import { useCallback, useRef, type MutableRefObject } from "react";
import {
  extractEnabledState,
  valveCommandSubject,
  valveStatusSubject,
  type DrinkxHost,
  type NatsMusterEntry,
} from "@service-monitor/core";
import type { LabTelemetryController } from "../LabTelemetryController";
import { errText, resolveHwid, sleep } from "./modulesLabHost";
import type { ModulesLabReq } from "./ModulesLabContext";

export function useModulesLabCommandLock(opts: {
  labTelemetryRef: MutableRefObject<LabTelemetryController | null>;
}) {
  const commandLock = useRef(Promise.resolve());
  const pollPaused = useRef(false);
  const pollGeneration = useRef(0);

  async function withCommandLock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = commandLock.current;
    let release!: () => void;
    commandLock.current = new Promise<void>((r) => {
      release = r;
    });
    await prev.catch(() => undefined);
    pollPaused.current = true;
    pollGeneration.current += 1;
    opts.labTelemetryRef.current?.pause();
    try {
      return await fn();
    } finally {
      await sleep(80);
      pollPaused.current = false;
      opts.labTelemetryRef.current?.resume();
      release();
      window.setTimeout(() => {
        if (!pollPaused.current) opts.labTelemetryRef.current?.kick();
      }, 500);
    }
  }

  return { withCommandLock, pollPaused, pollGeneration, commandLock };
}

export function useModulesLabReq(opts: {
  hwidRef: MutableRefObject<string>;
  hostRef: MutableRefObject<DrinkxHost>;
  modulesRef: MutableRefObject<NatsMusterEntry[]>;
}) {
  const withHwid = useCallback(
    (payload: Record<string, unknown> = {}) => ({
      hwid: opts.hwidRef.current,
      ...payload,
    }),
    [opts.hwidRef]
  );

  const req: ModulesLabReq = useCallback(
    async (
      subject,
      payload = {},
      timeoutMs = 2_000,
      priority: "command" | "poll" = "command"
    ) => {
      try {
        return await window.desktop.natsRequest({
          subject,
          payload: withHwid(payload),
          timeoutMs,
          priority,
        });
      } catch (e) {
        return { ok: false as const, error: errText(e) };
      }
    },
    [withHwid]
  );

  const reqForHost = useCallback(
    async (
      target: DrinkxHost,
      subject: string,
      payload: Record<string, unknown> = {},
      timeoutMs = 2_000,
      priority: "command" | "poll" = "poll"
    ) => {
      try {
        return await window.desktop.natsRequest({
          subject,
          payload: {
            hwid: resolveHwid(target, opts.modulesRef.current),
            ...payload,
          },
          timeoutMs,
          priority,
        });
      } catch (e) {
        return { ok: false as const, error: errText(e) };
      }
    },
    [opts.modulesRef]
  );

  async function ensureValve(
    baseId: string,
    enabled: boolean
  ): Promise<{ ok: boolean; enabled?: boolean; error?: string }> {
    let lastError: string | undefined;
    const active = opts.hostRef.current;
    // Команда open/stop → ответ {success}; затем status → {enabled} (источник истины).
    for (let attempt = 0; attempt < 2; attempt++) {
      const cmd = await req(
        valveCommandSubject(active, baseId, enabled),
        {},
        1_200,
        "command"
      );
      if (!cmd.ok) {
        lastError = cmd.error;
        await sleep(50);
        continue;
      }
      const st = await req(
        valveStatusSubject(active, baseId),
        {},
        700,
        "command"
      );
      const got = st.ok ? extractEnabledState(st.data) : null;
      if (got === enabled) return { ok: true, enabled: got };
      if (got !== null) {
        // бек ответил другим состоянием — принимаем его
        lastError = `ожидали ${enabled}, бек: ${got}`;
      }
      await sleep(50);
    }
    return {
      ok: false,
      error: lastError || "состояние клапана не подтвердилось",
    };
  }

  return { withHwid, req, reqForHost, ensureValve };
}
