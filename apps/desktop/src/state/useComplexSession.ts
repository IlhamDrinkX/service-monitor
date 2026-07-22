/**
 * Хук сессии — отдельный файл, чтобы HMR не ломал UI.
 */

import { useContext } from "react";
import {
  SessionContext,
  type SessionContextValue,
} from "./SessionContext";

export function useComplexSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useComplexSession outside SessionProvider");
  }
  return ctx;
}
