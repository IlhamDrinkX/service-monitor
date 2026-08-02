/**
 * Persist the laptop/onboard "XOR" Lab-poll mode (renderer localStorage).
 * See shouldThrottleLabPoll (core) for the actual decision logic.
 */
import {
  isLabPollMode,
  LAB_POLL_MODE_DEFAULT,
  type LabPollMode,
} from "@service-monitor/core";

export const LAB_ONBOARD_XOR_KEY = "sm.labOnboardXor";
export const LAB_ONBOARD_XOR_EVENT = "sm:labOnboardXor";

export function readLabOnboardXorMode(): LabPollMode {
  try {
    const raw = localStorage.getItem(LAB_ONBOARD_XOR_KEY);
    return isLabPollMode(raw) ? raw : LAB_POLL_MODE_DEFAULT;
  } catch {
    return LAB_POLL_MODE_DEFAULT;
  }
}

export function writeLabOnboardXorMode(mode: LabPollMode): void {
  try {
    localStorage.setItem(LAB_ONBOARD_XOR_KEY, mode);
    window.dispatchEvent(
      new CustomEvent(LAB_ONBOARD_XOR_EVENT, { detail: { mode } })
    );
  } catch {
    // ignore
  }
}
