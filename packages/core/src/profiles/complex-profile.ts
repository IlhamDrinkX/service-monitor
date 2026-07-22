/**
 * Управление локальными профилями комплексов (без облака).
 */

import type { ComplexProfile } from "../domain/types.js";
import { sshPortFromSeries } from "../domain/lan-map.js";

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
  const m = /^(\d+)\.(\d+)$/.exec(seriesLabel.trim());
  if (!m) {
    throw new Error('seriesLabel must look like "4.15"');
  }
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const sshPort = sshPortFromSeries(major, minor);
  return createComplexProfile({
    name: name ?? `Комплекс №${seriesLabel}`,
    sshPort,
    seriesLabel,
  });
}

function cryptoRandomId(): string {
  // Работает в Node 20+ и в современных браузерах/Electron.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `p_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
