import { useEffect, useMemo, useRef, useState } from "react";
import {
  NATS_SUBJECTS,
  TERMINAL_PAYLOAD_PRESETS,
  TERMINAL_PAYLOAD_RULES,
  TERMINAL_SUBJECT_PRESETS,
  associatedPayloadIds,
  findSubjectPresetFor,
  formatLabTerminalLine,
  type LabEvent,
} from "@service-monitor/core";
import { ActionButton } from "../ActionButton";
import { HelpTip } from "../HelpTip";
import { onEnterNavigate } from "../../lib/form-nav";
import {
  currentPayloadPickId,
  loadCustomPayloads,
  loadCustomSubjects,
  saveCustomPayloads,
  saveCustomSubjects,
} from "../../lab/modulesLab/modulesLabStorage";
import type {
  CustomPayload,
  CustomSubject,
} from "../../lab/modulesLab/modulesLabTypes";
import {
  filterBuiltinPayloads,
  filterCustomPayloads,
  payloadPresetHint,
  resolvePayloadSelectValue,
  subjectPresetHint,
} from "./labTerminalHelpers";

export type LabTerminalReq = (
  subject: string,
  payload?: Record<string, unknown>,
  timeoutMs?: number,
  priority?: "command" | "poll"
) => Promise<
  { ok: true; data: unknown } | { ok: false; error: string }
>;

export type LabTerminalToast = { text: string; error?: boolean };

export function LabTerminalPanel(props: {
  live: boolean;
  controlsDisabled: boolean;
  labEvents: LabEvent[];
  pushLab: (
    kind: LabEvent["kind"],
    name: string,
    value: LabEvent["value"],
    detail?: string,
    moduleOverride?: string
  ) => void;
  req: LabTerminalReq;
  setToast: (t: LabTerminalToast | null) => void;
}) {
  const { live, controlsDisabled, labEvents, pushLab, req, setToast } = props;

  const [termCmd, setTermCmd] = useState("{}");
  const [termSubject, setTermSubject] = useState<string>(NATS_SUBJECTS.status);
  const [termSubjectPick, setTermSubjectPick] = useState("cm-status");
  const [termPayloadPick, setTermPayloadPick] = useState("empty");
  const [customSubjects, setCustomSubjects] = useState<CustomSubject[]>(() =>
    typeof localStorage !== "undefined" ? loadCustomSubjects() : []
  );
  const [customPayloads, setCustomPayloads] = useState<CustomPayload[]>(() =>
    typeof localStorage !== "undefined" ? loadCustomPayloads() : []
  );
  const [showPayloadRules, setShowPayloadRules] = useState(false);
  const terminalRef = useRef<HTMLPreElement | null>(null);
  const termStickBottomRef = useRef(true);
  const termSubjectInputRef = useRef<HTMLInputElement | null>(null);
  const termPayloadInputRef = useRef<HTMLTextAreaElement | null>(null);
  const termSendBtnRef = useRef<HTMLButtonElement | null>(null);

  const terminalText = useMemo(
    () =>
      labEvents
        .slice(-400)
        .map(formatLabTerminalLine)
        .join("\n"),
    [labEvents]
  );

  useEffect(() => {
    const el = terminalRef.current;
    if (!el) return;
    if (termStickBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [terminalText]);

  function onTerminalScroll() {
    const el = terminalRef.current;
    if (!el) return;
    termStickBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }

  async function runTerminalCommand() {
    const subject = termSubject.trim();
    if (!subject) return;
    let payload: Record<string, unknown> = {};
    if (termCmd.trim()) {
      try {
        payload = JSON.parse(termCmd) as Record<string, unknown>;
      } catch {
        setToast({ text: "payload должен быть JSON", error: true });
        return;
      }
    }
    pushLab("command", subject, "request", termCmd || "{}");
    const res = await req(subject, payload, 2_500);
    if (res.ok) {
      pushLab(
        "command",
        subject,
        "ok",
        JSON.stringify(res.data).slice(0, 240)
      );
    } else {
      pushLab("command", subject, "error", res.error);
      setToast({ text: res.error, error: true });
    }
  }

  function applySubjectPreset(id: string) {
    setTermSubjectPick(id);
    let subject = termSubject;
    if (id.startsWith("custom:")) {
      subject = id.slice("custom:".length);
      setTermSubject(subject);
    } else if (id === "__custom__") {
      return;
    } else {
      const preset = TERMINAL_SUBJECT_PRESETS.find((p) => p.id === id);
      if (!preset) return;
      subject = preset.subject;
      setTermSubject(subject);
    }
    const ids = associatedPayloadIds(subject, customSubjects);
    const first = ids[0];
    if (first) applyPayloadPreset(first);
  }

  function applyPayloadPreset(id: string) {
    setTermPayloadPick(id);
    if (id.startsWith("custom:")) {
      const found = customPayloads.find((p) => p.id === id.slice("custom:".length));
      if (found) setTermCmd(found.payloadJson);
      return;
    }
    if (id === "__custom__") return;
    const preset = TERMINAL_PAYLOAD_PRESETS.find((p) => p.id === id);
    if (preset) setTermCmd(JSON.stringify(preset.payload, null, 2));
  }

  function linkPayloadToSubject(subject: string, payloadPickId: string) {
    const builtin = findSubjectPresetFor(subject);
    const existing = customSubjects.find((s) => s.subject === subject);
    const baseIds =
      existing?.payloadIds?.length
        ? existing.payloadIds
        : builtin
          ? [...builtin.payloadIds]
          : [];
    if (baseIds.includes(payloadPickId)) {
      if (!existing && !builtin) {
        const row: CustomSubject = {
          subject,
          label: subject,
          payloadIds: [payloadPickId],
        };
        const next = [row, ...customSubjects].slice(0, 40);
        setCustomSubjects(next);
        saveCustomSubjects(next);
      }
      return;
    }
    const payloadIds = [payloadPickId, ...baseIds.filter((x) => x !== payloadPickId)];
    const row: CustomSubject = {
      subject,
      label: existing?.label ?? subject,
      payloadIds,
    };
    const next = [row, ...customSubjects.filter((s) => s.subject !== subject)].slice(
      0,
      40
    );
    setCustomSubjects(next);
    saveCustomSubjects(next);
  }

  function rememberSubject() {
    const subject = termSubject.trim();
    if (!subject) return;
    const pick =
      currentPayloadPickId(termPayloadPick, termCmd, customPayloads) ??
      (() => {
        const raw = termCmd.trim() || "{}";
        try {
          JSON.parse(raw);
        } catch {
          return null;
        }
        const id = `p${Date.now().toString(36)}`;
        const entry: CustomPayload = {
          id,
          label: `${subject} payload`,
          description: `Авто при сохранении subject ${subject}`,
          payloadJson: raw,
        };
        const payloads = [entry, ...customPayloads].slice(0, 40);
        setCustomPayloads(payloads);
        saveCustomPayloads(payloads);
        setTermPayloadPick(`custom:${id}`);
        return `custom:${id}`;
      })();

    const existing = customSubjects.find((s) => s.subject === subject);
    const builtin = findSubjectPresetFor(subject);
    const base = existing?.payloadIds?.length
      ? existing.payloadIds
      : builtin
        ? [...builtin.payloadIds]
        : [];
    const payloadIds = pick
      ? [pick, ...base.filter((x) => x !== pick)]
      : base;

    const next = [
      {
        subject,
        label: existing?.label ?? subject,
        payloadIds,
      },
      ...customSubjects.filter((s) => s.subject !== subject),
    ].slice(0, 40);
    setCustomSubjects(next);
    saveCustomSubjects(next);
    setTermSubjectPick(`custom:${subject}`);
    setToast({
      text: pick
        ? `Subject сохранён + связь с payload`
        : `Subject сохранён: ${subject}`,
    });
  }

  function rememberPayload() {
    const raw = termCmd.trim() || "{}";
    try {
      JSON.parse(raw);
    } catch {
      setToast({ text: "payload должен быть JSON", error: true });
      return;
    }
    const id = `p${Date.now().toString(36)}`;
    const label = window.prompt("Название пресета payload", "мой payload");
    if (!label) return;
    const description =
      window.prompt("Краткое описание (зачем)", "") ?? "";
    const entry: CustomPayload = {
      id,
      label: label.trim() || id,
      description: description.trim(),
      payloadJson: raw,
    };
    const next = [entry, ...customPayloads].slice(0, 40);
    setCustomPayloads(next);
    saveCustomPayloads(next);
    const pickId = `custom:${id}`;
    setTermPayloadPick(pickId);

    const subject = termSubject.trim();
    if (subject) {
      linkPayloadToSubject(subject, pickId);
      setToast({
        text: `Payload «${entry.label}» сохранён и связан с ${subject}`,
      });
    } else {
      setToast({ text: `Payload сохранён: ${entry.label}` });
    }
  }

  function deleteCustomSubject() {
    const subject = termSubject.trim();
    if (!subject) return;
    if (!customSubjects.some((s) => s.subject === subject)) {
      setToast({ text: "Это не свой subject", error: true });
      return;
    }
    if (!window.confirm(`Удалить свой subject «${subject}»?`)) return;
    const next = customSubjects.filter((s) => s.subject !== subject);
    setCustomSubjects(next);
    saveCustomSubjects(next);
    const builtin = findSubjectPresetFor(subject);
    if (builtin) {
      setTermSubjectPick(builtin.id);
      setTermSubject(builtin.subject);
      const first = builtin.payloadIds[0];
      if (first) applyPayloadPreset(first);
    } else {
      setTermSubjectPick("__custom__");
    }
    setToast({ text: `Удалён subject: ${subject}` });
  }

  function deleteCustomPayload() {
    if (!termPayloadPick.startsWith("custom:")) {
      setToast({ text: "Выберите свой payload в списке", error: true });
      return;
    }
    const id = termPayloadPick.slice("custom:".length);
    const found = customPayloads.find((p) => p.id === id);
    if (!found) return;
    if (!window.confirm(`Удалить payload «${found.label}»?`)) return;
    const pickKey = `custom:${id}`;
    const nextPayloads = customPayloads.filter((p) => p.id !== id);
    setCustomPayloads(nextPayloads);
    saveCustomPayloads(nextPayloads);
    const nextSubjects = customSubjects.map((s) => ({
      ...s,
      payloadIds: s.payloadIds.filter((x) => x !== pickKey),
    }));
    setCustomSubjects(nextSubjects);
    saveCustomSubjects(nextSubjects);
    const ids = associatedPayloadIds(termSubject.trim(), nextSubjects);
    const first = ids[0] ?? "empty";
    applyPayloadPreset(first);
    setToast({ text: `Удалён payload: ${found.label}` });
  }

  const linkedPayloadIds = useMemo(
    () => associatedPayloadIds(termSubject.trim(), customSubjects),
    [termSubject, customSubjects]
  );

  const filteredBuiltinPayloads = useMemo(
    () => filterBuiltinPayloads(linkedPayloadIds),
    [linkedPayloadIds]
  );

  const filteredCustomPayloads = useMemo(
    () => filterCustomPayloads(linkedPayloadIds, customPayloads),
    [linkedPayloadIds, customPayloads]
  );

  const canDeleteSubject = customSubjects.some(
    (s) => s.subject === termSubject.trim()
  );
  const canDeletePayload = termPayloadPick.startsWith("custom:");

  const subjectHint = useMemo(
    () => subjectPresetHint(termSubjectPick, linkedPayloadIds),
    [termSubjectPick, linkedPayloadIds]
  );

  const payloadHint = useMemo(
    () => payloadPresetHint(termPayloadPick, customPayloads),
    [termPayloadPick, customPayloads]
  );

  return (
    <div className="panel">
      <h2 className="row" style={{ gap: 8, alignItems: "center" }}>
        Терминал / журнал
        <HelpTip controlId="modules.terminal" />
      </h2>
      <pre
        className="lab-terminal"
        ref={terminalRef}
        onScroll={onTerminalScroll}
      >
        {terminalText || "— лог пуст —"}
      </pre>
      <div className="lab-terminal-form">
        <div className="lab-terminal-presets">
          <label className="muted">
            <span className="row" style={{ gap: 6, alignItems: "center" }}>
              Куда отправить
              <HelpTip controlId="modules.terminal.subject" />
            </span>
            <select
              value={termSubjectPick}
              disabled={!live}
              onChange={(e) => applySubjectPreset(e.target.value)}
              onKeyDown={(e) =>
                onEnterNavigate(e, { next: termSubjectInputRef })
              }
            >
              {TERMINAL_SUBJECT_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} — {p.subject}
                </option>
              ))}
              {customSubjects.map((s) => (
                <option key={`c-${s.subject}`} value={`custom:${s.subject}`}>
                  ★ {s.label}
                </option>
              ))}
              <option value="__custom__">Свой subject (поле ниже)</option>
            </select>
          </label>
          <label className="muted">
            <span className="row" style={{ gap: 6, alignItems: "center" }}>
              Payload preset
              <HelpTip controlId="modules.terminal.payload" />
            </span>
            <select
              value={resolvePayloadSelectValue(
                termPayloadPick,
                filteredBuiltinPayloads,
                filteredCustomPayloads
              )}
              disabled={!live}
              onChange={(e) => applyPayloadPreset(e.target.value)}
              onKeyDown={(e) =>
                onEnterNavigate(e, { next: termPayloadInputRef })
              }
            >
              {filteredBuiltinPayloads.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
              {filteredCustomPayloads.map((p) => (
                <option key={p.id} value={`custom:${p.id}`}>
                  ★ {p.label}
                </option>
              ))}
              <option value="__custom__">Свой JSON (поле ниже)</option>
            </select>
          </label>
        </div>
        {(subjectHint || payloadHint) && (
          <p className="muted lab-terminal-hint">
            {subjectHint}
            {subjectHint && payloadHint ? " · " : ""}
            {payloadHint}
          </p>
        )}
        <div className="lab-terminal-fields">
          <label className="muted">
            Subject (ручной ввод)
            <input
              ref={termSubjectInputRef}
              className="lab-term-subject"
              value={termSubject}
              disabled={!live}
              onChange={(e) => {
                const v = e.target.value;
                setTermSubject(v);
                const trimmed = v.trim();
                const builtin = findSubjectPresetFor(trimmed);
                const custom = customSubjects.find(
                  (s) => s.subject === trimmed
                );
                if (custom) setTermSubjectPick(`custom:${custom.subject}`);
                else if (builtin) setTermSubjectPick(builtin.id);
                else setTermSubjectPick("__custom__");
                const ids = associatedPayloadIds(trimmed, customSubjects);
                if (
                  ids.length > 0 &&
                  termPayloadPick !== "__custom__" &&
                  !ids.includes(termPayloadPick)
                ) {
                  applyPayloadPreset(ids[0]!);
                }
              }}
              onKeyDown={(e) =>
                onEnterNavigate(e, { next: termPayloadInputRef })
              }
              placeholder="coffeemachine.status"
              spellCheck={false}
            />
          </label>
          <label className="muted">
            <span className="row" style={{ gap: 8, alignItems: "baseline" }}>
              JSON payload (ручной ввод)
              <span className="lab-terminal-kbd">Ctrl+Enter — Send</span>
            </span>
            <textarea
              ref={termPayloadInputRef}
              className="lab-term-payload"
              value={termCmd}
              disabled={!live}
              onChange={(e) => {
                setTermCmd(e.target.value);
                setTermPayloadPick("__custom__");
              }}
              onKeyDown={(e) =>
                onEnterNavigate(e, {
                  textareaUsesCtrlEnter: true,
                  onAction: () => void runTerminalCommand(),
                  next: termSendBtnRef,
                })
              }
              placeholder="{}"
              spellCheck={false}
            />
          </label>
        </div>
        <div className="lab-terminal-actions">
          <ActionButton
            helpId="modules.terminal.send"
            variant="primary"
            buttonRef={termSendBtnRef}
            disabled={controlsDisabled}
            onClick={() => void runTerminalCommand()}
          >
            Send
          </ActionButton>
          <ActionButton
            helpId="modules.terminal.rememberSubject"
            className="btn-compact"
            disabled={!live || !termSubject.trim()}
            onClick={() => rememberSubject()}
          >
            Запомнить subject
          </ActionButton>
          <ActionButton
            helpId="modules.terminal.rememberPayload"
            className="btn-compact"
            disabled={!live}
            onClick={() => rememberPayload()}
          >
            Запомнить payload
          </ActionButton>
          <ActionButton
            helpId="modules.terminal.deleteSubject"
            className="btn-compact"
            disabled={!live || !canDeleteSubject}
            onClick={() => deleteCustomSubject()}
          >
            Удалить subject
          </ActionButton>
          <ActionButton
            helpId="modules.terminal.deletePayload"
            className="btn-compact"
            disabled={!live || !canDeletePayload}
            onClick={() => deleteCustomPayload()}
          >
            Удалить payload
          </ActionButton>
        </div>
        <button
          type="button"
          className="linkish"
          onClick={() => setShowPayloadRules((v) => !v)}
          style={{
            background: "none",
            border: "none",
            color: "inherit",
            cursor: "pointer",
            padding: 0,
            font: "inherit",
            alignSelf: "flex-start",
          }}
        >
          Правила payload {showPayloadRules ? "▾" : "▸"}
        </button>
        {showPayloadRules ? (
          <pre className="code-block lab-terminal-rules">
            {TERMINAL_PAYLOAD_RULES}
          </pre>
        ) : null}
      </div>
    </div>
  );
}
