/**
 * Управление локальными профилями комплексов (без облака).
 */

import type { ComplexProfile } from "../domain/types.js";
import { parseSeriesLabel } from "../domain/lan-map.js";

export interface CreateProfileInput {
  name: string;
  sshPort: number;
  seriesLabel?: string;
  identityFile?: string;
  salesPointId?: string;
}

export function createComplexProfile(
  input: CreateProfileInput,
  idFactory: () => string = () => cryptoRandomId(),
  now: () => Date = () => new Date()
): ComplexProfile {
  if (!Number.isInteger(input.sshPort) || input.sshPort < 22000) {
    throw new Error("sshPort must be an integer >= 22000");
  }
  const ts = now().toISOString();
  return {
    id: idFactory(),
    name: input.name.trim() || `Комплекс ${input.sshPort}`,
    sshPort: input.sshPort,
    seriesLabel: input.seriesLabel,
    identityFile: input.identityFile,
    salesPointId: input.salesPointId,
    createdAt: ts,
    updatedAt: ts,
  };
}

/** Удобный конструктор из подписи «4.15». */
export function profileFromSeriesLabel(
  seriesLabel: string,
  name?: string
): ComplexProfile {
  const { major, minor, label } = parseSeriesLabel(seriesLabel);
  const sshPort = 22000 + major * 100 + minor;
  return createComplexProfile({
    name: name?.trim() || `Комплекс №${label}`,
    sshPort,
    seriesLabel: label,
  });
}

function cryptoRandomId(): string {
  // Работает в Node 20+ и в современных браузерах/Electron.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `p_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
