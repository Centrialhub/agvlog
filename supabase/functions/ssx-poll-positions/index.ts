/**
 * ssx-poll-positions — Polls position history from SSX for active provider units.
 *
 * BROADBAND-FIRST DESIGN (v10):
 * - Normal polling: 1 single request to PositionHistory WITHOUT unit filter
 * - Distributes returned positions to matching vehicles locally
 * - A response without a point updates polling health only; it is not motion
 * - History, monotonic latest position, cursor and queue commit atomically
 * - Per-unit discovery preserved ONLY for manual/debug runs
 */

import { createClient } from "@supabase/supabase-js";
import { isCronRequest } from "../_shared/cron-auth.ts";
import { requireIntegrationCapability } from "../_shared/capabilities.ts";
import {
  corsHeaders,
  buildPositionHistoryUrlCandidates,
  readAccountConfig,
  extractResponseItems,
  ssxPost,
  logIntegration,
  logSsxCall,
  getTenantRole,
  type SsxErrorClass,
} from "../_shared/ssx-utils.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

const POLL_MEMO_VERSION = 10;

type TrackerBinding = {
  link_id: string;
  vehicle_id: string;
  tenant_id: string;
  start_at: string;
  end_at: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResp({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    let callerId: string | null = null;
    const isCron = await isCronRequest(req, supabaseUrl, supabaseServiceKey);

    if (!isCron) {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return jsonResp({ error: "Unauthorized" }, 401);
      }
      const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData, error: userError } = await anonClient.auth.getUser();
      if (userError || !userData?.user) {
        return jsonResp({ error: "Unauthorized" }, 401);
      }
      callerId = userData.user.id;
    }

    let body: Record<string, any>;
    try {
      body = await req.json();
    } catch {
      return jsonResp({ error: "Invalid JSON body" }, 400);
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const {
      integration_account_id,
      provider_unit_ids,
      manual_run = false,
      force_rediscovery = false,
      lookback_minutes,
    } = body;

    if (!integration_account_id) {
      return jsonResp({ error: "integration_account_id required" }, 400);
    }

    const { data: account, error: accErr } = await supabase
      .from("integration_accounts").select("*").eq("id", integration_account_id).single();
    if (accErr || !account) {
      return jsonResp({ error: "Integration account not found" }, 404);
    }

    if (!isCron && callerId) {
      const memberRole = await getTenantRole(supabase, account.tenant_id, callerId);
      if (!memberRole || !["owner", "admin"].includes(memberRole)) {
        return jsonResp({ error: "Forbidden: admin role required" }, 403);
      }
    }

    const capabilityResponse = await requireIntegrationCapability(supabase, account.tenant_id, "ssx");
    if (capabilityResponse) return capabilityResponse;

    const config = readAccountConfig(account);

    if (!config.token || !account.token_expires_at) {
      return jsonResp({ error: "No token cached. Run ssx-login first." }, 400);
    }
    if (new Date(account.token_expires_at).getTime() < Date.now()) {
      return jsonResp({ error: "Token expired. Run ssx-login first." }, 400);
    }

    // Check account-level cooldown
    const cooldownUntil = account.poll_cooldown_until || config.settings.poll_cooldown_until;
    if (cooldownUntil && new Date(cooldownUntil) > new Date() && !manual_run) {
      const retryAfterSec = Math.ceil((new Date(cooldownUntil).getTime() - Date.now()) / 1000);
      return jsonResp({
        error: "Account in cooldown from previous rate limit",
        retry_after_seconds: retryAfterSec,
      }, 429);
    }

    // Get provider units to poll
    let unitsQuery = supabase
      .from("provider_units").select("*")
      .eq("integration_account_id", integration_account_id)
      .eq("active", true);
    if (provider_unit_ids?.length) {
      unitsQuery = unitsQuery.in("id", provider_unit_ids);
    }
    const { data: units, error: unitsErr } = await unitsQuery;
    if (unitsErr || !units?.length) {
      return jsonResp({ error: "No active provider units found" }, 404);
    }

    // Get vehicle_tracker_links for all units
    const unitIds = units.map((u: any) => u.id);
    const { data: links, error: linksError } = await supabase
      .from("vehicle_tracker_links")
      .select("id,provider_unit_id,vehicle_id,tenant_id,start_at,end_at")
      .eq("tenant_id", account.tenant_id)
      .in("provider_unit_id", unitIds).eq("active", true);
    if (linksError) {
      return jsonResp({ error: "Failed to read tracker bindings" }, 500);
    }

    const unitToVehicle: Record<string, TrackerBinding> = {};
    const boundVehicles = new Set<string>();
    for (const link of links || []) {
      if (unitToVehicle[link.provider_unit_id] || boundVehicles.has(link.vehicle_id)) {
        return jsonResp({ error: "Ambiguous active tracker binding" }, 409);
      }
      unitToVehicle[link.provider_unit_id] = {
        link_id: link.id,
        vehicle_id: link.vehicle_id,
        tenant_id: link.tenant_id,
        start_at: link.start_at,
        end_at: link.end_at,
      };
      boundVehicles.add(link.vehicle_id);
    }

    // Build PositionHistory URL candidates
    const positionUrls = buildPositionHistoryUrlCandidates(config.baseUrl, config.apiVersion);

    const isDebugMode = provider_unit_ids?.length === 1;
    // ============================================================
    // BROADBAND-FIRST: 1 request for the entire fleet
    // ============================================================
    if (!manual_run && !isDebugMode) {
      return await broadbandPoll({
        units, unitToVehicle, positionUrls, config, supabase,
        integration_account_id, tenant_id: account.tenant_id, lookback_minutes,
      });
    }

    // ============================================================
    // LEGACY PER-UNIT: Only for manual/debug runs
    // ============================================================
    return await legacyPerUnitPoll({
      units, unitToVehicle, positionUrls, config, supabase,
      integration_account_id, tenant_id: account.tenant_id, manual_run, force_rediscovery,
      lookback_minutes, isDebugMode,
    });

  } catch (err: any) {
    console.error("[SSX:poll-positions] error:", err);
    return jsonResp({ error: "Internal error" }, 500);
  }
});

// ==================== BROADBAND POLL (1 request for all units) ====================

async function broadbandPoll(params: {
  units: any[];
  unitToVehicle: Record<string, TrackerBinding>;
  positionUrls: string[];
  config: any;
  supabase: any;
  integration_account_id: string;
  tenant_id: string;
  lookback_minutes?: number;
}): Promise<Response> {
  const { units, unitToVehicle, positionUrls, config, supabase,
    integration_account_id, tenant_id, lookback_minutes } = params;

  const pollWindowMin = lookback_minutes || config.pollWindowMinutes || 15;
  const timeStart = new Date(Date.now() - pollWindowMin * 60_000).toISOString();
  const broadbandUrl = positionUrls[0];

  // Single request — only time filter, no unit filter
  const filters = [
    { PropertyName: "EventDate", Condition: ">=", Value: timeStart },
  ];

  console.log(`[SSX:poll-positions] BROADBAND mode | ${units.length} units | window=${pollWindowMin}min | url=${broadbandUrl}`);

  const resp = await ssxPost(broadbandUrl, config.token, filters, config.requestTimeoutMs);

  logSsxCall({
    routine: "poll-positions", endpoint: broadbandUrl, method: "POST",
    apiVersion: config.apiVersion, attemptType: "broadband_fleet",
    statusCode: resp.status, durationMs: resp.durationMs,
    responsePreview: (resp.text || "").substring(0, 150),
    result: resp.ok ? "success" : "error",
    errorClass: resp.ok ? undefined : resp.errorClass,
  });

  if (resp.errorClass === "rate_limited") {
    const observedAt = new Date().toISOString();
    const failure = await recordBroadbandFailure(supabase, {
      units, unitToVehicle, integrationAccountId: integration_account_id,
      observedAt, error: "SSX rate limited broadband polling",
      backoffUntil: new Date(Date.now() + 120_000).toISOString(),
    });
    const cooldown = await setAccountCooldown(
      supabase, tenant_id, integration_account_id, observedAt, 120,
    );
    if (!failure.ok || !cooldown.ok) {
      return jsonResp({
        success: false, batch_aborted: true, abort_reason: "persistence_failure",
        total_units: units.length, total_inserted: 0,
      }, 500);
    }
    return jsonResp({
      success: false, batch_aborted: true, abort_reason: "rate_limited",
      total_units: units.length, total_inserted: 0,
    }, 429);
  }

  if (!resp.ok) {
    const observedAt = new Date().toISOString();
    const failure = await recordBroadbandFailure(supabase, {
      units, unitToVehicle, integrationAccountId: integration_account_id,
      observedAt, error: `SSX broadband returned ${resp.status}`,
      backoffUntil: new Date(Date.now() + 60_000).toISOString(),
    });
    if (!failure.ok) {
      return jsonResp({
        success: false, batch_aborted: true, abort_reason: "persistence_failure",
        total_units: units.length, total_inserted: 0,
      }, 500);
    }
    return jsonResp({
      success: false, error: `SSX returned ${resp.status}`,
      total_units: units.length, total_inserted: 0,
    }, 502);
  }

  const allItems = extractResponseItems(resp.parsed);
  console.log(`[SSX:poll-positions] BROADBAND received ${allItems.length} positions from fleet`);

  // Build identifier sets for each unit
  const unitIdentifierSets: { unit: any; mapping: any; identifiers: UnitIdentifierSet }[] = [];
  for (const unit of units) {
    const mapping = unitToVehicle[unit.id];
    if (!mapping) continue;
    const meta = (unit as any).metadata || {};
    unitIdentifierSets.push({
      unit, mapping,
      identifiers: buildUnitIdentifierSet(unit, meta),
    });
  }

  // Distribute positions to vehicles
  const vehiclePositions: Map<string, { unit: any; mapping: any; points: any[] }> = new Map();
  let unmatched = 0;
  let ambiguous = 0;
  let outsideBindingWindow = 0;

  for (const item of allItems) {
    const normalized = normalizePosition(item);
    if (!normalized) continue;

    const telemetry = { ...item };
    const matches = unitIdentifierSets.filter(({ identifiers }) =>
      isPointFromCurrentUnitBroadband(telemetry, identifiers)
    );
    if (matches.length !== 1) {
      unmatched++;
      if (matches.length > 1) ambiguous++;
      continue;
    }
    const { unit, mapping } = matches[0];
    if (!isWithinBindingWindow(normalized.captured_at, mapping)) {
      outsideBindingWindow++;
      continue;
    }
    const key = mapping.vehicle_id;
    if (!vehiclePositions.has(key)) {
      vehiclePositions.set(key, { unit, mapping, points: [] });
    }
    vehiclePositions.get(key)!.points.push(item);
  }

  console.log(`[SSX:poll-positions] BROADBAND distributed: ${vehiclePositions.size} vehicles matched, ${unmatched} unmatched points, ${ambiguous} ambiguous`);

  // Process each vehicle's positions
  let totalInserted = 0;
  let totalDuplicates = 0;
  let totalFailed = 0;
  let touchedVehicles = 0;
  const results: any[] = [];
  let persistenceFailed = false;

  for (const [vehicleId, { unit, mapping, points }] of vehiclePositions) {
    const rows = await buildPersistenceRows(points, unit, mapping.link_id);
    if (rows.length === 0) continue;
    const receivedAt = new Date().toISOString();
    const commit = await commitPositionBatch(supabase, {
      integrationAccountId: integration_account_id,
      unit, mapping, rows, receivedAt,
      pollMemo: {
        memo_version: POLL_MEMO_VERSION,
        poll_mode: "broadband",
        combo_source: "broadband",
        last_success_run: receivedAt,
      },
    });
    if (!commit.ok) {
      persistenceFailed = true;
      totalFailed += rows.length;
      console.error(`[SSX:poll-positions] PERSISTENCE_FAILURE | vehicle=${vehicleId} | error=${commit.error}`);
      results.push({
        unit_code: unit.external_code, status: "persistence_failure",
        positions_found: true, inserted: 0, duplicates: 0,
        combo_source: "broadband",
      });
      continue;
    }
    totalInserted += commit.inserted;
    totalDuplicates += commit.duplicates;
    if (commit.latestApplied) touchedVehicles++;

    results.push({
      unit_code: unit.external_code, status: "ok",
      positions_found: true,
      inserted: commit.inserted, duplicates: commit.duplicates,
      combo_source: "broadband",
    });
  }

  // A successful empty response proves connectivity, not that the vehicle is
  // stationary. Commit polling state without touching positions_last.
  const matchedVehicleIds = new Set(vehiclePositions.keys());
  for (const { unit, mapping } of unitIdentifierSets) {
    if (matchedVehicleIds.has(mapping.vehicle_id)) continue;
    const receivedAt = new Date().toISOString();
    const commit = await commitPositionBatch(supabase, {
      integrationAccountId: integration_account_id,
      unit, mapping, rows: [], receivedAt,
      pollMemo: {
        memo_version: POLL_MEMO_VERSION,
        poll_mode: "broadband",
        combo_source: "broadband_no_observation",
        last_empty_poll: receivedAt,
      },
    });
    if (!commit.ok) {
      persistenceFailed = true;
      totalFailed++;
      console.error(`[SSX:poll-positions] PERSISTENCE_FAILURE | vehicle=${mapping.vehicle_id} | error=${commit.error}`);
    }
    results.push({
      unit_code: unit.external_code,
      status: commit.ok ? "no_data" : "persistence_failure",
      positions_found: false, inserted: 0, duplicates: 0,
      combo_source: "broadband_no_observation",
    });
  }

  // Log integration
  await logIntegration(supabase, {
    tenant_id,
    integration_account_id,
    action: "ssx_poll_positions_broadband",
    endpoint: broadbandUrl,
    status_code: resp.status,
    success: !persistenceFailed,
    duration_ms: resp.durationMs,
    metadata: {
      mode: "broadband",
      total_positions_received: allItems.length,
      vehicles_matched: vehiclePositions.size,
      vehicles_without_observation: unitIdentifierSets.length - vehiclePositions.size,
      unmatched_positions: unmatched,
      ambiguous_positions: ambiguous,
      outside_binding_window: outsideBindingWindow,
      total_inserted: totalInserted,
      total_duplicates: totalDuplicates,
      total_failed: totalFailed,
    },
  });

  return jsonResp({
    success: !persistenceFailed,
    mode: "broadband",
    total_units: units.length,
    total_positions_received: allItems.length,
    vehicles_matched: vehiclePositions.size,
    vehicles_without_observation: unitIdentifierSets.length - vehiclePositions.size,
    unmatched_positions: unmatched,
    ambiguous_positions: ambiguous,
    outside_binding_window: outsideBindingWindow,
    total_inserted: totalInserted,
    total_duplicates: totalDuplicates,
    total_failed: totalFailed,
    batch_aborted: persistenceFailed,
    abort_reason: persistenceFailed ? "persistence_failure" : null,
    touched_vehicles: touchedVehicles,
    results,
  }, persistenceFailed ? 500 : 200);
}

async function recordBroadbandFailure(supabase: any, input: {
  units: any[];
  unitToVehicle: Record<string, TrackerBinding>;
  integrationAccountId: string;
  observedAt: string;
  error: string;
  backoffUntil: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  for (const unit of input.units) {
    const mapping = input.unitToVehicle[unit.id];
    if (!mapping) continue;
    const recorded = await recordPollError(supabase, {
      integrationAccountId: input.integrationAccountId,
      unit,
      mapping,
      observedAt: input.observedAt,
      error: input.error,
      backoffUntil: input.backoffUntil,
      pollMemo: {
        memo_version: POLL_MEMO_VERSION,
        cleared: true,
        cleared_reason: "broadband_provider_error",
        cleared_at: input.observedAt,
      },
    });
    if (!recorded.ok) return recorded;
  }
  return { ok: true };
}

// ==================== LEGACY PER-UNIT POLL (manual/debug only) ====================

async function legacyPerUnitPoll(params: {
  units: any[];
  unitToVehicle: Record<string, TrackerBinding>;
  positionUrls: string[];
  config: any;
  supabase: any;
  integration_account_id: string;
  tenant_id: string;
  manual_run: boolean;
  force_rediscovery: boolean;
  lookback_minutes?: number;
  isDebugMode: boolean;
}): Promise<Response> {
  const { units, unitToVehicle, positionUrls, config, supabase,
    integration_account_id, tenant_id, manual_run, force_rediscovery,
    lookback_minutes, isDebugMode } = params;

  const timeProps = ["EventDate", "UpdateDate"];
  const requestSpacingMs = config.settings.request_spacing_ms ?? 400;
  const discoverySpacingMs = config.settings.discovery_request_spacing_ms ?? 500;
  const defaultPollWindow = config.pollWindowMinutes;
  const initialPollWindowMinutes = lookback_minutes || config.settings.initial_poll_window_minutes || 10080;

  let scoutHint: { property: string; value_source: string; url: string; format: string; timeProp: string } | null = null;

  const results: any[] = [];
  let totalInserted = 0;
  let totalDuplicates = 0;
  let totalFailed = 0;
  let touchedVehicles = 0;
  let batchAborted = false;
  let abortReason = "";

  console.log(`[SSX:poll-positions] LEGACY per-unit mode | ${units.length} units | manual=${manual_run} | debug=${isDebugMode}`);

  for (let unitIdx = 0; unitIdx < units.length; unitIdx++) {
    if (batchAborted) break;
    const unit = units[unitIdx];

    if (unitIdx > 0 && requestSpacingMs > 0) {
      await sleep(requestSpacingMs);
    }

    const mapping = unitToVehicle[unit.id];
    if (!mapping) {
      results.push({ unit_code: unit.external_code, status: "skipped", reason: "No active vehicle link" });
      continue;
    }

    const { data: cursor } = await supabase
      .from("ingestion_cursors").select("*")
      .eq("provider_unit_id", unit.id).eq("tenant_id", mapping.tenant_id).single();

    if (!manual_run && cursor?.backoff_until && new Date(cursor.backoff_until) > new Date()) {
      results.push({ unit_code: unit.external_code, status: "skipped", reason: "In backoff period" });
      continue;
    }

    const now = new Date();
    const isFirstPoll = !cursor?.last_success_at;
    const pollWindowMinutes = isFirstPoll ? initialPollWindowMinutes : (manual_run ? Math.max(defaultPollWindow, 1440) : defaultPollWindow);

    const maxLookbackStart = new Date(Date.now() - pollWindowMinutes * 60_000);
    const incrementalStart = cursor?.last_success_at
      ? new Date(new Date(cursor.last_success_at).getTime() - 2 * 60_000)
      : null;

    const cursorTimeStart = incrementalStart && !force_rediscovery
      ? new Date(Math.max(incrementalStart.getTime(), maxLookbackStart.getTime())).toISOString()
      : maxLookbackStart.toISOString();
    const bindingStartMs = Date.parse(mapping.start_at);
    const timeStart = Number.isFinite(bindingStartMs)
      ? new Date(Math.max(Date.parse(cursorTimeStart), bindingStartMs)).toISOString()
      : cursorTimeStart;

    const meta = (unit as any).metadata || {};
    const identifierCandidates = buildIdentifierCandidates(unit.external_code, meta);

    const cursorMemo = (cursor?.poll_memo || {}) as Record<string, any>;
    const memoValid = cursorMemo.memo_version === POLL_MEMO_VERSION &&
      cursorMemo.cleared !== true && !force_rediscovery;

    const unitResult = await pollSingleUnit({
      unit, mapping, identifierCandidates, timeProps, positionUrls,
      config, supabase, timeStart, now,
      cursorMemo: memoValid ? cursorMemo : null,
      scoutHint: force_rediscovery ? null : scoutHint,
      isDebugMode, discoverySpacingMs, manual_run,
      integration_account_id,
    });

    if (unitResult.abortBatch) {
      batchAborted = true;
      abortReason = unitResult.abortReason || "rate_limited";
      if (unitResult.abortReason === "rate_limited") {
        const cooldown = await setAccountCooldown(
          supabase, tenant_id, integration_account_id, now.toISOString(), 120,
        );
        if (!cooldown.ok) {
          unitResult.persistenceFailed = true;
          unitResult.rows_failed = 1;
          unitResult.error = cooldown.error;
          unitResult.abortReason = "persistence_failure";
          abortReason = "persistence_failure";
        }
      }
    }

    if (unitResult.workingCombo && !scoutHint) {
      scoutHint = unitResult.workingCombo;
    }

    if (unitResult.workingCombo && !unitResult.persistenceFailed && !unitResult.persistenceCommitted) {
      const newMemo = {
        memo_version: POLL_MEMO_VERSION,
        poll_working_property: unitResult.workingCombo.property,
        poll_working_value_source: unitResult.workingCombo.value_source,
        poll_working_url: unitResult.workingCombo.url,
        poll_working_format: unitResult.workingCombo.format,
        poll_working_time_prop: unitResult.workingCombo.timeProp,
        combo_source: unitResult.comboSource,
        last_empty_poll: now.toISOString(),
      };
      const commit = await commitPositionBatch(supabase, {
        integrationAccountId: integration_account_id,
        unit, mapping, rows: [], receivedAt: now.toISOString(),
        pollMemo: newMemo,
      });
      if (!commit.ok) {
        unitResult.persistenceFailed = true;
        unitResult.rows_failed = 1;
        unitResult.error = commit.error;
        unitResult.abortBatch = true;
        unitResult.abortReason = "persistence_failure";
        batchAborted = true;
        abortReason = "persistence_failure";
      } else {
        unitResult.persistenceCommitted = true;
      }
    } else if (!unitResult.persistenceCommitted && !unitResult.persistenceFailed) {
      const observedAt = now.toISOString();
      const recorded = await recordPollError(supabase, {
        integrationAccountId: integration_account_id,
        unit, mapping, observedAt,
        error: unitResult.error || "No combination returned positions",
        backoffUntil: new Date(now.getTime() + 60_000).toISOString(),
        pollMemo: {
          memo_version: POLL_MEMO_VERSION,
          cleared: true,
          cleared_reason: unitResult.comboSource || "no_working_combo",
          cleared_at: observedAt,
        },
      });
      if (!recorded.ok) {
        unitResult.persistenceFailed = true;
        unitResult.rows_failed = 1;
        unitResult.error = recorded.error;
        unitResult.abortBatch = true;
        unitResult.abortReason = "persistence_failure";
        batchAborted = true;
        abortReason = "persistence_failure";
      }
    }

    totalInserted += unitResult.inserted;
    totalDuplicates += unitResult.duplicates;
    totalFailed += unitResult.rows_failed || 0;

    if (unitResult.latestApplied) touchedVehicles++;

    results.push({
      unit_code: unit.external_code,
      status: unitResult.persistenceFailed ? "persistence_failure" : (unitResult.positions_found ? "ok" : (unitResult.abortBatch ? "error" : "no_data")),
      positions_found: unitResult.positions_found,
      inserted: unitResult.inserted,
      duplicates: unitResult.duplicates,
      combo_source: unitResult.comboSource,
      attempt_matrix: isDebugMode ? unitResult.attemptMatrix : undefined,
    });
  }

  return jsonResp({
    success: !batchAborted && totalFailed === 0, mode: "legacy_per_unit",
    total_units: units.length,
    total_inserted: totalInserted, total_duplicates: totalDuplicates,
    total_failed: totalFailed,
    touched_vehicles: touchedVehicles,
    scout_hint: scoutHint ? `${scoutHint.property}:${scoutHint.value_source}@${scoutHint.url}` : null,
    batch_aborted: batchAborted,
    abort_reason: abortReason || null,
    manual_run, force_rediscovery: params.force_rediscovery,
    results,
  }, batchAborted
    ? (abortReason === "rate_limited" ? 429 : 500)
    : (totalFailed > 0 ? 500 : 200));
}

// ==================== Identifier Candidates Builder ====================

interface IdentifierCandidate {
  property: string;
  value: string;
  value_source: string;
}

function buildIdentifierCandidates(externalCode: string, meta: Record<string, any>): IdentifierCandidate[] {
  const candidates: IdentifierCandidate[] = [];
  const seen = new Set<string>();
  const add = (property: string, value: string | null | undefined, source: string) => {
    if (value == null) return;
    const stringValue = String(value).trim();
    if (!stringValue) return;
    const key = `${property}:${stringValue}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ property, value: stringValue, value_source: source });
  };

  add("IdTrackedUnit", meta.id_tracked_unit, "metadata.id_tracked_unit");
  add("TrackedUnitId", meta.id_tracked_unit, "metadata.id_tracked_unit");
  add("TrackedUnitIntegrationCode", meta.tracked_unit_integration_code, "metadata.tracked_unit_integration_code");
  add("IntegrationCode", meta.vehicle_integration_code, "metadata.vehicle_integration_code");
  add("IntegrationCode", externalCode, "external_code");
  add("TrackedUnitIntegrationCode", externalCode, "external_code");
  add("TrackedUnit", meta.tracked_unit, "metadata.tracked_unit");
  add("TrackerIntegrationCode", meta.tracker_integration_code, "metadata.tracker_integration_code");

  return candidates;
}

// ==================== Per-Unit Polling (legacy) ====================

interface PollingAttemptLog {
  url: string;
  property: string;
  value: string;
  timeProp: string;
  format: string;
  statusCode: number;
  errorClass: string;
  itemCount: number;
}

interface PollUnitResult {
  positions_found: boolean;
  inserted: number;
  duplicates: number;
  rows_attempted: number;
  rows_failed: number;
  latestCapturedAt: string | null;
  latestNormalized: any | null;
  workingCombo: { property: string; value_source: string; url: string; format: string; timeProp: string } | null;
  comboSource: string;
  abortBatch: boolean;
  abortReason?: string;
  persistenceFailed: boolean;
  persistenceCommitted?: boolean;
  latestApplied?: boolean;
  error?: string;
  attemptCount: number;
  attemptMatrix: string[];
  crossUnitFiltered?: number;
  outsideBindingWindow?: number;
  totalReceived?: number;
  rejectedByCrossUnitFilter?: boolean;
}

async function pollSingleUnit(params: {
  unit: any;
  mapping: TrackerBinding;
  identifierCandidates: IdentifierCandidate[];
  timeProps: string[];
  positionUrls: string[];
  config: any;
  supabase: any;
  timeStart: string;
  now: Date;
  cursorMemo: Record<string, any> | null;
  scoutHint: { property: string; value_source: string; url: string; format: string; timeProp: string } | null;
  isDebugMode: boolean;
  discoverySpacingMs: number;
  manual_run: boolean;
  integration_account_id: string;
}): Promise<PollUnitResult> {
  const { unit, mapping, identifierCandidates, timeProps, positionUrls, config, supabase,
    timeStart, cursorMemo, scoutHint, isDebugMode, discoverySpacingMs, integration_account_id } = params;

  const attempts: PollingAttemptLog[] = [];
  let attemptCount = 0;
  const MAX_ATTEMPTS = isDebugMode ? 24 : 8;

  async function tryCombo(
    property: string, value: string, _valueSource: string,
    url: string, format: "array" | "wrapped", timeProp: string,
    type: string,
  ): Promise<{ items: any[]; resp: any; abort: boolean; abortReason?: string } | null> {
    if (attemptCount >= MAX_ATTEMPTS) return null;
    if (attemptCount > 0) await sleep(discoverySpacingMs);

    const filters = [
      { PropertyName: property, Condition: "=", Value: value },
      { PropertyName: timeProp, Condition: ">=", Value: timeStart },
    ];
    const body = format === "array" ? filters : { Filters: filters };
    const resp = await ssxPost(url, config.token, body, config.requestTimeoutMs);
    attemptCount++;

    const items = resp.ok ? extractResponseItems(resp.parsed) : [];

    logSsxCall({
      routine: "poll-positions", endpoint: url, method: "POST",
      apiVersion: config.apiVersion,
      attemptType: `${type}:${property}:${format}:${timeProp}`,
      statusCode: resp.status, durationMs: resp.durationMs,
      responsePreview: (resp.text || "").substring(0, 150),
      result: items.length > 0 ? "success" : (resp.ok ? "empty" : "error"),
      errorClass: resp.ok ? (items.length > 0 ? undefined : "empty_response" as SsxErrorClass) : resp.errorClass,
    });

    attempts.push({
      url, property, value, timeProp, format,
      statusCode: resp.status,
      errorClass: resp.ok ? (items.length > 0 ? "success" : "empty_response") : resp.errorClass,
      itemCount: items.length,
    });

    if (resp.errorClass === "rate_limited") {
      return { items: [], resp, abort: true, abortReason: "rate_limited" };
    }
    if (resp.errorClass === "auth_error") {
      return { items: [], resp, abort: true, abortReason: "auth_error" };
    }

    return { items, resp, abort: false };
  }

  // STAGE 1: Try per-unit memo
  if (cursorMemo) {
    const memoProp = cursorMemo.poll_working_property;
    const memoValueSource = cursorMemo.poll_working_value_source;
    const memoUrl = cursorMemo.poll_working_url;
    const memoFormat = cursorMemo.poll_working_format;
    const memoTimeProp = cursorMemo.poll_working_time_prop;

    if (memoProp && memoUrl && memoFormat && memoTimeProp) {
      const memoCandidate = identifierCandidates.find(
        c => c.property === memoProp && c.value_source === memoValueSource
      ) || identifierCandidates.find(c => c.property === memoProp);

      if (memoCandidate) {
        const r = await tryCombo(memoProp, memoCandidate.value, memoCandidate.value_source, memoUrl, memoFormat, memoTimeProp, "unit_memo");
        if (r?.abort) return buildAbortResult(r.abortReason!, attempts, attemptCount);
        if (r && r.resp?.ok) {
          if (r.items.length > 0) {
            const processed = await processPositions(r.items, r.resp, unit, mapping, supabase, config,
              { property: memoProp, value_source: memoCandidate.value_source, url: memoUrl, format: memoFormat, timeProp: memoTimeProp },
              "unit_memo", attempts, attemptCount, integration_account_id);
            if (!processed.rejectedByCrossUnitFilter) return processed;
          } else {
            return {
              positions_found: false, inserted: 0, duplicates: 0,
              rows_attempted: 0, rows_failed: 0,
              latestCapturedAt: null, latestNormalized: null,
              workingCombo: { property: memoProp, value_source: memoCandidate.value_source, url: memoUrl, format: memoFormat, timeProp: memoTimeProp },
              comboSource: "unit_memo_no_new_data",
              abortBatch: false, persistenceFailed: false,
              attemptCount,
              attemptMatrix: summarizePollingAttemptsV2(attempts),
            };
          }
        }
      }
    }
  }

  // STAGE 2: Try scout hint
  if (scoutHint) {
    const hintCandidate = identifierCandidates.find(c => c.property === scoutHint.property)
      || identifierCandidates[0];
    if (hintCandidate) {
      const r = await tryCombo(scoutHint.property, hintCandidate.value, hintCandidate.value_source,
        scoutHint.url, scoutHint.format as any, scoutHint.timeProp, "scout_hint");
      if (r?.abort) return buildAbortResult(r.abortReason!, attempts, attemptCount);
      if (r && r.items.length > 0) {
        const processed = await processPositions(r.items, r.resp, unit, mapping, supabase, config,
          { property: scoutHint.property, value_source: hintCandidate.value_source, url: scoutHint.url, format: scoutHint.format, timeProp: scoutHint.timeProp },
          "scout_hint", attempts, attemptCount, integration_account_id);
        if (!processed.rejectedByCrossUnitFilter) return processed;
      }
    }
  }

  // STAGE 3: Per-unit discovery
  for (const candidate of identifierCandidates) {
    if (attemptCount >= MAX_ATTEMPTS) break;
    for (const url of positionUrls) {
      if (attemptCount >= MAX_ATTEMPTS) break;
      for (const timeProp of timeProps) {
        if (attemptCount >= MAX_ATTEMPTS) break;

        const r = await tryCombo(candidate.property, candidate.value, candidate.value_source, url, "array", timeProp, "discovery");
        if (r?.abort) return buildAbortResult(r.abortReason!, attempts, attemptCount);
        if (r && r.items.length > 0) {
          const processed = await processPositions(r.items, r.resp, unit, mapping, supabase, config,
            { property: candidate.property, value_source: candidate.value_source, url, format: "array", timeProp },
            "unit_rediscovery", attempts, attemptCount, integration_account_id);
          if (!processed.rejectedByCrossUnitFilter) return processed;
        }

        if (r?.resp?.errorClass === "body_incompatible") {
          const rw = await tryCombo(candidate.property, candidate.value, candidate.value_source, url, "wrapped", timeProp, "discovery_wrapped");
          if (rw?.abort) return buildAbortResult(rw.abortReason!, attempts, attemptCount);
          if (rw && rw.items.length > 0) {
            const processedWrapped = await processPositions(rw.items, rw.resp, unit, mapping, supabase, config,
              { property: candidate.property, value_source: candidate.value_source, url, format: "wrapped", timeProp },
              "unit_rediscovery", attempts, attemptCount, integration_account_id);
            if (!processedWrapped.rejectedByCrossUnitFilter) return processedWrapped;
          }
        }

        if (r?.resp?.errorClass === "route_not_found") break;
      }
    }
  }

  return {
    positions_found: false, inserted: 0, duplicates: 0,
    rows_attempted: 0, rows_failed: 0,
    latestCapturedAt: null, latestNormalized: null,
    workingCombo: null, comboSource: "none",
    abortBatch: false, persistenceFailed: false,
    error: "No combination returned positions",
    attemptCount,
    attemptMatrix: summarizePollingAttemptsV2(attempts),
  };
}

// ==================== Process Positions ====================

async function processPositions(
  positions: any[], _resp: any, unit: any,
  mapping: TrackerBinding,
  supabase: any, _config: any,
  combo: { property: string; value_source: string; url: string; format: string; timeProp: string },
  comboSource: string,
  attempts: PollingAttemptLog[], attemptCount: number,
  integration_account_id: string,
): Promise<PollUnitResult> {
  let latestNormalized: any = null;

  const meta = (unit as any).metadata || {};
  const unitIdentifiers = buildUnitIdentifierSet(unit, meta);
  let crossUnitFiltered = 0;
  let outsideBindingWindow = 0;

  const rows: any[] = [];
  for (const point of positions) {
    const normalized = normalizePosition(point);
    if (!normalized) continue;

    if (!isPointFromCurrentUnit(normalized.telemetry || {}, unitIdentifiers)) {
      crossUnitFiltered++;
      continue;
    }
    if (!isWithinBindingWindow(normalized.captured_at, mapping)) {
      outsideBindingWindow++;
      continue;
    }

    if (!latestNormalized || new Date(normalized.captured_at) > new Date(latestNormalized.captured_at)) {
      latestNormalized = normalized;
    }

    rows.push(await toPersistenceRow(normalized, unit, mapping.link_id));
  }

  const rejectedByCrossUnitFilter = rows.length === 0 && crossUnitFiltered > 0;

  if (rejectedByCrossUnitFilter) {
    return {
      positions_found: false, inserted: 0, duplicates: 0,
      rows_attempted: 0, rows_failed: 0,
      latestCapturedAt: null, latestNormalized: null,
      workingCombo: null, comboSource,
      abortBatch: false, persistenceFailed: false,
      error: "cross_unit_filtered_all",
      attemptCount, attemptMatrix: summarizePollingAttemptsV2(attempts),
      crossUnitFiltered, totalReceived: positions.length,
      rejectedByCrossUnitFilter: true,
    };
  }

  const receivedAt = new Date().toISOString();
  const commit = await commitPositionBatch(supabase, {
    integrationAccountId: integration_account_id,
    unit, mapping, rows, receivedAt,
    pollMemo: {
      memo_version: POLL_MEMO_VERSION,
      poll_working_property: combo.property,
      poll_working_value_source: combo.value_source,
      poll_working_url: combo.url,
      poll_working_format: combo.format,
      poll_working_time_prop: combo.timeProp,
      combo_source: comboSource,
      last_success_run: receivedAt,
    },
  });
  const persistenceFailed = !commit.ok;
  if (!commit.ok) {
    console.error(`[SSX:poll-positions] PERSISTENCE_FAILURE | unit=${unit.external_code} | error=${commit.error}`);
  }

  return {
    positions_found: true,
    inserted: commit.ok ? commit.inserted : 0,
    duplicates: commit.ok ? commit.duplicates : 0,
    rows_attempted: rows.length, rows_failed: commit.ok ? 0 : rows.length,
    latestCapturedAt: latestNormalized?.captured_at || null,
    latestNormalized,
    workingCombo: combo, comboSource,
    abortBatch: persistenceFailed, abortReason: persistenceFailed ? "persistence_failure" : undefined,
    persistenceFailed,
    persistenceCommitted: commit.ok,
    latestApplied: commit.ok && commit.latestApplied,
    attemptCount, attemptMatrix: summarizePollingAttemptsV2(attempts),
    crossUnitFiltered, outsideBindingWindow, totalReceived: positions.length,
    rejectedByCrossUnitFilter: false,
  };
}

function buildAbortResult(reason: string, attempts: PollingAttemptLog[], attemptCount: number): PollUnitResult {
  return {
    positions_found: false, inserted: 0, duplicates: 0,
    rows_attempted: 0, rows_failed: 0,
    latestCapturedAt: null, latestNormalized: null,
    workingCombo: null, comboSource: "none",
    abortBatch: true, abortReason: reason, persistenceFailed: reason === "persistence_failure",
    attemptCount, attemptMatrix: summarizePollingAttemptsV2(attempts),
  };
}

// ==================== Unit Identifier Matching ====================

interface UnitIdentifierSet {
  normalizedStrict: Set<string>;
  normalizedContains: Set<string>;
  numericIds: Set<string>;
}

function isWithinBindingWindow(capturedAt: string, mapping: TrackerBinding): boolean {
  const capturedMs = Date.parse(capturedAt);
  const startMs = Date.parse(mapping.start_at);
  const endMs = mapping.end_at ? Date.parse(mapping.end_at) : Number.POSITIVE_INFINITY;
  return Number.isFinite(capturedMs) && Number.isFinite(startMs) &&
    capturedMs >= startMs && capturedMs < endMs;
}

function normalizeIdentifier(value: unknown): string {
  if (value == null) return "";
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeNumericIdentifier(value: unknown): string {
  if (value == null) return "";
  return String(value).trim().replace(/[^0-9]+/g, "");
}

function buildUnitIdentifierSet(unit: any, meta: Record<string, any>): UnitIdentifierSet {
  const normalizedStrict = new Set<string>();
  const normalizedContains = new Set<string>();
  const numericIds = new Set<string>();

  const addText = (value: unknown, allowContains = true) => {
    const normalized = normalizeIdentifier(value);
    if (!normalized) return;
    normalizedStrict.add(normalized);
    if (allowContains && normalized.length >= 6) normalizedContains.add(normalized);
  };

  const addNumeric = (value: unknown) => {
    const numeric = normalizeNumericIdentifier(value);
    if (!numeric) return;
    numericIds.add(numeric);
  };

  addText(unit.external_code);
  addText(unit.label);
  addText(meta.vehicle_integration_code);
  addText(meta.tracked_unit_integration_code);
  addText(meta.tracker_integration_code);
  addText(meta.tracked_unit);
  addText(meta.plate);
  addNumeric(meta.id_tracked_unit);
  addNumeric(meta.id_tracker);

  return { normalizedStrict, normalizedContains, numericIds };
}

function isPointFromCurrentUnit(telemetry: Record<string, any>, unitIds: UnitIdentifierSet): boolean {
  const telemetryCandidateFields = [
    telemetry.TrackedUnit, telemetry.trackedUnit,
    telemetry.Plate, telemetry.plate,
    telemetry.VehicleIntegrationCode, telemetry.vehicleIntegrationCode,
    telemetry.TrackedUnitIntegrationCode, telemetry.trackedUnitIntegrationCode,
    telemetry.TrackerIntegrationCode, telemetry.trackerIntegrationCode,
  ];

  const telemetryIdFields = [telemetry.IdTrackedUnit, telemetry.idTrackedUnit, telemetry.IdTracker, telemetry.idTracker];

  const telemetryNumericIds = telemetryIdFields.map((v) => normalizeNumericIdentifier(v)).filter(Boolean);

  if (unitIds.numericIds.size > 0 && telemetryNumericIds.length > 0) {
    const hasNumericMatch = telemetryNumericIds.some((id) => unitIds.numericIds.has(id));
    if (!hasNumericMatch) return false;
  }

  const telemetryNormalized = telemetryCandidateFields.map((v) => normalizeIdentifier(v)).filter(Boolean);

  if (telemetryNormalized.length === 0 && telemetryNumericIds.length === 0) {
    return true;
  }

  if (telemetryNormalized.some((value) => unitIds.normalizedStrict.has(value))) return true;

  const hasContainsMatch = telemetryNormalized.some((pid) => {
    if (pid.length < 6) return false;
    for (const uid of unitIds.normalizedContains) {
      if (pid.includes(uid) || uid.includes(pid)) return true;
    }
    return false;
  });

  if (hasContainsMatch) return true;

  if (unitIds.numericIds.size > 0 && telemetryNumericIds.length > 0) {
    return telemetryNumericIds.some((id) => unitIds.numericIds.has(id));
  }

  return false;
}

function isPointFromCurrentUnitBroadband(
  telemetry: Record<string, any>,
  unitIds: UnitIdentifierSet,
): boolean {
  const textIdentifiers = [
    telemetry.TrackedUnit, telemetry.trackedUnit,
    telemetry.Plate, telemetry.plate,
    telemetry.VehicleIntegrationCode, telemetry.vehicleIntegrationCode,
    telemetry.TrackedUnitIntegrationCode, telemetry.trackedUnitIntegrationCode,
    telemetry.TrackerIntegrationCode, telemetry.trackerIntegrationCode,
  ].map((value) => normalizeIdentifier(value)).filter(Boolean);
  const numericIdentifiers = [
    telemetry.IdTrackedUnit, telemetry.idTrackedUnit,
    telemetry.IdTracker, telemetry.idTracker,
  ].map((value) => normalizeNumericIdentifier(value)).filter(Boolean);

  if (textIdentifiers.length === 0 && numericIdentifiers.length === 0) return false;
  if (unitIds.numericIds.size > 0 && numericIdentifiers.length > 0) {
    return numericIdentifiers.some((identifier) => unitIds.numericIds.has(identifier));
  }
  return textIdentifiers.some((identifier) => unitIds.normalizedStrict.has(identifier));
}

// ==================== Position Normalizer ====================

function normalizePosition(point: any): {
  lat: number; lng: number; speed: number | null; heading: number | null;
  captured_at: string; telemetry: Record<string, any>;
} | null {
  const lat = point.Latitude ?? point.latitude ?? point.Lat ?? point.lat ?? point.Y ?? point.y;
  const lng = point.Longitude ?? point.longitude ?? point.Lng ?? point.lng ?? point.X ?? point.x;
  const speed = point.Speed ?? point.speed ?? point.Velocidade ?? null;
  const heading = point.Direction ?? point.direction ?? point.Heading ?? point.heading ?? point.Course ?? null;

  const dateStr =
    point.EventDate ?? point.eventDate ??
    point.UpdateDate ?? point.updateDate ??
    point.DateTimeGPS ?? point.dateTimeGPS ??
    point.DateTimeServer ?? point.dateTimeServer ??
    point.DateTime ?? point.dateTime ??
    point.Date ?? point.date ??
    point.Timestamp ?? point.timestamp;

  if (lat == null || lng == null || !dateStr) return null;
  const parsedLat = typeof lat === "string" ? parseFloat(lat) : lat;
  const parsedLng = typeof lng === "string" ? parseFloat(lng) : lng;
  if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) return null;
  if (parsedLat < -90 || parsedLat > 90 || parsedLng < -180 || parsedLng > 180) return null;
  if (parsedLat === 0 && parsedLng === 0) return null;

  let captured_at: string;
  try { captured_at = new Date(dateStr).toISOString(); } catch { return null; }
  const capturedMs = Date.parse(captured_at);
  if (capturedMs < Date.UTC(2000, 0, 1) || capturedMs > Date.now() + 5 * 60_000) return null;

  const knownFields = new Set([
    "Latitude", "latitude", "Lat", "lat", "Y", "y",
    "Longitude", "longitude", "Lng", "lng", "X", "x",
    "Speed", "speed", "Velocidade",
    "Direction", "direction", "Heading", "heading", "Course",
    "EventDate", "eventDate", "UpdateDate", "updateDate",
    "DateTimeGPS", "dateTimeGPS", "DateTimeServer", "dateTimeServer",
    "DateTime", "dateTime", "Date", "date", "Timestamp", "timestamp",
  ]);

  const telemetry: Record<string, any> = {};
  for (const [key, val] of Object.entries(point)) {
    if (!knownFields.has(key) && val != null) telemetry[key] = val;
  }

  const parsedSpeed = speed == null ? null : (typeof speed === "string" ? parseFloat(speed) : speed);
  const parsedHeading = heading == null ? null : (typeof heading === "string" ? parseFloat(heading) : heading);
  return {
    lat: parsedLat, lng: parsedLng,
    speed: Number.isFinite(parsedSpeed) && parsedSpeed >= 0 && parsedSpeed <= 300 ? parsedSpeed : null,
    heading: Number.isFinite(parsedHeading) && parsedHeading >= 0 && parsedHeading <= 360 ? parsedHeading : null,
    captured_at, telemetry,
  };
}

// ==================== Helpers ====================

type PositionPersistenceRow = {
  captured_at: string;
  lat: number;
  lng: number;
  speed: number | null;
  heading: number | null;
  telemetry: Record<string, any>;
  provider_payload_hash: string;
};

async function toPersistenceRow(
  normalized: ReturnType<typeof normalizePosition> & object,
  unit: any,
  trackerLinkId: string,
): Promise<PositionPersistenceRow> {
  const telemetry = normalized.telemetry || {};
  const trackedUnitForHash = String(
    telemetry.TrackedUnit ?? telemetry.trackedUnit ??
    telemetry.IdTrackedUnit ?? telemetry.idTrackedUnit ?? ""
  );
  const hashInput = canonicalJson({
    unit_external_code: unit.external_code,
    tracker_link_id: trackerLinkId,
    tracked_unit: trackedUnitForHash,
    captured_at: normalized.captured_at,
    lat: normalized.lat,
    lng: normalized.lng,
    speed: normalized.speed,
    heading: normalized.heading,
    telemetry,
  });
  return {
    captured_at: normalized.captured_at,
    lat: normalized.lat,
    lng: normalized.lng,
    speed: normalized.speed,
    heading: normalized.heading,
    telemetry,
    provider_payload_hash: await sha256Hex(hashInput),
  };
}

async function buildPersistenceRows(
  points: any[],
  unit: any,
  trackerLinkId: string,
): Promise<PositionPersistenceRow[]> {
  const normalized = points
    .map((point) => normalizePosition(point))
    .filter((position): position is NonNullable<typeof position> => position !== null);
  const rows = await Promise.all(normalized.map((position) =>
    toPersistenceRow(position, unit, trackerLinkId)
  ));
  return rows.sort((a, b) => a.captured_at.localeCompare(b.captured_at));
}

function splitPersistenceRows(rows: PositionPersistenceRow[]): PositionPersistenceRow[][] {
  if (rows.length === 0) return [[]];
  if (rows.length > 5000) throw new Error("ssx_position_batch_too_large");
  const bytes = new TextEncoder().encode(JSON.stringify(rows)).byteLength;
  if (bytes > 7_500_000) throw new Error("ssx_position_batch_too_large");
  return [rows];
}

type CommitPositionResult =
  | { ok: true; inserted: number; duplicates: number; latestApplied: boolean }
  | { ok: false; error: string };

async function commitPositionBatch(supabase: any, input: {
  integrationAccountId: string;
  unit: any;
  mapping: TrackerBinding;
  rows: PositionPersistenceRow[];
  receivedAt: string;
  pollMemo: Record<string, any>;
}): Promise<CommitPositionResult> {
  let batches: PositionPersistenceRow[][];
  try {
    batches = splitPersistenceRows(input.rows);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "ssx_position_payload_invalid" };
  }
  let inserted = 0;
  let duplicates = 0;
  let latestApplied = false;
  for (const rows of batches) {
    const { data, error } = await supabase.rpc("commit_ssx_position_batch_v1", {
      _tenant_id: input.mapping.tenant_id,
      _integration_account_id: input.integrationAccountId,
      _provider_unit_id: input.unit.id,
      _tracker_link_id: input.mapping.link_id,
      _vehicle_id: input.mapping.vehicle_id,
      _received_at: input.receivedAt,
      _positions: rows,
      _poll_memo: input.pollMemo,
    });
    if (error) return { ok: false, error: error.message || "ssx_position_commit_failed" };
    const receipt = Array.isArray(data) ? data[0] : data;
    if (!receipt || receipt.version !== 1 ||
        receipt.tenant_id !== input.mapping.tenant_id ||
        receipt.integration_account_id !== input.integrationAccountId ||
        receipt.provider_unit_id !== input.unit.id ||
        receipt.tracker_link_id !== input.mapping.link_id ||
        receipt.vehicle_id !== input.mapping.vehicle_id ||
        !Number.isInteger(receipt.attempted) || receipt.attempted !== rows.length ||
        !Number.isInteger(receipt.inserted) || receipt.inserted < 0 ||
        !Number.isInteger(receipt.duplicates) || receipt.duplicates < 0 ||
        receipt.inserted + receipt.duplicates !== receipt.attempted ||
        typeof receipt.latest_applied !== "boolean") {
      return { ok: false, error: "ssx_position_commit_receipt_invalid" };
    }
    inserted += receipt.inserted;
    duplicates += receipt.duplicates;
    latestApplied ||= receipt.latest_applied;
  }
  return { ok: true, inserted, duplicates, latestApplied };
}

async function recordPollError(supabase: any, input: {
  integrationAccountId: string;
  unit: any;
  mapping: TrackerBinding;
  observedAt: string;
  error: string;
  backoffUntil: string;
  pollMemo: Record<string, any>;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("record_ssx_poll_error_v1", {
    _tenant_id: input.mapping.tenant_id,
    _integration_account_id: input.integrationAccountId,
    _provider_unit_id: input.unit.id,
    _tracker_link_id: input.mapping.link_id,
    _vehicle_id: input.mapping.vehicle_id,
    _observed_at: input.observedAt,
    _error: input.error.slice(0, 500),
    _backoff_until: input.backoffUntil,
    _poll_memo: input.pollMemo,
  });
  if (error) return { ok: false, error: error.message || "ssx_poll_error_commit_failed" };
  const receipt = Array.isArray(data) ? data[0] : data;
  if (!receipt || receipt.version !== 1 ||
      receipt.tenant_id !== input.mapping.tenant_id ||
      receipt.integration_account_id !== input.integrationAccountId ||
      receipt.provider_unit_id !== input.unit.id ||
      receipt.tracker_link_id !== input.mapping.link_id ||
      receipt.vehicle_id !== input.mapping.vehicle_id) {
    return { ok: false, error: "ssx_poll_error_receipt_invalid" };
  }
  return { ok: true };
}

function summarizePollingAttemptsV2(attempts: PollingAttemptLog[]): string[] {
  return attempts.map(a =>
    `POST ${a.url} [${a.property}=${a.value}|${a.timeProp}|${a.format}] => ${a.statusCode} ${a.errorClass}${a.itemCount > 0 ? ` items=${a.itemCount}` : ""}`
  );
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`
  ).join(",")}}`;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function setAccountCooldown(
  supabase: any,
  tenantId: string,
  accountId: string,
  observedAt: string,
  cooldownSeconds: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const cooldownUntil = new Date(
    new Date(observedAt).getTime() + cooldownSeconds * 1000,
  ).toISOString();
  const { data, error } = await supabase.rpc("record_ssx_account_cooldown_v1", {
    _tenant_id: tenantId,
    _integration_account_id: accountId,
    _observed_at: observedAt,
    _cooldown_until: cooldownUntil,
    _error: "Rate limited by SSX (429)",
  });
  if (error) return { ok: false, error: error.message || "ssx_account_cooldown_failed" };
  const receipt = Array.isArray(data) ? data[0] : data;
  if (!receipt || receipt.version !== 1 || receipt.tenant_id !== tenantId ||
      receipt.integration_account_id !== accountId ||
      typeof receipt.cooldown_until !== "string") {
    return { ok: false, error: "ssx_account_cooldown_receipt_invalid" };
  }
  return { ok: true };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function jsonResp(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
