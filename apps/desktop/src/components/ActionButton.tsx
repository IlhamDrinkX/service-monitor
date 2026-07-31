/**
 * Кнопка с опциональным знаком «?».
 */

import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { HelpTip } from "./HelpTip";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  helpId?: string;
  variant?: "default" | "primary";
  children: ReactNode;
  buttonRef?: Ref<HTMLButtonElement>;
};

export function ActionButton({
  helpId,
  variant = "default",
  children,
  className,
  buttonRef,
  ...rest
}: Props) {
  return (
    <span className="row" style={{ gap: 6 }}>
      <button
        ref={buttonRef}
        type="button"
        className={`btn${variant === "primary" ? " primary" : ""}${className ? ` ${className}` : ""}`}
        {...rest}
      >
        {children}
      </button>
      {helpId ? <HelpTip controlId={helpId} /> : null}
    </span>
  );
}
