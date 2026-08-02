import { estimateHeaterPwmPercent } from "@service-monitor/core";

/** Sensor key for heater outlet temp used in PWM estimate. */
export function heaterOutletSensor(
  hid: string
): "heater1_out" | "heater2_out" | null {
  if (hid === "heater1") return "heater1_out";
  if (hid === "heater2") return "heater2_out";
  return null;
}

/** Short id used by LabTelemetryController.setHeater. */
export function heaterShortId(hid: string): "heater1" | "heater2" | null {
  if (hid === "heater1" || hid === "heater2") return hid;
  return null;
}

/** PWM % estimate with Lab UI fallback (~25%) when temp unknown. */
export function estimatePwmForHeater(
  enabled: boolean,
  target: number,
  temperature: number | null | undefined
): number {
  return estimateHeaterPwmPercent(enabled, target, temperature) ?? 25;
}
