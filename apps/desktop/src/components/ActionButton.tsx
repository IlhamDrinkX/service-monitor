/**
 * Кнопка с опциональным знаком «?».
 */

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { HelpTip } from "./HelpTip";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  helpId?: string;
  variant?: "default" | "primary";
  children: ReactNode;
};

export function ActionButton({
  helpId,
  variant = "default",
  children,
  className,
  ...rest
}: Props) {
  return (
    <span className="row" style={{ gap: 6 }}>
      <button
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
