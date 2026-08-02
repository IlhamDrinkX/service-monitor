import { seriesKey, type DrinkxHost } from "@service-monitor/core";
import type {
  CustomPayload,
  CustomSubject,
  LabTrackState,
} from "./modulesLabTypes";

export const LAB_TRACK_KEY = "sm.labTrack.v1";
export const TERM_CUSTOM_SUBJECTS_KEY = "sm.term.customSubjects.v2";
export const TERM_CUSTOM_PAYLOADS_KEY = "sm.term.customPayloads.v2";
export const TERM_CUSTOM_SUBJECTS_LEGACY = "sm.term.customSubjects.v1";
export const TERM_CUSTOM_PAYLOADS_LEGACY = "sm.term.customPayloads.v1";

export function normalizeCustomSubject(raw: unknown): CustomSubject | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.subject !== "string" || !o.subject.trim()) return null;
  const payloadIds = Array.isArray(o.payloadIds)
    ? o.payloadIds.filter((x): x is string => typeof x === "string")
    : [];
  return {
    subject: o.subject.trim(),
    label: typeof o.label === "string" && o.label ? o.label : o.subject.trim(),
    payloadIds,
  };
}

export function loadCustomSubjects(): CustomSubject[] {
  try {
    const raw =
      localStorage.getItem(TERM_CUSTOM_SUBJECTS_KEY) ??
      localStorage.getItem(TERM_CUSTOM_SUBJECTS_LEGACY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeCustomSubject)
      .filter((x): x is CustomSubject => x != null)
      .slice(0, 40);
  } catch {
    return [];
  }
}

export function saveCustomSubjects(list: CustomSubject[]) {
  localStorage.setItem(TERM_CUSTOM_SUBJECTS_KEY, JSON.stringify(list.slice(0, 40)));
}

export function loadCustomPayloads(): CustomPayload[] {
  try {
    const raw =
      localStorage.getItem(TERM_CUSTOM_PAYLOADS_KEY) ??
      localStorage.getItem(TERM_CUSTOM_PAYLOADS_LEGACY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CustomPayload[];
    return Array.isArray(parsed) ? parsed.slice(0, 40) : [];
  } catch {
    return [];
  }
}

export function saveCustomPayloads(list: CustomPayload[]) {
  localStorage.setItem(TERM_CUSTOM_PAYLOADS_KEY, JSON.stringify(list.slice(0, 40)));
}

export function currentPayloadPickId(
  termPayloadPick: string,
  termCmd: string,
  customPayloads: CustomPayload[]
): string | null {
  if (termPayloadPick.startsWith("custom:")) return termPayloadPick;
  if (termPayloadPick !== "__custom__" && termPayloadPick) return termPayloadPick;
  const raw = termCmd.trim() || "{}";
  const found = customPayloads.find((p) => p.payloadJson.trim() === raw);
  return found ? `custom:${found.id}` : null;
}

export function defaultLabTrack(): LabTrackState {
  return {
    modules: { milk: true, coffee: true, water: true },
    sensors: {},
  };
}

export function loadLabTrack(): LabTrackState {
  try {
    const raw = sessionStorage.getItem(LAB_TRACK_KEY);
    if (!raw) return defaultLabTrack();
    const parsed = JSON.parse(raw) as LabTrackState;
    const modules = { ...defaultLabTrack().modules, ...parsed.modules };
    // Если всё выключено — сброс (иначе пустые датчики/лог).
    if (!modules.milk && !modules.coffee && !modules.water) {
      return defaultLabTrack();
    }
    return {
      modules,
      sensors: parsed.sensors ?? {},
    };
  } catch {
    return defaultLabTrack();
  }
}

export function saveLabTrack(t: LabTrackState): void {
  try {
    sessionStorage.setItem(LAB_TRACK_KEY, JSON.stringify(t));
  } catch {
    // ignore
  }
}

/** Модуль включён в трек (отсутствие ключа = включён). */
export function isModuleTracked(
  track: LabTrackState,
  mod: DrinkxHost
): boolean {
  return track.modules[mod] !== false;
}

/** Датчик включён в трек (модуль + sensor key; отсутствие ключа = включён). */
export function isSensorTracked(
  track: LabTrackState,
  mod: DrinkxHost,
  name: string
): boolean {
  if (!isModuleTracked(track, mod)) return false;
  const key = seriesKey(mod, name);
  return track.sensors[key] !== false;
}
