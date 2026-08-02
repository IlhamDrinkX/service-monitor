import {
  TERMINAL_PAYLOAD_PRESETS,
  TERMINAL_SUBJECT_PRESETS,
  associatedPayloadIds,
} from "@service-monitor/core";
import type {
  CustomPayload,
  CustomSubject,
} from "../../lab/modulesLab/modulesLabTypes";

export function linkedPayloadIdsFor(
  subject: string,
  customSubjects: CustomSubject[]
): string[] {
  return associatedPayloadIds(subject.trim(), customSubjects);
}

export function filterBuiltinPayloads(linkedPayloadIds: string[]) {
  if (linkedPayloadIds.length === 0) return TERMINAL_PAYLOAD_PRESETS;
  const set = new Set(linkedPayloadIds.filter((x) => !x.startsWith("custom:")));
  const list = TERMINAL_PAYLOAD_PRESETS.filter((p) => set.has(p.id));
  return list.length > 0 ? list : TERMINAL_PAYLOAD_PRESETS;
}

export function filterCustomPayloads(
  linkedPayloadIds: string[],
  customPayloads: CustomPayload[]
): CustomPayload[] {
  if (linkedPayloadIds.length === 0) return customPayloads;
  const set = new Set(
    linkedPayloadIds
      .filter((x) => x.startsWith("custom:"))
      .map((x) => x.slice("custom:".length))
  );
  return customPayloads.filter((p) => set.has(p.id));
}

export function subjectPresetHint(
  termSubjectPick: string,
  linkedPayloadIds: string[]
): string {
  if (termSubjectPick.startsWith("custom:")) {
    const n = linkedPayloadIds.length;
    return `Свой subject · связанных payload: ${n}`;
  }
  const p = TERMINAL_SUBJECT_PRESETS.find((x) => x.id === termSubjectPick);
  if (!p) return "";
  return `${p.description} · payload: ${p.payloadIds.length}`;
}

export function payloadPresetHint(
  termPayloadPick: string,
  customPayloads: CustomPayload[]
): string {
  if (termPayloadPick.startsWith("custom:")) {
    const found = customPayloads.find(
      (p) => p.id === termPayloadPick.slice("custom:".length)
    );
    return found?.description || "Свой сохранённый payload";
  }
  const preset = TERMINAL_PAYLOAD_PRESETS.find((p) => p.id === termPayloadPick);
  if (!preset) return "";
  return `${preset.description} · обычно: ${preset.subjectsHint}`;
}

export function resolvePayloadSelectValue(
  termPayloadPick: string,
  filteredBuiltin: { id: string }[],
  filteredCustom: { id: string }[]
): string {
  if (
    filteredBuiltin.some((p) => p.id === termPayloadPick) ||
    filteredCustom.some((p) => `custom:${p.id}` === termPayloadPick) ||
    termPayloadPick === "__custom__"
  ) {
    return termPayloadPick;
  }
  return (
    filteredBuiltin[0]?.id ??
    (filteredCustom[0] ? `custom:${filteredCustom[0].id}` : "__custom__")
  );
}
