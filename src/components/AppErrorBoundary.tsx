import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportFrontendError } from "@/lib/observability/frontendTelemetry";

type Props = { children: ReactNode };
type State = { failed: boolean };

export class AppErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    void reportFrontendError(error, {
      phase: "boundary",
      componentStack: info.componentStack,
    }).catch(() => undefined);
  }

  override render() {
    if (!this.state.failed) return this.props.children;

    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
        <section role="alert" className="w-full max-w-lg rounded-lg border bg-card p-8 text-center shadow-sm">
          <h1 className="text-2xl font-semibold">Não foi possível abrir esta tela</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            O erro foi isolado para evitar perda de contexto. Recarregue a aplicação e tente novamente.
          </p>
          <button
            type="button"
            className="mt-6 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            onClick={() => window.location.reload()}
          >
            Recarregar aplicação
          </button>
        </section>
      </main>
    );
  }
}
