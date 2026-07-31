/**
 * Stage 4: drinkx.json + ComplexOS cleaning timings.
 */

import { useEffect, useMemo, useState } from "react";
import {
  CLEANING_TIMING_KEYS,
  CLEANING_TIMING_LABELS,
  COMPLEXOS_SUBJECTS,
  getParamHint,
  listParamHints,
  summarizeJsonDiff,
  type CleaningTimingKey,
  type ParamHint,
} from "@service-monitor/core";
import { ActionButton } from "../components/ActionButton";
import { useComplexSession } from "../state/useComplexSession";

type ModuleRole = "milk" | "coffee" | "water";

function flattenKeys(obj: unknown, prefix = ""): string[] {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return [];
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    keys.push(path);
    keys.push(...flattenKeys(v, path));
  }
  return keys;
}

function unwrapResult(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object") return {};
  const r = data as Record<string, unknown>;
  if (r.result && typeof r.result === "object") {
    return r.result as Record<string, unknown>;
  }
  return r;
}

export function ConfigPage() {
  const { session, warn } = useComplexSession();
  const sessionOk = session.connected && !warn;
  const [role, setRole] = useState<ModuleRole>("milk");
  const [text, setText] = useState("");
  const [original, setOriginal] = useState("");
  const [selectedPath, setSelectedPath] = useState("refill.currentTreshold");
  const [busy, setBusy] = useState(false);
  const [restartAfterSave, setRestartAfterSave] = useState(false);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(
    null
  );
  const [timingDraft, setTimingDraft] = useState<
    Partial<Record<CleaningTimingKey, number>>
  >({});
  const [timingLoaded, setTimingLoaded] = useState(false);

  const unlocked =
    typeof sessionStorage !== "undefined" &&
    sessionStorage.getItem("sm.writeUnlocked") === "1";

  const hint: ParamHint | undefined = useMemo(
    () => getParamHint(selectedPath),
    [selectedPath]
  );

  const keyList = useMemo(() => {
    try {
      return flattenKeys(JSON.parse(text || "{}")).slice(0, 120);
    } catch {
      return listParamHints().map((h) => h.path);
    }
  }, [text]);

  const dirty = text !== original && text.length > 0;
  const diffLines = useMemo(
    () => (dirty && original ? summarizeJsonDiff(original, text) : []),
    [dirty, original, text]
  );

  useEffect(() => {
    void window.desktop.natsInfo().then((info) => {
      if (!info.connected && session.natsUrl && sessionOk) {
        void window.desktop.natsConnect(session.natsUrl);
      }
    });
  }, [session.natsUrl, sessionOk]);

  async function load() {
    if (!sessionOk) {
      setToast({ text: "Сначала подключите сессию", error: true });
      return;
    }
    setBusy(true);
    setToast(null);
    const res = await window.desktop.drinkxRead({ role });
    setBusy(false);
    if (!res.ok) {
      setToast({ text: res.error, error: true });
      return;
    }
    setText(res.text);
    setOriginal(res.text);
    setToast({ text: `Загружено с ${res.label}` });
  }

  async function save() {
    if (!sessionOk) {
      setToast({ text: "Сначала подключите сессию", error: true });
      return;
    }
    if (!unlocked) {
      setToast({
        text: "Разблокируйте правки в Настройках (сервисный пароль)",
        error: true,
      });
      return;
    }
    setBusy(true);
    setToast(null);
    const res = await window.desktop.drinkxWrite({
      role,
      text,
      unlocked: true,
      restart: restartAfterSave,
    });
    setBusy(false);
    if (!res.ok) {
      setToast({ text: res.error, error: true });
      return;
    }
    setOriginal(text);
    const restartNote =
      restartAfterSave && res.restartDetail != null
        ? res.restarted
          ? ` · cm-drv restart: ${res.restartDetail}`
          : ` · restart fail: ${res.restartDetail}`
        : "";
    setToast({
      text: `Записано → ${res.path}${restartNote}`,
    });
  }

  async function restartOnly() {
    if (!sessionOk) {
      setToast({ text: "Сначала подключите сессию", error: true });
      return;
    }
    setBusy(true);
    setToast(null);
    const res = await window.desktop.drinkxRestart({ role });
    setBusy(false);
    if (!res.ok) {
      setToast({ text: res.error, error: true });
      return;
    }
    setToast({ text: `cm-drv restart · ${res.label}: ${res.detail}` });
  }

  function formatJson() {
    try {
      setText(`${JSON.stringify(JSON.parse(text), null, 2)}\n`);
      setToast({ text: "JSON отформатирован" });
    } catch {
      setToast({ text: "Невалидный JSON", error: true });
    }
  }

  async function loadCleaningTimings() {
    if (!sessionOk) {
      setToast({ text: "Сначала подключите сессию", error: true });
      return;
    }
    setBusy(true);
    setToast(null);
    try {
      const info = await window.desktop.natsConnect(
        session.natsUrl ?? undefined
      );
      if (!info.connected) {
        setToast({ text: info.message, error: true });
        return;
      }
      const res = await window.desktop.natsRequest({
        subject: COMPLEXOS_SUBJECTS.cleaningConfig,
        payload: {},
        timeoutMs: 5_000,
        priority: "command",
      });
      if (!res.ok) {
        setToast({ text: res.error, error: true });
        return;
      }
      const body = unwrapResult(res.data);
      const draft: Partial<Record<CleaningTimingKey, number>> = {};
      for (const k of CLEANING_TIMING_KEYS) {
        const v = Number(body[k]);
        if (Number.isFinite(v)) draft[k] = v;
      }
      setTimingDraft(draft);
      setTimingLoaded(true);
      setToast({ text: "ComplexOS cleaning-config загружен" });
    } finally {
      setBusy(false);
    }
  }

  async function saveCleaningTimings() {
    if (!unlocked) {
      setToast({
        text: "Разблокируйте правки в Настройках (сервисный пароль)",
        error: true,
      });
      return;
    }
    if (
      !window.confirm(
        "Записать cleaning timings через coffeemachine.update-config?\n" +
          "Это runtime; durable источник — ERP osconfig."
      )
    ) {
      return;
    }
    setBusy(true);
    setToast(null);
    try {
      const patch: Record<string, number> = {};
      for (const k of CLEANING_TIMING_KEYS) {
        const v = timingDraft[k];
        if (typeof v === "number" && Number.isFinite(v)) patch[k] = v;
      }
      const res = await window.desktop.natsUpdateConfig(patch);
      if (!res.ok) {
        setToast({ text: res.error, error: true });
        return;
      }
      setToast({ text: "timings записаны (update-config)" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className={`panel${warn ? " panel-warn" : ""}`}>
        <h2>drinkx.json · Stage 4</h2>
        <p className="lead">
          Конфиг: <code>~/.config/andromeda/drinkx.json</code>. SSH пароль{" "}
          <code>pi</code>. Подсказки — из cm-drv (drinkx.js / pid.js) + KB.
        </p>
        <div className="row">
          <span className={`badge${sessionOk ? " on" : " danger"}`}>
            {sessionOk ? `сессия ${session.mode}` : session.message}
          </span>
          <span className={`badge${unlocked ? " on" : ""}`}>
            {unlocked ? "правки разрешены" : "только чтение"}
          </span>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          {(["milk", "coffee", "water"] as const).map((r) => (
            <button
              key={r}
              type="button"
              className={`mode-chip${role === r ? " active" : ""}`}
              disabled={busy}
              onClick={() => setRole(r)}
            >
              {r}
            </button>
          ))}
          <ActionButton
            helpId="config.load"
            disabled={busy || !sessionOk}
            onClick={() => void load()}
          >
            {busy ? "…" : "Загрузить"}
          </ActionButton>
          <ActionButton
            helpId="config.save"
            variant="primary"
            disabled={busy || !sessionOk || !unlocked || !dirty}
            onClick={() => void save()}
          >
            Сохранить
          </ActionButton>
          <ActionButton
            disabled={busy || !sessionOk}
            onClick={() => void restartOnly()}
          >
            Restart cm-drv
          </ActionButton>
          <ActionButton disabled={!text} onClick={formatJson}>
            Format
          </ActionButton>
        </div>
        <label
          className="muted"
          style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}
        >
          <input
            type="checkbox"
            checked={restartAfterSave}
            onChange={(e) => setRestartAfterSave(e.target.checked)}
          />
          После сохранения перезапустить cm-drv (по умолчанию выкл. — не рвёт NATS)
        </label>
        {toast ? (
          <div className={`toast${toast.error ? " error" : ""}`}>
            {toast.text}
          </div>
        ) : null}
      </div>

      <div className="panel">
        <h2>ComplexOS · cleaning timings</h2>
        <p className="lead">
          Чтение <code>complexos.dashboard.cleaning-config</code>, запись{" "}
          <code>coffeemachine.update-config</code>. Полный{" "}
          <code>osconfig</code> ERP по NATS не пишется — только runtime timings.
        </p>
        <div className="row">
          <ActionButton
            disabled={busy || !sessionOk}
            onClick={() => void loadCleaningTimings()}
          >
            Загрузить timings
          </ActionButton>
          <ActionButton
            variant="primary"
            disabled={busy || !sessionOk || !unlocked || !timingLoaded}
            onClick={() => void saveCleaningTimings()}
          >
            Сохранить timings
          </ActionButton>
        </div>
        {timingLoaded ? (
          <div className="cos-timing-grid" style={{ marginTop: 12 }}>
            {CLEANING_TIMING_KEYS.map((k) => (
              <label key={k} className="muted">
                {CLEANING_TIMING_LABELS[k]}
                <input
                  type="number"
                  value={timingDraft[k] ?? ""}
                  disabled={!unlocked}
                  onChange={(e) =>
                    setTimingDraft((prev) => ({
                      ...prev,
                      [k]: Number(e.target.value) || 0,
                    }))
                  }
                />
              </label>
            ))}
          </div>
        ) : (
          <p className="muted" style={{ marginTop: 10 }}>
            Загрузите timings с комплекса.
          </p>
        )}
      </div>

      <div className="grid-2">
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>JSON</h2>
          <textarea
            className="code-editor"
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            placeholder="Загрузите drinkx.json с модуля…"
          />
          {dirty ? (
            <div style={{ marginTop: 10 }}>
              <p className="muted" style={{ color: "var(--warn)", margin: 0 }}>
                Несохранено · верхнеуровневый diff:
              </p>
              <ul className="muted" style={{ marginTop: 6, lineHeight: 1.4 }}>
                {diffLines.slice(0, 12).map((l) => (
                  <li key={l}>
                    <code>{l}</code>
                  </li>
                ))}
                {diffLines.length > 12 ? (
                  <li>…ещё {diffLines.length - 12}</li>
                ) : null}
              </ul>
            </div>
          ) : null}
        </div>
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Подсказки из кода</h2>
          <div className="field">
            <label htmlFor="hint-path">Параметр</label>
            <select
              id="hint-path"
              value={selectedPath}
              onChange={(e) => setSelectedPath(e.target.value)}
            >
              {listParamHints().map((h) => (
                <option key={h.path} value={h.path}>
                  {h.path}
                </option>
              ))}
              {keyList
                .filter((k) => !listParamHints().some((h) => h.path === k))
                .map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
            </select>
          </div>
          {hint ? (
            <div style={{ marginTop: 12 }}>
              <strong>{hint.title}</strong>
              <p className="lead">{hint.summary}</p>
              {hint.codeRef ? (
                <p className="muted" style={{ marginTop: 8 }}>
                  Код: <code>{hint.codeRef}</code>
                </p>
              ) : null}
              {hint.warnings?.map((w) => (
                <p
                  key={w}
                  className="muted"
                  style={{ color: "var(--warn)", marginTop: 8 }}
                >
                  ⚠ {w}
                </p>
              ))}
            </div>
          ) : (
            <p className="muted">Нет шпаргалки для этого ключа.</p>
          )}
        </div>
      </div>
    </div>
  );
}
