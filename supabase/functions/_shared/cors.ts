const DEFAULT_ALLOWED_HEADERS = [
  "authorization",
  "x-client-info",
  "apikey",
  "content-type",
  "x-supabase-client-platform",
  "x-supabase-client-platform-version",
  "x-supabase-client-runtime",
  "x-supabase-client-runtime-version",
  "x-retry-count",
  "x-agvlog-cron-secret",
  "x-fiscal-token",
  "x-webhook-secret",
  "x-webhook-id",
  "x-delivery-id",
  "x-hubfiscal-delivery",
  "x-hubfiscal-event",
  "x-hubfiscal-signature",
  "x-hubfiscal-timestamp",
  "x-correlation-id",
  "idempotency-key",
].join(", ");

declare const Deno: {
  env: { get(name: string): string | undefined };
};

// This repository is deployed at this exact public origin. Keep the environment
// override so previews/self-hosted environments can opt in explicitly, while the
// production deployment remains fail-closed if the secret is ever missing.
const PRODUCTION_APP_ORIGIN = "https://agvlog.lovable.app";

function readAllowedOrigin(): string | undefined {
  const configured = Deno.env.get("AGVLOG_APP_ORIGIN")?.trim() || PRODUCTION_APP_ORIGIN;

  try {
    const url = new URL(configured);
    const isSecure = url.protocol === "https:";
    const isLocal =
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1");

    if ((!isSecure && !isLocal) || url.origin !== configured.replace(/\/$/, "")) {
      console.error("AGVLOG_APP_ORIGIN must be an HTTPS origin or a localhost HTTP origin");
      return undefined;
    }

    return url.origin;
  } catch {
    console.error("AGVLOG_APP_ORIGIN is not a valid origin");
    return undefined;
  }
}

export const appOrigin = readAllowedOrigin();

/**
 * Shared, fail-closed CORS policy for Edge Functions.
 * AGVLOG_APP_ORIGIN may override the repository's exact production origin.
 * Server-to-server requests do not require Access-Control-Allow-Origin.
 */
export const corsHeaders: Readonly<Record<string, string>> = Object.freeze({
  ...(appOrigin ? { "Access-Control-Allow-Origin": appOrigin } : {}),
  "Access-Control-Allow-Headers": DEFAULT_ALLOWED_HEADERS,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin",
});
