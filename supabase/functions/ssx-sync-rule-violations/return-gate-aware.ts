/** Reviewed return entrypoint: keep SSX dispatch suspended without mutating state. */
import { createClient } from "@supabase/supabase-js";
import { isCronRequest } from "../_shared/cron-auth.ts";
import { requireIntegrationCapability } from "../_shared/capabilities.ts";
import {
  corsHeaders, getTenantRole, getWorkspaceRoleForAccount, requireWorkspaceAccountContext,
} from "../_shared/ssx-utils.ts";

type JsonObject = Record<string, unknown>;
const CHECKPOINT_RESOURCE = "rule_violations_gate";
const DATABASE_TIMEOUT_MS = 10_000;
function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function timestamp(value: unknown): number {
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}
function cursorDeadline(cursor: JsonObject | null): number {
  const code = cursor?.last_error_code;
  const match = typeof code === "string" ? /^rate_limited(?::(\d{1,5}))?$/.exec(code) : null;
  if (!match) return 0;
  const seconds = Math.max(900, Math.min(86400, Number(match[1] || 900)));
  return timestamp(cursor?.updated_at) + seconds * 1000;
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return response({ error: "Method not allowed" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const cron = await isCronRequest(req, url, serviceKey);
    let callerId: string | null = null;
    if (!cron) {
      const authorization = req.headers.get("Authorization") || "";
      if (!authorization.startsWith("Bearer ")) return response({ error: "Unauthorized" }, 401);
      const anon = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
      const { data, error } = await anon.auth.getUser();
      if (error || !data?.user) return response({ error: "Unauthorized" }, 401);
      callerId = data.user.id;
    }
    const body = await req.json() as JsonObject;
    const accountId = typeof body.integration_account_id === "string" ? body.integration_account_id : "";
    if (!accountId) return response({ error: "integration_account_id required" }, 400);
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => fetch(input, {
        ...init, signal: AbortSignal.any([
          ...(init?.signal ? [init.signal] : []), AbortSignal.timeout(DATABASE_TIMEOUT_MS),
        ]),
      }) },
    });
    const { data: account, error: accountError } = await admin.from("integration_accounts")
      .select("id,tenant_id,workspace_id").eq("id", accountId).single();
    if (accountError || !account) return response({ error: "Integration account not found" }, 404);
    if (!cron && callerId) {
      const contextError = await requireWorkspaceAccountContext(req, admin, accountId);
      if (contextError) return contextError;
      const role = account.workspace_id
        ? await getWorkspaceRoleForAccount(admin, account.workspace_id, callerId)
        : await getTenantRole(admin, account.tenant_id, callerId);
      if (!role || !["owner", "admin"].includes(role)) return response({ error: "Forbidden" }, 403);
    }
    const capabilityError = await requireIntegrationCapability(admin, account.tenant_id, "ssx");
    if (capabilityError) return capabilityError;
    const { data: checkpoint, error: checkpointError } = await admin.from("ssx_sync_checkpoints")
      .select("status,lease_until,retry_at").eq("integration_account_id", accountId)
      .eq("resource", CHECKPOINT_RESOURCE).eq("scope_key", "").maybeSingle();
    const { data: cursor, error: cursorError } = await admin.from("ssx_rule_violation_cursors")
      .select("last_error_code,updated_at").eq("integration_account_id", accountId).maybeSingle();
    if (checkpointError || cursorError) return response({
      error: "Rule violation synchronization suspended", code: "rollback_state_unavailable",
    }, 502);
    const now = Date.now();
    const leaseUntil = checkpoint?.status === "running" ? timestamp(checkpoint.lease_until) : 0;
    const until = Math.max(leaseUntil, timestamp(checkpoint?.retry_at), cursorDeadline(cursor));
    // This return artifact never claims/releases a lease, writes an ACK or
    // queries the provider, even after cooldown expiry. Resume requires the
    // approved fenced entrypoint after all previous workers have drained.
    return response({
      success: true, status: "deferred", paused: true,
      reason: until > now ? leaseUntil === until ? "sync_in_progress" : "rate_limited_backoff" : "rollback_paused",
      retry_at: until > now ? new Date(until).toISOString() : undefined,
      retry_after_seconds: Math.max(0, Math.ceil((until - now) / 1000)),
      requests: 0, upserted: 0,
    });
  } catch {
    return response({ error: "Rule violation synchronization suspended", code: "rollback_state_unavailable" }, 502);
  }
});
