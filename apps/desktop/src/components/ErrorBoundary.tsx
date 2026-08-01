/**
 * Ловит React render/lifecycle crashes и пишет в smLog.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";
import { smLog } from "../lib/sm-log";

type Props = { children: ReactNode; label?: string };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    smLog("error", "react", `${this.props.label ?? "boundary"}: ${error.message}`, {
      stack: error.stack,
      componentStack: info.componentStack,
    });
  }

  render() {
    if (this.state.error) {
      return (
        <div className="panel panel-warn" style={{ margin: 16 }}>
          <h2>Сбой UI{this.props.label ? ` · ${this.props.label}` : ""}</h2>
          <p className="muted">{this.state.error.message}</p>
          <pre className="code-block" style={{ maxHeight: 200 }}>
            {this.state.error.stack}
          </pre>
          <p className="muted">
            Debug-лог включён автоматически. Скопируйте лог в Настройках или
            перезапустите вкладку.
          </p>
          <button
            type="button"
            className="btn primary"
            onClick={() => this.setState({ error: null })}
          >
            Попробовать снова
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
