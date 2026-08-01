/**
 * Дозатор (Modbus/flash) и flash_obraz — отдельная вкладка навигации.
 */

import { useState } from "react";
import { ActionButton } from "../components/ActionButton";
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

  return (
    <div className="stack">
      <div className={`panel${warn ? " panel-warn" : ""}`}>
        <h2 className="row" style={{ gap: 8, alignItems: "center" }}>
          Дозатор · Flash
          <HelpTip controlId="nav.peripherals" />
        </h2>
        <p className="lead">
          Сиропный dozator по SSH (Modbus / flash partA·B) и legacy{" "}
          <code>flash_obraz</code>. Нужна сессия комплекса и Host{" "}
          <code>dozator</code> / <code>ansible</code> в ssh config.
        </p>
        {toast ? (
          <div className={`toast${toast.error ? " error" : ""}`}>
            {toast.text}
          </div>
        ) : null}
      </div>

      <SyrupFlashPanel
        busy={busy}
        setBusy={setBusy}
        onToast={(t) => setToast(t)}
      />

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
          <ActionButton
            className="btn-compact"
            disabled={busy !== null}
            onClick={() =>
              void window.desktop
                .launchFleetTool({ tool: "sirup_test" })
                .catch((e) => setToast({ text: errText(e), error: true }))
            }
          >
            sirup_test (окно)
          </ActionButton>
          <ActionButton
            className="btn-compact"
            disabled={busy !== null}
            onClick={() =>
              void window.desktop
                .launchFleetTool({ tool: "flash_sirup" })
                .catch((e) => setToast({ text: errText(e), error: true }))
            }
          >
            flash_sirup (окно)
          </ActionButton>
        </div>
      </div>
    </div>
  );
}
