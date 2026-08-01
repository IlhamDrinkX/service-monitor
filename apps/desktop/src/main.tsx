/**
 * Точка входа renderer.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { installGlobalErrorLogging, smLog } from "./lib/sm-log";
import "./styles/theme.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("#root missing");
}

installGlobalErrorLogging();
smLog("info", "boot", "renderer start", {
  href: location.href,
  userAgent: navigator.userAgent.slice(0, 80),
});

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary label="App">
      <App />
    </ErrorBoundary>
  </StrictMode>
);
