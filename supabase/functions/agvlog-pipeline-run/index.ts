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

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-agvlog-cron-secret",
};

type PipelineMode = "poll" | "full" | "manual" | "sync_units_only" | "aggregate_only";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    let callerId: string | null = null;
    let authHeader = req.headers.get("Authorization") || "";

    const cronSecret = req.headers.get("x-agvlog-cron-secret");
    const expectedCronSecret = Deno.env.get("AGVLOG_CRON_SECRET");
    const isCron = cronSecret && expectedCronSecret && cronSecret === expectedCronSecret;

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
    let mode: PipelineMode = pipeline_mode || "poll";
    if (manual_run && !pipeline_mode) mode = "manual";

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

    const stats = {
      pipeline_mode: mode,
      login: null as any,
      synced_units: 0,
      polled_units: 0,
      total_inserted: 0,
      processed_vehicles: 0,
      aggregated: 0,
      errors: [] as string[],
      steps_executed: [] as string[],
    };

    // Get accounts to process
    let accountsQuery = supabase
      .from("integration_accounts")
      .select("id, status, token_expires_at, settings")
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
            stats.synced_units += syncResp?.upserted || 0;
          } catch (e: any) {
            stats.errors.push(`SyncUnits ${account.id}: ${e.message}`);
          }
        }

        if (mode === "sync_units_only") continue;
        if (mode === "aggregate_only") continue;

        // ===== STEP C: Position polling (poll/full/manual) =====
        stats.steps_executed.push("position_polling");

        // BROADBAND: Single call to ssx-poll-positions with ALL units (no batching).
        // The edge function does 1 SSX request and distributes positions locally.
        // Only manual mode uses per-unit batching for targeted discovery.
        const pollBody: Record<string, any> = {
          integration_account_id: account.id,
          manual_run: mode === "manual",
          force_rediscovery: mode === "manual" || force_rediscovery,
        };
        if (provider_unit_ids?.length) {
          pollBody.provider_unit_ids = provider_unit_ids;
        }
        if (lookback_minutes) pollBody.lookback_minutes = lookback_minutes;

        let pollAborted = false;

        try {
          const pollResp = await callEdgeFunction(supabaseUrl, anonKey, authHeader, isCron, cronSecret, "ssx-poll-positions", pollBody);
          stats.polled_units += pollResp?.total_units || 0;
          stats.total_inserted += pollResp?.total_inserted || 0;

          if (pollResp?.batch_aborted) {
            pollAborted = true;
            const reason = pollResp.abort_reason || "unknown";
            stats.errors.push(`Polling stopped: ${reason}`);
            if (reason === "persistence_failure") {
              stats.errors.push("CRITICAL: persistence_failure — skipping queue processing");
            }
          }
        } catch (e: any) {
          stats.errors.push(`Poll: ${e.message}`);
          if (e.message?.includes("timed out")) {
            pollAborted = true;
          }
        }

        // ===== STEP D: Queue processing (only if polling didn't hit persistence failure) =====
        const hasPersistenceFailure = stats.errors.some(e => e.includes("persistence_failure"));
        if (!hasPersistenceFailure && stats.total_inserted > 0) {
          stats.steps_executed.push("queue_processing");
          try {
            const queueResp = await callEdgeFunction(supabaseUrl, anonKey, authHeader, isCron, cronSecret, "agvlog-run-queue", {
              tenant_id, limit: 50,
            });
            stats.processed_vehicles = queueResp?.processed || 0;
          } catch (e: any) {
            stats.errors.push(`Queue: ${e.message}`);
          }
        }
      } catch (e: any) {
        stats.errors.push(`Account ${account.id}: ${e.message}`);
      }
    }

    // ===== STEP E: Daily aggregation (only on full/manual/aggregate_only) =====
    if (mode === "full" || mode === "manual" || mode === "aggregate_only") {
      stats.steps_executed.push("daily_aggregation");
      try {
        const aggResp = await callEdgeFunction(supabaseUrl, anonKey, authHeader, isCron, cronSecret, "agvlog-aggregate-daily", {
          tenant_id,
        });
        stats.aggregated = aggResp?.aggregated || 0;
      } catch (e: any) {
        stats.errors.push(`Aggregate: ${e.message}`);
      }
    }

    // ===== Update pipeline health on tenant settings =====
    try {
      const { data: tenantData } = await supabase
        .from("tenants").select("settings").eq("id", tenant_id).single();
      const tenantSettings = (tenantData?.settings as Record<string, any>) || {};
      const pipelineHealth = {
        ...(tenantSettings.pipeline_health || {}),
        last_run_at: new Date().toISOString(),
        last_run_mode: mode,
        last_run_inserted: stats.total_inserted,
        last_run_polled: stats.polled_units,
        last_run_errors: stats.errors.length,
        last_run_steps: stats.steps_executed,
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

    return jsonResp({ success: true, ...stats });
  } catch (err: any) {
    console.error("agvlog-pipeline-run error:", err);
    return jsonResp({ error: "Internal error", details: err.message }, 500);
  }
});

// ==================== Helpers ====================

function jsonResp(body: any, status = 200): Response {
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
  body: any,
  timeoutMs = 55_000,
): Promise<any> {
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
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!resp.ok && data?.error) {
      throw new Error(data.error);
    }

    return data;
  } catch (e: any) {
    clearTimeout(timer);
    if (e.name === "AbortError") {
      throw new Error(`${functionName} timed out after ${timeoutMs}ms`);
    }
    throw e;
  }
}
