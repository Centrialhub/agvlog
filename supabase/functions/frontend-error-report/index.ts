import { createClient } from "@supabase/supabase-js";

import { corsHeaders } from "../_shared/cors.ts";

const JSON_HEADERS = { ...corsHeaders, "Content-Type": "application/json" };
const encoder = new TextEncoder();

function response(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });
}

function bounded(value: unknown, maximum: number, fallback = "unknown") {
  const normalized = typeof value === "string" ? value.trim() : "";
  return (normalized || fallback).slice(0, maximum);
}

function safeMessage(value: unknown) {
  return bounded(value, 2_000, "Unexpected application error")
    .replace(/bearer\s+[a-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, "[id]")
    .replace(/\b\d{9,}\b/g, "[number]")
    .slice(0, 500);
}

function validUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function fingerprint(salt: string, value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`${salt}:${value}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return response(405, { error: "method_not_allowed" });

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > 8_192) return response(413, { error: "payload_too_large" });

  const authorization = request.headers.get("authorization");
  if (!authorization) return response(401, { error: "missing_authorization" });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceKey) return response(503, { error: "collector_not_configured" });

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
    });
    const { data: { user }, error: userError } = await callerClient.auth.getUser();
    if (userError || !user) return response(401, { error: "invalid_token" });

    const rawBody = await request.text();
    if (encoder.encode(rawBody).byteLength > 8_192) return response(413, { error: "payload_too_large" });
    const body = JSON.parse(rawBody) as Record<string, unknown>;
    const tenantId = validUuid(body.tenant_id) ? body.tenant_id : null;
    const adminClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    if (tenantId) {
      const { data: membership, error: membershipError } = await adminClient
        .from("tenant_memberships")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("user_id", user.id)
        .eq("active", true)
        .maybeSingle();
      if (membershipError || !membership) return response(403, { error: "tenant_access_denied" });
    }

    const actorFingerprint = await fingerprint(serviceKey, user.id);
    const tenantFingerprint = tenantId ? await fingerprint(serviceKey, tenantId) : null;
    const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
    if (body.kind === "web_vital") {
      const metricName = String(body.metric_name ?? "");
      const metricValue = Number(body.metric_value);
      const rating = String(body.rating ?? "");
      if (!["LCP", "CLS", "INP", "TTFB"].includes(metricName) ||
          !Number.isFinite(metricValue) || metricValue < 0 || metricValue >= 10_000_000 ||
          !["good", "needs-improvement", "poor"].includes(rating)) {
        return response(400, { error: "invalid_web_vital" });
      }
      const { count: metricCount } = await adminClient
        .from("application_web_vitals")
        .select("id", { count: "exact", head: true })
        .eq("actor_fingerprint", actorFingerprint)
        .gte("received_at", oneMinuteAgo);
      if ((metricCount ?? 0) >= 20) return response(429, { error: "rate_limited" });

      const metricCorrelation = request.headers.get("x-correlation-id");
      const metricCorrelationId = validUuid(metricCorrelation)
        ? metricCorrelation
        : validUuid(body.correlation_id) ? body.correlation_id : crypto.randomUUID();
      const { error: metricError } = await adminClient.from("application_web_vitals").insert({
        correlation_id: metricCorrelationId,
        actor_fingerprint: actorFingerprint,
        tenant_fingerprint: tenantFingerprint,
        release: bounded(body.release, 80, "unknown").replace(/[^a-z0-9._-]/gi, "_") || "unknown",
        route: bounded(body.route, 200, "/"),
        metric_name: metricName,
        metric_value: metricValue,
        rating,
        occurred_at: new Date().toISOString(),
      });
      if (metricError) return response(503, { error: "collector_unavailable", correlation_id: metricCorrelationId });
      return response(202, { accepted: true, correlation_id: metricCorrelationId });
    }
    const { count } = await adminClient
      .from("application_error_events")
      .select("id", { count: "exact", head: true })
      .eq("actor_fingerprint", actorFingerprint)
      .gte("received_at", oneMinuteAgo);
    if ((count ?? 0) >= 20) return response(429, { error: "rate_limited" });

    const headerCorrelation = request.headers.get("x-correlation-id");
    const correlationId = validUuid(headerCorrelation)
      ? headerCorrelation
      : validUuid(body.correlation_id) ? body.correlation_id : crypto.randomUUID();
    const occurredAt = typeof body.occurred_at === "string" && !Number.isNaN(Date.parse(body.occurred_at))
      ? new Date(body.occurred_at).toISOString()
      : new Date().toISOString();
    const phase = ["boundary", "window", "promise", "manual"].includes(String(body.phase))
      ? String(body.phase)
      : null;

    const { error: insertError } = await adminClient.from("application_error_events").insert({
      correlation_id: correlationId,
      actor_fingerprint: actorFingerprint,
      tenant_fingerprint: tenantFingerprint,
      release: bounded(body.release, 80, "unknown").replace(/[^a-z0-9._-]/gi, "_") || "unknown",
      route: bounded(body.route, 200, "/"),
      error_name: bounded(body.error_name, 80, "Error").replace(/[^a-z0-9_.-]/gi, "_") || "Error",
      safe_message: safeMessage(body.message),
      component_stack: typeof body.component_stack === "string" ? body.component_stack.slice(0, 2_000) : null,
      phase,
      client_family: bounded(body.client_family, 80, "unknown"),
      occurred_at: occurredAt,
    });
    if (insertError) {
      console.error("[frontend-error-report] insert failed", {
        correlation_id: correlationId,
        code: insertError.code,
      });
      return response(503, { error: "collector_unavailable", correlation_id: correlationId });
    }

    return response(202, { accepted: true, correlation_id: correlationId });
  } catch (cause: unknown) {
    console.error("[frontend-error-report] rejected", {
      error_name: cause instanceof Error ? cause.name : "UnknownError",
    });
    return response(400, { error: "invalid_report" });
  }
});
