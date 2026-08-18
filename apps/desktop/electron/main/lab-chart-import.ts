/**
 * Stream large onboard ring (.jsonl) imports in Electron main.
 * Avoids loading 30–40 MB into the renderer / single IPC payload.
 */

import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { createInterface } from "readline";
import { BrowserWindow, dialog } from "electron";
import {
  OnboardRingImportAccumulator,
  LAB_LOGGER_IMPORT_EVENTS_MAX,
  type LabEvent,
} from "@service-monitor/core";

/** Soft ceiling for single-JSON «Экспорт лога» — larger files go through jsonl path. */
const CHART_JSON_MAX_BYTES = 12 * 1024 * 1024;

export type LabChartImportProgress = {
  phase: "open" | "read" | "done" | "error";
  bytesRead: number;
  bytesTotal: number;
  records: number;
  events: number;
  path?: string;
  message?: string;
};

export type LabChartImportResult =
  | {
      ok: true;
      format: "onboard-ring";
      events: LabEvent[];
      meta: {
        path: string;
        bytes: number;
        records: number;
        eventsBeforeCap: number;
        eventsAfterCap: number;
        capped: boolean;
      };
    }
  | {
      ok: true;
      format: "chart-log";
      raw: unknown;
      meta: { path: string; bytes: number };
    }
  | { ok: false; error: string; canceled?: boolean };

function broadcastProgress(
  sender: Electron.WebContents | null,
  progress: LabChartImportProgress
): void {
  if (sender && !sender.isDestroyed()) {
    sender.send("labChart:importProgress", progress);
  }
}

function looksLikeChartLog(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const o = raw as Record<string, unknown>;
  return (
    o.kind === "service-monitor-lab-chart" &&
    typeof o.version === "number" &&
    Array.isArray(o.events)
  );
}

async function importOnboardRingStream(
  filePath: string,
  bytesTotal: number,
  sender: Electron.WebContents | null,
  onProgress?: (p: LabChartImportProgress) => void
): Promise<LabChartImportResult> {
  const acc = new OnboardRingImportAccumulator(LAB_LOGGER_IMPORT_EVENTS_MAX);
  let bytesRead = 0;
  let lastEmit = 0;

  const emit = (phase: LabChartImportProgress["phase"], message?: string) => {
    const p: LabChartImportProgress = {
      phase,
      bytesRead,
      bytesTotal,
      records: 0,
      events: 0,
      path: filePath,
      message,
    };
    // records/events filled after we have snapshot — approximate via bytes for UI
    onProgress?.(p);
    broadcastProgress(sender, p);
  };

  emit("read");

  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath, { encoding: "utf8" });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    stream.on("data", (chunk: string | Buffer) => {
      bytesRead += typeof chunk === "string" ? Buffer.byteLength(chunk, "utf8") : chunk.length;
      const now = Date.now();
      if (now - lastEmit > 120) {
        lastEmit = now;
        const approxRecords = Math.max(0, Math.floor(bytesRead / 80));
        const progress: LabChartImportProgress = {
          phase: "read",
          bytesRead,
          bytesTotal,
          records: approxRecords,
          events: Math.min(approxRecords, LAB_LOGGER_IMPORT_EVENTS_MAX),
          path: filePath,
        };
        onProgress?.(progress);
        broadcastProgress(sender, progress);
      }
    });

    rl.on("line", (line) => {
      if (!acc.pushLine(line)) {
        rl.close();
        stream.destroy();
        reject(
          new Error(
            "Файл не похож на ring JSON Lines (ожидается одна JSON-запись на строку)"
          )
        );
      }
    });

    rl.on("close", () => resolve());
    stream.on("error", reject);
    rl.on("error", reject);
  });

  const finished = acc.finish();
  if (finished.records === 0 || finished.events.length === 0) {
    return {
      ok: false,
      error:
        "Ring пуст или не содержит распознаваемых записей (v/ts/kind/module/name)",
    };
  }

  const done: LabChartImportProgress = {
    phase: "done",
    bytesRead: bytesTotal,
    bytesTotal,
    records: finished.records,
    events: finished.eventsAfterCap,
    path: filePath,
  };
  onProgress?.(done);
  broadcastProgress(sender, done);

  return {
    ok: true,
    format: "onboard-ring",
    events: finished.events,
    meta: {
      path: filePath,
      bytes: bytesTotal,
      records: finished.records,
      eventsBeforeCap: finished.eventsBeforeCap,
      eventsAfterCap: finished.eventsAfterCap,
      capped: finished.eventsBeforeCap > finished.eventsAfterCap,
    },
  };
}

/**
 * Import a lab chart log: dialog (or explicit path). Streams `.jsonl`;
 * small `.json` chart exports are loaded once in main (not the renderer).
 */
export async function labChartImportLog(input?: {
  path?: string;
  sender?: Electron.WebContents | null;
}): Promise<LabChartImportResult> {
  const sender = input?.sender ?? null;
  let filePath = input?.path?.trim() || "";

  if (!filePath) {
    broadcastProgress(sender, {
      phase: "open",
      bytesRead: 0,
      bytesTotal: 0,
      records: 0,
      events: 0,
    });
    const win =
      (sender && BrowserWindow.fromWebContents(sender)) ||
      BrowserWindow.getFocusedWindow() ||
      BrowserWindow.getAllWindows()[0] ||
      null;
    const dialogOpts: Electron.OpenDialogOptions = {
      title: "Импорт лога графика",
      properties: ["openFile"],
      filters: [
        { name: "Lab log (JSON / JSONL)", extensions: ["json", "jsonl"] },
        { name: "JSON Lines ring", extensions: ["jsonl"] },
        { name: "JSON", extensions: ["json"] },
      ],
    };
    const picked = win
      ? await dialog.showOpenDialog(win, dialogOpts)
      : await dialog.showOpenDialog(dialogOpts);
    if (picked.canceled || !picked.filePaths[0]) {
      return { ok: false, error: "Импорт отменён", canceled: true };
    }
    filePath = picked.filePaths[0];
  }

  try {
    const st = await stat(filePath);
    const bytesTotal = st.size;
    const lower = filePath.toLowerCase();

    // Prefer streaming for .jsonl or any large file (often mis-saved as .json).
    if (lower.endsWith(".jsonl") || bytesTotal > CHART_JSON_MAX_BYTES) {
      return await importOnboardRingStream(filePath, bytesTotal, sender);
    }

    // Small .json: try single-document chart export first, else jsonl stream.
    const { readFile } = await import("fs/promises");
    const text = await readFile(filePath, "utf8");
    try {
      const raw: unknown = JSON.parse(text);
      if (looksLikeChartLog(raw)) {
        const done: LabChartImportProgress = {
          phase: "done",
          bytesRead: bytesTotal,
          bytesTotal,
          records: Array.isArray((raw as { events?: unknown }).events)
            ? ((raw as { events: unknown[] }).events.length)
            : 0,
          events: Array.isArray((raw as { events?: unknown }).events)
            ? ((raw as { events: unknown[] }).events.length)
            : 0,
          path: filePath,
        };
        broadcastProgress(sender, done);
        return {
          ok: true,
          format: "chart-log",
          raw,
          meta: { path: filePath, bytes: bytesTotal },
        };
      }
    } catch {
      // fall through to jsonl
    }

    return await importOnboardRingStream(filePath, bytesTotal, sender);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    broadcastProgress(sender, {
      phase: "error",
      bytesRead: 0,
      bytesTotal: 0,
      records: 0,
      events: 0,
      path: filePath,
      message,
    });
    return { ok: false, error: message };
  }
}
