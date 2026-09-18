import { createRoot } from "react-dom/client";
import { publicRuntimeConfigIssues } from "./config/publicRuntimeConfig";
import "./index.css";

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').then(registration => {
      const announceUpdate=()=>window.dispatchEvent(new CustomEvent('agvlog:pwa-update',{detail:{registration}}));
      if(registration.waiting)announceUpdate();
      registration.addEventListener('updatefound',()=>{
        const worker=registration.installing;
        worker?.addEventListener('statechange',()=>{
          if(worker.state==='installed'&&navigator.serviceWorker.controller)announceUpdate();
        });
      });
      void registration.update();
    });
  });
}

function BootstrapFailure({ configuration = false }: { configuration?: boolean }) {
  const release = import.meta.env.VITE_APP_RELEASE || "desconhecida";
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <section role="alert" className="w-full max-w-lg rounded-lg border bg-card p-8 text-center shadow-sm">
        <h1 className="text-2xl font-semibold">
          {configuration ? "Aplicação indisponível por configuração" : "Não foi possível iniciar a aplicação"}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {configuration
            ? "Esta publicação não recebeu a configuração pública necessária para conectar ao serviço de dados. Nenhum dado foi alterado."
            : "Os arquivos desta publicação não puderam ser carregados. Recarregue a aplicação e tente novamente."}
        </p>
        <p className="mt-3 text-xs text-muted-foreground">Release: {release}</p>
        {!configuration && (
          <button
            type="button"
            className="mt-6 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            onClick={() => window.location.reload()}
          >
            Recarregar aplicação
          </button>
        )}
      </section>
    </main>
  );
}

const root = createRoot(document.getElementById("root")!);
const configurationIssues = publicRuntimeConfigIssues(import.meta.env);

if (configurationIssues.length > 0) {
  console.error("[bootstrap] invalid public runtime configuration", { issues: configurationIssues });
  root.render(<BootstrapFailure configuration />);
} else {
  void Promise.all([
    import("./App.tsx"),
    import("./components/AppErrorBoundary"),
    import("./lib/observability/frontendTelemetry"),
    import("./lib/observability/performanceTelemetry"),
  ]).then(([{ default: App }, { AppErrorBoundary }, { installGlobalErrorTelemetry }, { installPerformanceTelemetry }]) => {
    installGlobalErrorTelemetry();
    installPerformanceTelemetry();
    registerServiceWorker();
    root.render(
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>,
    );
  }).catch((error: unknown) => {
    console.error("[bootstrap] application modules failed to load", error);
    root.render(<BootstrapFailure />);
  });
}
