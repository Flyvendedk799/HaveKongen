import { Component, type ReactNode } from "react";
import { Link } from "react-router-dom";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        role="alert"
        style={{
          minHeight: "60vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: "32px 20px",
          gap: 14,
        }}
      >
        <h1 style={{ fontSize: 28, margin: 0 }}>Noget gik galt</h1>
        <p style={{ color: "var(--ink-500)", maxWidth: 420 }}>
          Vi kunne ikke vise denne side lige nu. Prøv igen, eller gå tilbage til forsiden.
        </p>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn btn-primary btn-sm" onClick={this.reset}>
            Prøv igen
          </button>
          <Link to="/" className="btn btn-ghost btn-sm" onClick={this.reset}>
            Til forsiden
          </Link>
        </div>
      </div>
    );
  }
}
