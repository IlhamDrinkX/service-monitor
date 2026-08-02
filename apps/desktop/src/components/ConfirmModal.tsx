/**
 * Confirm для опасных действий: описание риска + краткий cheat-sheet.
 */

import type { ReactNode } from "react";

export type ConfirmModalProps = {
  open: boolean;
  title: string;
  /** Описание опасности / последствий. */
  danger: string;
  /** Короткие строки cheat-sheet (NATS subject, что нажмёт). */
  cheatSheet?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
};

export function ConfirmModal({
  open,
  title,
  danger,
  cheatSheet,
  confirmLabel = "Выполнить",
  cancelLabel = "Отмена",
  busy = false,
  onConfirm,
  onCancel,
  children,
}: ConfirmModalProps) {
  if (!open) return null;

  return (
    <div
      className="confirm-modal-backdrop"
      role="presentation"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        className="confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-modal-title">{title}</h2>
        <p className="confirm-modal-danger">{danger}</p>
        {cheatSheet && cheatSheet.length > 0 ? (
          <div className="confirm-modal-cheat">
            <div className="confirm-modal-cheat-label">Кратко</div>
            <ul>
              {cheatSheet.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {children}
        <div className="row confirm-modal-actions">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="btn primary danger-confirm"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
