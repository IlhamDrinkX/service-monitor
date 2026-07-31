/**
 * Клавиатурная навигация по полям формы.
 * Enter — к следующему полю / действию (в textarea — Ctrl/Cmd+Enter).
 */

import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";

export function focusEl(
  ref: RefObject<HTMLElement | null> | HTMLElement | null | undefined
) {
  const el = ref && "current" in ref ? ref.current : ref;
  if (!el) return;
  el.focus();
  if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  ) {
    try {
      if ("select" in el && typeof el.select === "function") {
        // не выделять весь number/password при табе — только text-like
        if (el instanceof HTMLInputElement && el.type === "text") el.select();
      }
    } catch {
      // ignore
    }
  }
}

type EnterOpts = {
  /** Вызвать вместо перехода (например Send) */
  onAction?: () => void;
  /** Следующий элемент */
  next?: RefObject<HTMLElement | null> | HTMLElement | null;
  /** В textarea обычный Enter = новая строка; Ctrl/Cmd+Enter = action/next */
  textareaUsesCtrlEnter?: boolean;
};

export function onEnterNavigate(
  e: ReactKeyboardEvent<HTMLElement>,
  opts: EnterOpts
) {
  if (e.key !== "Enter" || e.shiftKey || e.altKey) return;
  const target = e.target as HTMLElement;
  const isTextarea = target.tagName === "TEXTAREA";
  if (isTextarea && opts.textareaUsesCtrlEnter !== false) {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    if (opts.onAction) opts.onAction();
    else focusEl(opts.next);
    return;
  }
  if (e.ctrlKey || e.metaKey) {
    if (opts.onAction) {
      e.preventDefault();
      opts.onAction();
    }
    return;
  }
  // Prefer next field; if none — run action.
  e.preventDefault();
  if (opts.next) focusEl(opts.next);
  else if (opts.onAction) opts.onAction();
}
