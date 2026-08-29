import { supabase } from "@/integrations/supabase/client";
import { getCorrelationId } from "./correlation";

type ErrorPhase = "boundary" | "window" | "promise" | "manual";

interface FrontendErrorContext {
  phase: ErrorPhase;
  componentStack?: string | null;
  tenantId?: string | null;
}

const RELEASE = import.meta.env.VITE_APP_RELEASE || "development";

function normalizeError(cause: unknown) {
  if (cause instanceof Error) return { name: cause.name || "Error", message: cause.message || "Unexpected error" };
  return { name: "UnknownError", message: typeof cause === "string" ? cause : "Unexpected error" };
}

function clientFamily() {
  const agent = navigator.userAgent;
  if (/Edg\//.test(agent)) return "Edge";
  if (/Chrome\//.test(agent)) return "Chrome";
  if (/Firefox\//.test(agent)) return "Firefox";
  if (/Safari\//.test(agent)) return "Safari";
  return "Other";
}

export async function reportFrontendError(cause: unknown, context: FrontendErrorContext) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;

  const normalized = normalizeError(cause);
  const correlationId = getCorrelationId();
  console.error("[frontend-error]", {
    correlation_id: correlationId,
    release: RELEASE,
    error_name: normalized.name,
    phase: context.phase,
  });

  await supabase.functions.invoke("frontend-error-report", {
    headers: { "x-correlation-id": correlationId },
    body: {
      correlation_id: correlationId,
      tenant_id: context.tenantId ?? null,
      release: RELEASE,
      route: `${window.location.pathname}${window.location.search}`,
      error_name: normalized.name,
      message: normalized.message,
      component_stack: context.componentStack ?? null,
      phase: context.phase,
      client_family: clientFamily(),
      occurred_at: new Date().toISOString(),
    },
  });
}

export function installGlobalErrorTelemetry() {
  window.addEventListener("error", (event) => {
    void reportFrontendError(event.error ?? event.message, { phase: "window" }).catch(() => undefined);
  });
  window.addEventListener("unhandledrejection", (event) => {
    void reportFrontendError(event.reason, { phase: "promise" }).catch(() => undefined);
  });
}
