import type { SupabaseClient } from "@supabase/supabase-js";

export interface FiscalWebhookClaim {
  inboxId: string;
  claimed: boolean;
  status: "processing" | "processed" | "failed" | "dead_lettered";
  retryAfterSeconds: number;
  deliveryId: string;
}

interface ClaimRow {
  inbox_id: string;
  claimed: boolean;
  inbox_status: FiscalWebhookClaim["status"];
  retry_after_seconds: number | null;
}

interface ClaimOptions {
  request: Request;
  admin: SupabaseClient;
  source: string;
  eventType: string;
  payload: unknown;
  explicitDeliveryId?: string;
  eventTimestamp?: string;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(value)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readDeliveryId(request: Request, explicitDeliveryId?: string): string | undefined {
  return (
    explicitDeliveryId ||
    request.headers.get("x-webhook-id") ||
    request.headers.get("x-delivery-id") ||
    request.headers.get("idempotency-key") ||
    undefined
  )?.trim();
}

export async function claimFiscalWebhook(options: ClaimOptions): Promise<FiscalWebhookClaim> {
  const payloadHash = await sha256(options.payload);
  const providerDeliveryId = readDeliveryId(options.request, options.explicitDeliveryId);
  const deliveryId = `${options.source}:${providerDeliveryId || payloadHash}`.slice(0, 512);
  const parsedTimestamp = options.eventTimestamp ? new Date(options.eventTimestamp) : null;
  const eventTimestamp = parsedTimestamp && !Number.isNaN(parsedTimestamp.valueOf())
    ? parsedTimestamp.toISOString()
    : new Date().toISOString();

  const { data, error } = await options.admin.rpc("claim_fiscal_webhook_delivery_v1", {
    p_delivery_id: deliveryId,
    p_event_type: options.eventType,
    p_raw_payload: options.payload,
    p_event_timestamp: eventTimestamp,
    p_payload_hash: payloadHash,
  });
  if (error) throw new Error(`webhook_inbox_claim_failed:${error.message}`);

  const row = (Array.isArray(data) ? data[0] : data) as ClaimRow | null;
  if (!row?.inbox_id) throw new Error("webhook_inbox_claim_returned_no_row");

  return {
    inboxId: row.inbox_id,
    claimed: row.claimed,
    status: row.inbox_status,
    retryAfterSeconds: row.retry_after_seconds ?? 0,
    deliveryId,
  };
}

export async function completeFiscalWebhook(
  admin: SupabaseClient,
  claim: Pick<FiscalWebhookClaim, "inboxId">,
  options: {
    success: boolean;
    tenantId?: string;
    emissionId?: string;
    error?: string;
  },
): Promise<void> {
  const { data, error } = await admin.rpc("complete_fiscal_webhook_delivery_v1", {
    p_inbox_id: claim.inboxId,
    p_success: options.success,
    p_tenant_id: options.tenantId ?? null,
    p_emission_id: options.emissionId ?? null,
    p_error: options.error ?? null,
  });
  if (error) throw new Error(`webhook_inbox_complete_failed:${error.message}`);
  if (data !== true) throw new Error("webhook_inbox_claim_was_not_processing");
}

export function duplicateWebhookResponse(
  claim: FiscalWebhookClaim,
  corsHeaders: Readonly<Record<string, string>>,
): Response {
  const retryable = claim.status === "processing" || claim.status === "failed";
  const processed = claim.status === "processed";
  return new Response(
    JSON.stringify({
      success: processed,
      duplicate: true,
      status: claim.status,
      delivery_id: claim.deliveryId,
    }),
    {
      status: retryable ? 503 : processed ? 200 : 202,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        ...(retryable
          ? { "Retry-After": String(Math.max(1, claim.retryAfterSeconds || 15)) }
          : {}),
      },
    },
  );
}
