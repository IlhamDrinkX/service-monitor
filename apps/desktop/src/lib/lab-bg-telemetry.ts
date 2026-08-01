/** Persist Lab background telemetry preference (renderer localStorage). */

export const LAB_BG_TELEMETRY_KEY = "sm.labBgTelemetry";
export const LAB_BG_TELEMETRY_EVENT = "sm:labBgTelemetry";

export function readLabBgTelemetry(): boolean {
  try {
    return localStorage.getItem(LAB_BG_TELEMETRY_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeLabBgTelemetry(enabled: boolean): void {
  try {
    localStorage.setItem(LAB_BG_TELEMETRY_KEY, enabled ? "1" : "0");
    window.dispatchEvent(
      new CustomEvent(LAB_BG_TELEMETRY_EVENT, { detail: { enabled } })
    );
  } catch {
    // ignore
  }
}
