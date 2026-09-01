/**
 * agvlog-pipeline-run — Orchestrates the SSX ingestion pipeline.
 *
 * Supports TWO modes via `pipeline_mode`:
 *   - "poll" (default for cron): token refresh + position polling + queue processing
 *   - "full": token refresh + unit sync + position polling + queue + daily aggregation
 *   - "manual": same as "full" but with force_rediscovery + wider lookback
 *   - "sync_units_only": only token refresh + unit sync
 *   - "aggregate_only": only daily aggregation
 *
 * Cadence design:
 *   - poll: every 3 minutes (cron)
 *   - full: every 6 hours or manual trigger
 *   - aggregate: once per day
 */

import { createClient } from "@supabase/supabase-js";
import { isCronRequest } from "../_shared/cron-auth.ts";
import { requireIntegrationCapability } from "../_shared/capabilities.ts";
import { corsHeaders } from "../_shared/cors.ts";

type PipelineMode = "poll" | "full" | "manual" | "sync_units_only" | "aggregate_only";
type JsonObject = Record<string, unknown>;

interface PipelineStats {
  pipeline_mode: PipelineMode;
  login: unknown;
  synced_units: number;
  polled_units: number;
  total_inserted: number;
  touched_vehicles: number;
  processed_vehicles: number;
  aggregated: number;
  state_computed: number;
  state_events: number;
  state_reprocessed: number;
  trip_live_status_updated: number;
  trip_live_status_deferred_reason: "cron_requires_actor_jwt" | null;
  errors: string[];
  needs_attention: string[];
  steps_executed: string[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function objectValue(value: unknown): JsonObject {
  return value && typeof value === "object" ? value as JsonObject : {};
}

function numberValue(value: unknown, key: string): number {
  const candidate = objectValue(value)[key];
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResp({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    let callerId: string | null = null;
    const authHeader = req.headers.get("Authorization") || "";

    const cronSecret = req.headers.get("x-agvlog-cron-secret");
    const isCron = await isCronRequest(req, supabaseUrl, serviceKey);

    if (!isCron) {
      if (!authHeader?.startsWith("Bearer ")) {
        return jsonResp({ error: "Unauthorized" }, 401);
      }
      const anonClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData, error: userError } = await anonClient.auth.getUser();
      if (userError || !userData?.user) {
        return jsonResp({ error: "Unauthorized" }, 401);
      }
      callerId = userData.user.id;
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const body = await req.json();
    const {
      tenant_id,
      integration_account_id,
      pipeline_mode,
      manual_run = false,
      force_rediscovery = false,
      lookback_minutes,
      provider_unit_ids,
    } = body;

    // Determine effective mode
    const allowedModes = new Set<PipelineMode>([
      "poll", "full", "manual", "sync_units_only", "aggregate_only",
    ]);
    let mode: PipelineMode = pipeline_mode || "poll";
    if (manual_run && !pipeline_mode) mode = "manual";

    if (!allowedModes.has(mode)) {
      return jsonResp({ error: "invalid pipeline_mode" }, 400);
    }

    if (!tenant_id) {
      return jsonResp({ error: "tenant_id required" }, 400);
    }

    // Verify admin (skip for cron)
    if (!isCron && callerId) {
      const { data: membership } = await supabase
        .from("tenant_memberships").select("role")
        .eq("tenant_id", tenant_id).eq("user_id", callerId).eq("active", true)
        .limit(1).single();
      if (!membership || !["owner", "admin"].includes(membership.role)) {
        return jsonResp({ error: "Forbidden" }, 403);
      }
    }

    const capabilityResponse = await requireIntegrationCapability(supabase, tenant_id, "ssx");
    if (capabilityResponse) return capabilityResponse;

    const stats: PipelineStats = {
      pipeline_mode: mode,
      login: null,
      synced_units: 0,
      polled_units: 0,
      total_inserted: 0,
      touched_vehicles: 0,
      processed_vehicles: 0,
      aggregated: 0,
      state_computed: 0,
      state_events: 0,
      state_reprocessed: 0,
      trip_live_status_updated: 0,
      trip_live_status_deferred_reason: null,
      errors: [] as string[],
      needs_attention: [] as string[],
      steps_executed: [] as string[],
    };

    // Get accounts to process
    let accountsQuery = supabase
      .from("integration_accounts")
      .select("id, status, token_expires_at, settings, last_error")
      .eq("tenant_id", tenant_id);

    if (integration_account_id) {
      accountsQuery = accountsQuery.eq("id", integration_account_id);
    }

    const { data: accounts } = await accountsQuery;
    if (!accounts || accounts.length === 0) {
      return jsonResp({ success: true, message: "No integration accounts", stats });
    }

    for (const account of accounts) {
      try {
        const accountSettings = account.settings && typeof account.settings === "object"
          ? account.settings as JsonObject
          : {};
        const requiresCredentialReentry = account.status === "invalid_credentials" &&
          (accountSettings.credential_reentry_required === true ||
            String(account.last_error || "").includes("informada novamente"));

        if (requiresCredentialReentry && mode !== "aggregate_only") {
          stats.steps_executed.push("credential_check");
          stats.needs_attention.push(`SSX ${account.id}: credential_reentry_required`);
          continue;
        }

        // ===== STEP A: Token refresh (always, when near expiry) =====
        if (mode !== "aggregate_only") {
          const minutesLeft = account.token_expires_at
            ? (new Date(account.token_expires_at).getTime() - Date.now()) / 60000
            : -1;

          if (minutesLeft < 60) {
            stats.steps_executed.push("token_refresh");
            const loginResp = await callEdgeFunction(supabaseUrl, anonKey, authHeader, isCron, cronSecret, "ssx-login", {
              integration_account_id: account.id,
            });
            stats.login = loginResp;
          }
        }

        // ===== STEP B: Unit sync (only on full/manual/sync_units_only) =====
        const shouldSyncUnits = mode === "full" || mode === "manual" || mode === "sync_units_only";
        if (shouldSyncUnits) {
          stats.steps_executed.push("sync_units");
          try {
            const syncResp = await callEdgeFunction(supabaseUrl, anonKey, authHeader, isCron, cronSecret, "ssx-sync-units", {
              integration_account_id: account.id,
              force: mode === "manual",
            });
            stats.synced_units += numberValue(syncResp, "upserted");
          } catch (e: unknown) {
            stats.errors.push(`SyncUnits ${account.id}: ${errorMessage(e)}`);
          }
        }

        if (mode === "sync_units_only") continue;
        if (mode === "aggregate_only") continue;

        // ===== STEP C: Position polling (poll/full/manual) =====
        stats.steps_executed.push("position_polling");

        // BROADBAND: Single call to ssx-poll-positions with ALL units (no batching).
        // The edge function does 1 SSX request and distributes positions locally.
        // Only manual mode uses per-unit batching for targeted discovery.
        const pollBody: JsonObject = {
          integration_account_id: account.id,
          manual_run: mode === "manual",
          force_rediscovery: mode === "manual" || force_rediscovery,
        };
        if (provider_unit_ids?.length) {
          pollBody.provider_unit_ids = provider_unit_ids;
        }
        if (lookback_minutes) pollBody.lookback_minutes = lookback_minutes;

        try {
          const pollResp = await callEdgeFunction(supabaseUrl, anonKey, authHeader, isCron, cronSecret, "ssx-poll-positions", pollBody);
          const pollResult = objectValue(pollResp);
          stats.polled_units += numberValue(pollResult, "total_units");
          stats.total_inserted += numberValue(pollResult, "total_inserted");
          stats.touched_vehicles += numberValue(pollResult, "touched_vehicles");

          if (pollResult.batch_aborted === true) {
            const reason = typeof pollResult.abort_reason === "string" ? pollResult.abort_reason : "unknown";
            stats.errors.push(`Polling stopped: ${reason}`);
            if (reason === "persistence_failure") {
              stats.errors.push("CRITICAL: persistence_failure — skipping queue processing");
            }
          }
        } catch (e: unknown) {
          const message = errorMessage(e);
          stats.errors.push(`Poll: ${message}`);
        }

        // ===== STEP C2: Compute vehicle state (always after polling) =====
        const hasPersistenceFailure = stats.errors.some(e => e.includes("persistence_failure"));
        if (!hasPersistenceFailure) {
          stats.steps_executed.push("compute_state");
          try {
            // Get all active vehicle IDs for this tenant that have positions
            const { data: vehiclesWithPos } = await supabase
              .from("positions_last").select("vehicle_id")
              .eq("tenant_id", tenant_id);
            const vehicleIds = (vehiclesWithPos || []).map((v) => v.vehicle_id);

            if (vehicleIds.length > 0) {
              const stateResp = await callEdgeFunction(supabaseUrl, anonKey, authHeader, isCron, cronSecret, "agvlog-compute-state", {
                tenant_id,
                vehicle_ids: vehicleIds,
                mode: "batch",
              });
              stats.state_computed = numberValue(stateResp, "processed");
              stats.state_events = numberValue(stateResp, "events_emitted");
            }
          } catch (e: unknown) {
            stats.errors.push(`ComputeState: ${errorMessage(e)}`);
          }
        }

        // ===== STEP D: Queue processing (only if polling didn't hit persistence failure) =====
        if (!hasPersistenceFailure && stats.total_inserted > 0) {
          stats.steps_executed.push("queue_processing");
          try {
            const queueResp = await callEdgeFunction(supabaseUrl, anonKey, authHeader, isCron, cronSecret, "agvlog-run-queue", {
              tenant_id, limit: 50,
            });
            stats.processed_vehicles = numberValue(queueResp, "processed");
          } catch (e: unknown) {
            stats.errors.push(`Queue: ${errorMessage(e)}`);
          }
        }
      } catch (e: unknown) {
        stats.errors.push(`Account ${account.id}: ${errorMessage(e)}`);
      }
    }

    // ===== STEP D2: Refresh operational trip state after committed telemetry =====
    // The Control Tower evaluator is intentionally caller-JWT-only. Forward the
    // original JWT for an authenticated administrative run; never impersonate a
    // user or grant service_role access when this orchestrator is running by cron.
    const hasPersistenceFailure = stats.errors.some(error => error.includes("persistence_failure"));
    if (stats.touched_vehicles > 0 && !hasPersistenceFailure) {
      if (!isCron && callerId) {
        stats.steps_executed.push("trip_live_status");
        try {
          const liveStatusResp = objectValue(await callEdgeFunction(
            supabaseUrl,
            anonKey,
            authHeader,
            false,
            null,
            "update-trip-live-status",
            { tenant_id },
          ));
          if (liveStatusResp.ok !== true) {
            throw new Error("live status refresh was not confirmed");
          }
          stats.trip_live_status_updated = numberValue(liveStatusResp, "processed");
        } catch (e: unknown) {
          stats.errors.push(`TripLiveStatus: ${errorMessage(e)}`);
        }
      } else {
        stats.trip_live_status_deferred_reason = "cron_requires_actor_jwt";
      }
    }

    // ===== STEP E: Daily aggregation (only on full/manual/aggregate_only) =====
    if (mode === "full" || mode === "manual" || mode === "aggregate_only") {
      stats.steps_executed.push("daily_aggregation");
      try {
        const aggResp = await callEdgeFunction(supabaseUrl, anonKey, authHeader, isCron, cronSecret, "agvlog-aggregate-daily", {
          tenant_id,
        });
        stats.aggregated = numberValue(aggResp, "aggregated");
      } catch (e: unknown) {
        stats.errors.push(`Aggregate: ${errorMessage(e)}`);
      }
    }

    // ===== STEP F: State reprocessing (only on full/manual) =====
    if (mode === "full" || mode === "manual") {
      stats.steps_executed.push("state_reprocess");
      try {
        const reprocessResp = await callEdgeFunction(supabaseUrl, anonKey, authHeader, isCron, cronSecret, "agvlog-compute-state", {
          tenant_id,
          mode: "reprocess",
        });
        stats.state_reprocessed = numberValue(reprocessResp, "processed");
      } catch (e: unknown) {
        stats.errors.push(`StateReprocess: ${errorMessage(e)}`);
      }
    }

    // ===== Update pipeline health on tenant settings =====
    try {
      const { data: tenantData } = await supabase
        .from("tenants").select("settings").eq("id", tenant_id).single();
      const tenantSettings = (tenantData?.settings as JsonObject) || {};
      const pipelineHealth: JsonObject = {
        ...((tenantSettings.pipeline_health && typeof tenantSettings.pipeline_health === "object")
          ? tenantSettings.pipeline_health as JsonObject
          : {}),
        last_run_at: new Date().toISOString(),
        last_run_mode: mode,
        last_run_inserted: stats.total_inserted,
        last_run_touched_vehicles: stats.touched_vehicles,
        last_run_polled: stats.polled_units,
        last_run_trip_live_status_updated: stats.trip_live_status_updated,
        last_run_trip_live_status_deferred_reason: stats.trip_live_status_deferred_reason,
        last_run_errors: stats.errors.length,
        last_run_steps: stats.steps_executed,
        last_run_status: stats.errors.length === 0
          ? (stats.needs_attention.length > 0 ? 'attention_required' : 'success')
          : stats.total_inserted > 0 ? 'partial' : 'failed',
        last_run_error_messages: stats.errors.slice(0, 20),
        last_run_attention: stats.needs_attention.slice(0, 20),
      };
      if (stats.total_inserted > 0) {
        pipelineHealth.last_successful_poll_at = new Date().toISOString();
      }
      if (stats.errors.some(e => e.includes("persistence_failure"))) {
        pipelineHealth.last_persistence_failure_at = new Date().toISOString();
      }
      if (stats.errors.some(e => e.includes("rate_limited") || e.includes("429"))) {
        pipelineHealth.last_rate_limit_at = new Date().toISOString();
      }
      await supabase.from("tenants").update({
        settings: { ...tenantSettings, pipeline_health: pipelineHealth },
      }).eq("id", tenant_id);
    } catch (_) { /* non-critical */ }

    if (stats.errors.length > 0) {
      const status = stats.total_inserted > 0 ? 'partial' : 'failed';
      return jsonResp({ success: false, status, ...stats }, 502);
    }

    if (stats.needs_attention.length > 0) {
      return jsonResp({ success: false, status: 'attention_required', ...stats });
    }

    return jsonResp({ success: true, status: 'success', ...stats });
  } catch (err: unknown) {
    console.error("agvlog-pipeline-run error:", err);
    return jsonResp({ error: "Internal error", details: errorMessage(err) }, 500);
  }
});

// ==================== Helpers ====================

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function callEdgeFunction(
  supabaseUrl: string,
  anonKey: string,
  authHeader: string,
  isCron: boolean | "" | null | undefined,
  cronSecret: string | null,
  functionName: string,
  body: unknown,
  timeoutMs = 55_000,
): Promise<unknown> {
  const url = `${supabaseUrl}/functions/v1/${functionName}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "apikey": anonKey,
  };

  if (isCron && cronSecret) {
    headers["x-agvlog-cron-secret"] = cronSecret;
    headers["Authorization"] = `Bearer ${anonKey}`;
  } else {
    headers["Authorization"] = authHeader;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const text = await resp.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!resp.ok) {
      const payload = data && typeof data === "object" ? data as JsonObject : {};
      const nestedError = payload.error && typeof payload.error === "object"
        ? payload.error as JsonObject
        : {};
      const primary = typeof payload.error === "string"
        ? payload.error
        : typeof nestedError.message === "string" ? nestedError.message : `HTTP ${resp.status}`;
      const detail = typeof payload.details === "string" ? payload.details : "";
      throw new Error(`${functionName}: ${[primary, detail].filter(Boolean).join(" — ")}`);
    }

    return data;
  } catch (e: unknown) {
    clearTimeout(timer);
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new Error(`${functionName} timed out after ${timeoutMs}ms`);
    }
    throw e;
  }
}
