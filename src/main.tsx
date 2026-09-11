import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { installGlobalErrorTelemetry } from "./lib/observability/frontendTelemetry";
import { installPerformanceTelemetry } from "./lib/observability/performanceTelemetry";
import "./index.css";

installGlobalErrorTelemetry();
installPerformanceTelemetry();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
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

createRoot(document.getElementById("root")!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);
