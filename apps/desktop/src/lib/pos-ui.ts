/**
 * Pure PosPage helpers (no React / Electron) — unit-tested from desktop tests.
 */

/** sessionStorage flag after CashDev unlock (renderer only). */
export const CASH_DEV_SESSION_KEY = "sm.cashDevUnlocked";

/** IPC channel for CashDev verify (main ↔ preload). */
export const CASH_DEV_VERIFY_IPC = "profiles:verifyCashDevPassword";

export function fmtBool(v: boolean | undefined): string {
  if (v === true) return "да";
  if (v === false) return "нет";
  return "—";
}

/** payments.status обычно без connected; ориентир — check.ready. */
export function fmtReadyLine(ready: boolean | undefined): string {
  if (ready === true) return "ready (check)";
  if (ready === false) return "not-ready (check)";
  return "— (нет поля connected; жмите check)";
}

export function posStatusCardClass(flags: {
  stub?: boolean;
  error?: boolean;
  warn?: boolean;
  ok?: boolean;
}): string {
  if (flags.stub) return "pos-status-card stub";
  if (flags.error) return "pos-status-card error";
  if (flags.warn) return "pos-status-card warn";
  if (flags.ok) return "pos-status-card ok";
  return "pos-status-card";
}

export function isCashDevSessionFlag(value: string | null): boolean {
  return value === "1";
}
