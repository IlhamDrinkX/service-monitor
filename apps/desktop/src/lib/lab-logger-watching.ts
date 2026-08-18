/**
 * Runtime-only broadcast: is the onboard-log realtime watch (LabLoggerPage,
 * "Смотреть realtime") currently running?
 *
 * Lets AppShell keep LabLoggerPage mounted in the background — exactly like
 * it already does for ModulesPage via labBgTelemetry — so switching to
 * another tab (e.g. Модули) does not kill the SSH `/lab/events` poll loop
 * mid-stream and leave a gap in the chart window.
 *
 * In-memory only (not localStorage): "is a watch running right now" is a
 * runtime fact, not a persisted preference — it should not survive an app
 * restart.
 */

export const LAB_LOGGER_WATCHING_EVENT = "sm:labLoggerWatching";

let watching = false;

export function isLabLoggerWatching(): boolean {
  return watching;
}

export function setLabLoggerWatching(next: boolean): void {
  if (watching === next) return;
  watching = next;
  try {
    window.dispatchEvent(
      new CustomEvent(LAB_LOGGER_WATCHING_EVENT, { detail: { watching: next } })
    );
  } catch {
    // ignore
  }
}
