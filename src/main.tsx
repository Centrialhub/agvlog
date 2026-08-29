import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { installGlobalErrorTelemetry } from "./lib/observability/frontendTelemetry";
import { installPerformanceTelemetry } from "./lib/observability/performanceTelemetry";
import "./index.css";

installGlobalErrorTelemetry();
installPerformanceTelemetry();

createRoot(document.getElementById("root")!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);
