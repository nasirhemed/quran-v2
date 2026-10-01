import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  error: Error | null;
}

/**
 * Without this, an error while drawing any page unmounts the whole app and leaves a blank screen. This keeps the
 * header, shows what broke (so it can be reported), and offers to try again or reload. Going to another page
 * (a new `resetKey`) clears it.
 */
export default class ErrorBoundary extends Component<{ resetKey: string; children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: { resetKey: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const details = [`${error.name}: ${error.message}`, ...(error.stack?.split("\n").slice(1, 6) ?? [])].join("\n");
    return (
      <div className="max-w-xl mx-auto px-4 py-16">
        <div className="bg-card border border-edge rounded-xl p-6 space-y-4">
          <h1 className="text-lg font-semibold text-ink">Something went wrong on this page</h1>
          <p className="text-sm text-muted">
            Trying again usually works. If it keeps happening, the message below says what broke.
          </p>
          <pre className="text-xs text-ink-soft bg-card2 rounded-lg p-3 whitespace-pre-wrap break-words max-h-48 overflow-auto">
            {details}
          </pre>
          <div className="flex gap-2">
            <button
              onClick={() => this.setState({ error: null })}
              className="bg-primary text-on-primary rounded-lg px-4 py-2 text-sm font-semibold hover:opacity-90 transition-opacity"
            >
              Try again
            </button>
            <button
              onClick={() => location.reload()}
              className="border border-edge-strong text-ink rounded-lg px-4 py-2 text-sm font-medium hover:bg-card2 transition-colors"
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
