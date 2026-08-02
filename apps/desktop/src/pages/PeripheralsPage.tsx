/**
 * Дозатор: NATS-сиропы на комплексе + стенд Modbus/flash + legacy окна.
 */

import { useState } from "react";
import { ActionButton } from "../components/ActionButton";
import { ComplexSirupPanel } from "../components/ComplexSirupPanel";
import { HelpTip } from "../components/HelpTip";
import { SyrupFlashPanel } from "../components/SyrupFlashPanel";
import { useComplexSession } from "../state/useComplexSession";

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function PeripheralsPage() {
  const { session, warn } = useComplexSession();
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(
    null
  );
  /** Стенд Modbus/flash — свёрнут по умолчанию, чтобы не путать с полевым NATS */
  const [standOpen, setStandOpen] = useState(false);

  return (
    <div className="stack">
      <div className={`panel${warn ? " panel-warn" : ""}`}>
        <h2 className="row" style={{ gap: 8, alignItems: "center" }}>
          Дозатор
          <HelpTip controlId="nav.peripherals" />
        </h2>
        <p className="lead">
          На готовом комплексе — сиропы через NATS (<code>complexos.sirup.*</code>
          ). Стенд прошивки (Host <code>dozator</code>) — ниже, свёрнут.
          Legacy: <code>flash_obraz</code> / <code>sirup_test</code>.
        </p>
        {toast ? (
          <div className={`toast${toast.error ? " error" : ""}`}>
            {toast.text}
          </div>
        ) : null}
      </div>

      <ComplexSirupPanel
        busy={busy}
        setBusy={setBusy}
        onToast={(t) => setToast(t)}
      />

      <div className="panel panel-compact stand-disclosure">
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <button
            type="button"
            className="btn stand-disclosure-btn"
            aria-expanded={standOpen}
            onClick={() => setStandOpen((v) => !v)}
          >
            <span className="stand-disclosure-chevron" aria-hidden>
              {standOpen ? "▾" : "▸"}
            </span>
            Стенд dozator (Modbus / прошивка)
          </button>
          <HelpTip controlId="modules.syrup" />
        </div>
        {!standOpen ? (
          <p className="muted stand-disclosure-hint">
            Только для стенда прошивки плат (Host <code>dozator</code>), не для
            полевых сиропов на комплексе.
          </p>
        ) : null}
      </div>

      {standOpen ? (
        <SyrupFlashPanel
          busy={busy}
          setBusy={setBusy}
          onToast={(t) => setToast(t)}
        />
      ) : null}

      <div className="panel">
        <h2 className="row" style={{ gap: 8, alignItems: "center" }}>
          flash_obraz
          <HelpTip controlId="modules.flashObraz" />
        </h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Ansible-деплой образа (отдельное окно). Полный in-app port позже.
          Нужны Host <code>ansible</code> / <code>pusk</code>.
        </p>
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          <ActionButton
            helpId="modules.flashObraz"
            disabled={busy !== null}
            onClick={() =>
              void window.desktop
                .launchFleetTool({
                  tool: "flash_obraz",
                  seriesLabel: session.seriesLabel ?? undefined,
                })
                .catch((e) => setToast({ text: errText(e), error: true }))
            }
          >
            Открыть flash_obraz
          </ActionButton>
        </div>
      </div>
    </div>
  );
}
