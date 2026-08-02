import { FLOW_CALIBRATION_QTYS } from "@service-monitor/core";
import type { CalibRow } from "../../lab/modulesLab/modulesLabTypes";

export function initialCalibRows(): CalibRow[] {
  return FLOW_CALIBRATION_QTYS.map((qty) => ({ qty }));
}

/** Parse prompt answer for actual volume (ml); null if invalid. */
export function parseActualMl(answer: string): number | null {
  const actualMl = Number(String(answer).replace(",", "."));
  if (!Number.isFinite(actualMl) || actualMl <= 0) return null;
  return actualMl;
}

export function computeStepFlowFactor(
  pulsesDelta: number,
  actualMl: number
): number {
  return pulsesDelta / actualMl;
}

export function averageFlowFactor(factors: number[]): number {
  if (factors.length === 0) return Number.NaN;
  return factors.reduce((a, b) => a + b, 0) / factors.length;
}

/**
 * Pulses delta for one calib step: prefer post-reset max when counter wrapped.
 */
export function calibPulsesDelta(input: {
  startPulses: number;
  endPulses: number | null;
  detectedReset: boolean;
  maxAfterReset: number;
}): number {
  const { startPulses, endPulses, detectedReset, maxAfterReset } = input;
  if (detectedReset) return maxAfterReset;
  if (endPulses != null) return endPulses - startPulses;
  return Number.NaN;
}

export function isValidPulsesDelta(pulsesDelta: number): boolean {
  return Number.isFinite(pulsesDelta) && pulsesDelta > 0;
}
