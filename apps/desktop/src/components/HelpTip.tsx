/**
 * Знак «?» с кратким хелпом.
 * Popover позиционируется внутри окна (fixed), чтобы не уезжал за край.
 */

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { getControlHelp } from "@service-monitor/core";

type Place = { top: number; left: number };

export function HelpTip({ controlId }: { controlId: string }) {
  const help = getControlHelp(controlId);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<Place>({ top: 0, left: 0 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !btnRef.current || !popRef.current) return;

    const pad = 8;
    const btn = btnRef.current.getBoundingClientRect();
    const pop = popRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Предпочитаем снизу; если не влезает — сверху.
    let top = btn.bottom + pad;
    if (top + pop.height > vh - pad) {
      top = Math.max(pad, btn.top - pop.height - pad);
    }

    // Предпочитаем слева от кнопки; если вылезает вправо — прижимаем.
    let left = btn.left;
    if (left + pop.width > vw - pad) {
      left = Math.max(pad, vw - pop.width - pad);
    }
    if (left < pad) left = pad;

    setPlace({ top, left });
  }, [open, help?.body]);

  if (!help) return null;

  return (
    <div className={`help-tip${open ? " open" : ""}`} ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        aria-label={`Справка: ${help.title}`}
        aria-expanded={open}
        aria-controls={popoverId}
        onClick={() => setOpen((v) => !v)}
      >
        ?
      </button>
      {open ? (
        <div
          className="help-popover"
          id={popoverId}
          role="dialog"
          ref={popRef}
          style={{ top: place.top, left: place.left }}
        >
          <strong>{help.title}</strong>
          <p>{help.body}</p>
        </div>
      ) : null}
    </div>
  );
}
