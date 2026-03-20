"use client";
import { Component, ReactNode } from "react";

interface Props  { children: ReactNode; label?: string; }
interface State  { error: Error | null; }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  // E4: report client-side crashes to the server error store
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    fetch("/api/errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: error.message,
        stack: error.stack,
        componentStack: info.componentStack,
      }),
    }).catch(() => {}); // best-effort, don't block rendering
  }

  render() {
    if (this.state.error) {
      return (
        <div className="eb-fallback">
          <div className="eb-fallback__icon"><i className="fa-solid fa-triangle-exclamation" /></div>
          <div className="eb-fallback__title">Error en {this.props.label ?? "el component"}</div>
          <div className="eb-fallback__msg">{this.state.error.message}</div>
          <button className="eb-fallback__retry"
            onClick={() => this.setState({ error: null })}>
            Reintenta
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
