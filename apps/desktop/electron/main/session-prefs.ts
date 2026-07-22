/**
 * Последние параметры сессии — для reconnect после sleep/wake.
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { app } from "electron";
import type { SessionMode } from "@service-monitor/core";

export type SavedSessionPrefs = {
  mode: SessionMode;
  seriesLabel?: string;
  savedAt: string;
};

function prefsPath(): string {
  return join(app.getPath("userData"), "session-prefs.json");
}

export async function saveSessionPrefs(
  prefs: Omit<SavedSessionPrefs, "savedAt">
): Promise<void> {
  try {
    await mkdir(app.getPath("userData"), { recursive: true });
    const payload: SavedSessionPrefs = {
      ...prefs,
      savedAt: new Date().toISOString(),
    };
    await writeFile(prefsPath(), JSON.stringify(payload, null, 2), "utf8");
  } catch (e) {
    console.warn("[session-prefs] save failed", e);
  }
}

export async function loadSessionPrefs(): Promise<SavedSessionPrefs | null> {
  try {
    const raw = await readFile(prefsPath(), "utf8");
    const parsed = JSON.parse(raw) as SavedSessionPrefs;
    if (parsed?.mode === "local" || parsed?.mode === "remote") return parsed;
    return null;
  } catch {
    return null;
  }
}

export async function clearSessionPrefs(): Promise<void> {
  try {
    await writeFile(prefsPath(), "{}", "utf8");
  } catch {
    // ignore
  }
}
