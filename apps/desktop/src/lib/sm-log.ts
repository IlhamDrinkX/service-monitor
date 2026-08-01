/**
 * Логирование для полевой отладки Stage 8+.
 * Пишет в console + desktop.log; при ошибках включает Debug на диск.
 */

let debugForced = false;

async function ensureDebugOnDisk(): Promise<void> {
  if (debugForced) return;
  debugForced = true;
  try {
    localStorage.setItem("sm.debug", "1");
    await window.desktop.setDebugEnabled(true);
    await window.desktop.log("warn", "crash", "Debug auto-enabled after error");
  } catch {
    // ignore
  }
}

export function smLog(
  level: "debug" | "info" | "warn" | "error",
  scope: string,
  message: string,
  data?: unknown
): void {
  const line = `[sm:${scope}] ${message}`;
  if (level === "error") console.error(line, data ?? "");
  else if (level === "warn") console.warn(line, data ?? "");
  else console.log(line, data ?? "");
  try {
    void window.desktop.log(level, scope, message, data);
  } catch {
    // preload may be missing briefly
  }
  if (level === "error") void ensureDebugOnDisk();
}

export function installGlobalErrorLogging(): () => void {
  const onError = (event: ErrorEvent) => {
    smLog("error", "window", event.message || "ErrorEvent", {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      stack: event.error instanceof Error ? event.error.stack : undefined,
    });
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    smLog(
      "error",
      "unhandledRejection",
      reason instanceof Error ? reason.message : String(reason),
      reason instanceof Error ? { stack: reason.stack } : { reason }
    );
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  smLog("info", "boot", "global error logging installed");
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}

/** Безопасный вызов IPC — не падает, если API ещё нет. */
export async function safeDesktopCall<T>(
  name: string,
  fn: () => Promise<T>,
  fallback: T
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    smLog("error", "ipc", `${name} failed`, {
      error: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : undefined,
    });
    return fallback;
  }
}
