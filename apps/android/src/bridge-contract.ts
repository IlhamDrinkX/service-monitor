/**
 * Контракт native bridge для будущего Android-клиента.
 * Реализация — платформенный слой; здесь только типы/ожидания.
 */

import type {
  ComplexSessionSnapshot,
  DrinkxHost,
  NatsConnectionInfo,
  NatsMusterEntry,
} from "@service-monitor/core/browser";

/** Методы, которые должен предоставить Android native bridge. */
export type ServiceMonitorNativeBridge = {
  sessionConnect(input: {
    mode: "remote" | "local";
    seriesLabel?: string;
  }): Promise<ComplexSessionSnapshot>;
  sessionDisconnect(): Promise<ComplexSessionSnapshot>;
  natsConnect(server?: string): Promise<NatsConnectionInfo>;
  natsDisconnect(): Promise<NatsConnectionInfo>;
  natsMuster(timeoutMs?: number): Promise<
    { ok: true; modules: NatsMusterEntry[] } | { ok: false; error: string }
  >;
  natsRequest(input: {
    subject: string;
    payload?: unknown;
    timeoutMs?: number;
  }): Promise<{ ok: true; data: unknown } | { ok: false; error: string }>;
  drinkxRead(input: {
    role: DrinkxHost;
  }): Promise<{ ok: true; text: string } | { ok: false; error: string }>;
  syrupModbusScan(input: {
    mode: "scan" | "motor";
    maxId?: number;
    baud?: number;
    id?: number;
    seconds?: number;
    intensity?: number;
  }): Promise<{ ok: true; output: string } | { ok: false; error: string }>;
  flashPartA(config: {
    currentId: number;
    newId: number;
    currentBaud: number;
    newBaud: number;
  }): Promise<{ ok: true } | { ok: false; error: string }>;
};

export const BRIDGE_METHOD_NAMES = [
  "sessionConnect",
  "sessionDisconnect",
  "natsConnect",
  "natsDisconnect",
  "natsMuster",
  "natsRequest",
  "drinkxRead",
  "syrupModbusScan",
  "flashPartA",
] as const satisfies ReadonlyArray<keyof ServiceMonitorNativeBridge>;
