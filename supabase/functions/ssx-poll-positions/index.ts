/**
 * ssx-poll-positions — Polls position history from SSX for active provider units.
 *
 * KEY DESIGN (patch 7 — per-unit discovery):
 * - Scout approach is now a HINT only, not a hard truth for all units
 * - If scout combo returns empty for a unit, per-unit rediscovery runs
 * - Uses provider_units.metadata for richer identifier candidates
 * - Per-unit memo stored in ingestion_cursors.poll_memo
 * - Both EventDate and UpdateDate are actually tested
 * - positions_last updated from best provider point even if all inserts are dupes
 * - Manual run supports force_rediscovery + wider lookback
 * - POLL_MEMO_VERSION = 7
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  corsHeaders,
  buildPositionHistoryUrlCandidates,
  readAccountConfig,
  extractResponseItems,
  ssxPost,
  logIntegration,
  logSsxCall,
  getTenantRole,
  summarizePollingAttempts,
  type SsxErrorClass,
} from "../_shared/ssx-utils.ts";

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

const POLL_MEMO_VERSION = 7;
const STALE_AFTER_MINUTES = 30;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    let callerId: string | null = null;
    const cronSecret = req.headers.get("x-agvlog-cron-secret");
    const expectedCronSecret = Deno.env.get("AGVLOG_CRON_SECRET");
    const isCron = !!(cronSecret && expectedCronSecret && cronSecret === expectedCronSecret);

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

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body = await req.json();
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

    const config = readAccountConfig(account);

    if (!config.token || !account.token_expires_at) {
      return jsonResp({ error: "No token cached. Run ssx-login first." }, 400);
    }
    if (new Date(account.token_expires_at).getTime() < Date.now()) {
      return jsonResp({ error: "Token expired. Run ssx-login first." }, 400);
    }

    // Check account-level cooldown
    const cooldownUntil = config.settings.poll_cooldown_until;
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

    const isDebugMode = provider_unit_ids?.length === 1;
    const maxUnits = config.settings.max_units_per_poll_run || 3;
    const unitsToProcess = units.slice(0, maxUnits);

    // Get vehicle_tracker_links
    const unitIds = unitsToProcess.map((u: any) => u.id);
    const { data: links } = await supabase
      .from("vehicle_tracker_links").select("*")
      .in("provider_unit_id", unitIds).eq("active", true);

    const unitToVehicle: Record<string, { vehicle_id: string; tenant_id: string }> = {};
    for (const link of links || []) {
      unitToVehicle[link.provider_unit_id] = { vehicle_id: link.vehicle_id, tenant_id: link.tenant_id };
    }

    // Build PositionHistory URL candidates
    const positionUrls = buildPositionHistoryUrlCandidates(config.baseUrl, config.apiVersion);
    const defaultPollWindow = config.pollWindowMinutes;
    const initialPollWindowMinutes = lookback_minutes || config.settings.initial_poll_window_minutes || 10080;

    // Time props to try
    const timeProps = ["EventDate", "UpdateDate"];

    // Throttle settings
    const requestSpacingMs = config.settings.request_spacing_ms ?? 400;
    const discoverySpacingMs = config.settings.discovery_request_spacing_ms ?? 500;

    // Account-level scout hint (not a hard truth)
    let scoutHint: { property: string; value_source: string; url: string; format: string; timeProp: string } | null = null;

    const results: any[] = [];
  const ON_CONFLICT_TARGET = "tenant_id,vehicle_id,provider_payload_hash";
  console.log(`[SSX:poll-positions] on_conflict_target=${ON_CONFLICT_TARGET}`);

  let totalInserted = 0;
  let totalDuplicates = 0;
  let totalFailed = 0;
  const touchedVehicles: { tenant_id: string; vehicle_id: string; captured_at: string }[] = [];
  let batchAborted = false;
  let abortReason = "";

    for (let unitIdx = 0; unitIdx < unitsToProcess.length; unitIdx++) {
      if (batchAborted) break;
      const unit = unitsToProcess[unitIdx];

      if (unitIdx > 0 && requestSpacingMs > 0) {
        await sleep(requestSpacingMs);
      }

      const mapping = unitToVehicle[unit.id];
      if (!mapping) {
        results.push({ unit_code: unit.external_code, status: "skipped", reason: "No active vehicle link" });
        continue;
      }

      // Get cursor
      const { data: cursor } = await supabase
        .from("ingestion_cursors").select("*")
        .eq("provider_unit_id", unit.id).eq("tenant_id", mapping.tenant_id).single();

      // Check backoff (skip for manual runs)
      if (!manual_run && cursor?.backoff_until && new Date(cursor.backoff_until) > new Date()) {
        results.push({ unit_code: unit.external_code, status: "skipped", reason: "In backoff period" });
        continue;
      }

      const now = new Date();
      const isFirstPoll = !cursor?.last_success_at;
      const pollWindowMinutes = isFirstPoll ? initialPollWindowMinutes : (manual_run ? Math.max(defaultPollWindow, 1440) : defaultPollWindow);

      const timeStart = cursor?.last_success_at && !force_rediscovery
        ? new Date(new Date(cursor.last_success_at).getTime() - 2 * 60_000).toISOString()
        : new Date(Date.now() - pollWindowMinutes * 60_000).toISOString();

      // ===== Build identifier candidates from unit metadata =====
      const meta = (unit as any).metadata || {};
      const identifierCandidates = buildIdentifierCandidates(unit.external_code, meta);

      // ===== Load per-unit memo from cursor =====
      const cursorMemo = (cursor?.poll_memo || {}) as Record<string, any>;
      const memoValid = cursorMemo.memo_version === POLL_MEMO_VERSION && !force_rediscovery;

      let unitResult = await pollSingleUnit({
        unit, mapping, identifierCandidates, timeProps, positionUrls,
        config, supabase, timeStart, now,
        cursorMemo: memoValid ? cursorMemo : null,
        scoutHint: force_rediscovery ? null : scoutHint,
        isDebugMode, discoverySpacingMs, manual_run,
        integration_account_id,
      });

    // Handle abort (429 or persistence failure)
    if (unitResult.abortBatch) {
      batchAborted = true;
      abortReason = unitResult.abortReason || "rate_limited";
      if (unitResult.abortReason === "rate_limited") {
        await setAccountCooldown(supabase, integration_account_id, config, 120);
      }
      // On persistence_failure: do NOT advance cursor, do NOT continue polling
    }

      // Update scout hint from first successful unit
      if (unitResult.workingCombo && !scoutHint) {
        scoutHint = unitResult.workingCombo;
      }

    // Save per-unit memo to cursor — only advance last_success_at if persistence succeeded
    if (unitResult.workingCombo && !unitResult.persistenceFailed) {
      const newMemo = {
        memo_version: POLL_MEMO_VERSION,
        poll_working_property: unitResult.workingCombo.property,
        poll_working_value_source: unitResult.workingCombo.value_source,
        poll_working_url: unitResult.workingCombo.url,
        poll_working_format: unitResult.workingCombo.format,
        poll_working_time_prop: unitResult.workingCombo.timeProp,
        last_success_run: now.toISOString(),
      };
      // Only advance cursor if inserts actually succeeded
      const advanceCursorTo = unitResult.inserted > 0
        ? (unitResult.latestCapturedAt || cursor?.last_success_at || null)
        : (cursor?.last_success_at || null);
      await upsertCursor(supabase, {
        tenant_id: mapping.tenant_id, provider_unit_id: unit.id,
        last_polled_at: now.toISOString(),
        last_error: null, backoff_until: null,
        last_success_at: advanceCursorTo,
        poll_memo: newMemo,
      });
      } else {
        // No working combo — save error state
        await upsertCursor(supabase, {
          tenant_id: mapping.tenant_id, provider_unit_id: unit.id,
          last_polled_at: now.toISOString(),
          last_error_at: unitResult.positions_found ? null : now.toISOString(),
          last_error: unitResult.positions_found ? null : (unitResult.error || "No combination returned positions"),
          backoff_until: unitResult.positions_found ? null : new Date(Date.now() + 60000).toISOString(),
        });
      }

    // Update positions_last only if persistence succeeded (not on persistence failure)
    if (unitResult.latestNormalized && !unitResult.persistenceFailed) {
        const ln = unitResult.latestNormalized;
        // Check if this is newer than current positions_last
        const { data: currentLast } = await supabase
          .from("positions_last").select("captured_at")
          .eq("tenant_id", mapping.tenant_id).eq("vehicle_id", mapping.vehicle_id).single();

        const shouldUpdate = !currentLast || new Date(ln.captured_at) > new Date(currentLast.captured_at);
        if (shouldUpdate) {
          const staleMinutes = (Date.now() - new Date(ln.captured_at).getTime()) / 60000;
          await supabase.from("positions_last").upsert({
            tenant_id: mapping.tenant_id, vehicle_id: mapping.vehicle_id,
            lat: ln.lat, lng: ln.lng,
            speed: ln.speed, heading: ln.heading,
            captured_at: ln.captured_at, received_at: new Date().toISOString(),
            telemetry_snapshot: ln.telemetry || {},
            source: {
              provider: "SSX", unit_code: unit.external_code,
              stale: staleMinutes > STALE_AFTER_MINUTES,
              combo_source: unitResult.comboSource,
            },
          }, { onConflict: "tenant_id,vehicle_id" });
        }
      }

    totalInserted += unitResult.inserted;
    totalDuplicates += unitResult.duplicates;
    totalFailed += unitResult.rows_failed || 0;

    if (unitResult.inserted > 0) {
        touchedVehicles.push({
          tenant_id: mapping.tenant_id, vehicle_id: mapping.vehicle_id,
          captured_at: unitResult.latestCapturedAt || now.toISOString(),
        });
      }

      results.push({
        unit_code: unit.external_code,
        status: unitResult.persistenceFailed ? "persistence_failure" : (unitResult.positions_found ? "ok" : (unitResult.abortBatch ? "error" : "no_data")),
        positions_found: unitResult.positions_found,
        inserted: unitResult.inserted,
        duplicates: unitResult.duplicates,
        rows_attempted: unitResult.rows_attempted || 0,
        rows_failed: unitResult.rows_failed || 0,
        insert_error_class: unitResult.insert_error_class || null,
        insert_error_message: unitResult.insert_error_message || null,
        on_conflict_target_used: ON_CONFLICT_TARGET,
        latest_position_at: unitResult.latestCapturedAt,
        stale_position: unitResult.latestCapturedAt
          ? (Date.now() - new Date(unitResult.latestCapturedAt).getTime()) > STALE_AFTER_MINUTES * 60000
          : null,
        offline_by_age: unitResult.latestCapturedAt
          ? (Date.now() - new Date(unitResult.latestCapturedAt).getTime()) > 10 * 60000
          : null,
        combo_source: unitResult.comboSource,
        identifier_property_used: unitResult.workingCombo?.property,
        identifier_value_used: unitResult.workingCombo?.value_source,
        time_property_used: unitResult.workingCombo?.timeProp,
        endpoint_used: unitResult.workingCombo?.url,
        attempts_made: unitResult.attemptCount,
        attempt_matrix: isDebugMode ? unitResult.attemptMatrix : undefined,
      });
    }

    // Enqueue touched vehicles
    for (const tv of touchedVehicles) {
      await supabase.from("vehicle_processing_queue").upsert({
        tenant_id: tv.tenant_id, vehicle_id: tv.vehicle_id,
        queued_at: new Date().toISOString(), last_position_at: tv.captured_at,
        processed_at: null, attempts: 0, last_error: null,
      }, { onConflict: "tenant_id,vehicle_id" });
    }

    return jsonResp({
      success: !batchAborted, total_units: unitsToProcess.length,
      total_inserted: totalInserted, total_duplicates: totalDuplicates,
      total_failed: totalFailed,
      on_conflict_target: ON_CONFLICT_TARGET,
      touched_vehicles: touchedVehicles.length,
      scout_hint: scoutHint ? `${scoutHint.property}:${scoutHint.value_source}@${scoutHint.url}` : null,
      batch_aborted: batchAborted,
      abort_reason: abortReason || null,
      manual_run, force_rediscovery,
      results,
    });
  } catch (err: any) {
    console.error("[SSX:poll-positions] error:", err);
    return jsonResp({ error: "Internal error", details: err.message }, 500);
  }
});

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
    if (!value || typeof value !== "string" || !value.trim()) return;
    const key = `${property}:${value.trim()}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ property, value: value.trim(), value_source: source });
  };

  // Priority order based on production evidence
  add("IntegrationCode", meta.integration_code, "metadata.integration_code");
  add("IntegrationCode", externalCode, "external_code");
  add("TrackedUnitIntegrationCode", meta.tracked_unit_integration_code, "metadata.tracked_unit_integration_code");
  add("TrackedUnitIntegrationCode", externalCode, "external_code");
  add("TrackedUnit", meta.tracked_unit, "metadata.tracked_unit");
  add("TrackerIntegrationCode", meta.tracker_integration_code, "metadata.tracker_integration_code");

  return candidates;
}

// ==================== Per-Unit Polling ====================

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
  insert_error_class?: string;
  insert_error_message?: string;
  error?: string;
  attemptCount: number;
  attemptMatrix: string[];
}

async function pollSingleUnit(params: {
  unit: any;
  mapping: { vehicle_id: string; tenant_id: string };
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
    timeStart, now, cursorMemo, scoutHint, isDebugMode, discoverySpacingMs, manual_run, integration_account_id } = params;

  const attempts: PollingAttemptLog[] = [];
  let attemptCount = 0;
  const MAX_ATTEMPTS = isDebugMode ? 24 : 8;

  // Helper to try a specific combo
  async function tryCombo(
    property: string, value: string, valueSource: string,
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

  // ===== STAGE 1: Try per-unit memo =====
  if (cursorMemo) {
    const memoProp = cursorMemo.poll_working_property;
    const memoValueSource = cursorMemo.poll_working_value_source;
    const memoUrl = cursorMemo.poll_working_url;
    const memoFormat = cursorMemo.poll_working_format;
    const memoTimeProp = cursorMemo.poll_working_time_prop;

    if (memoProp && memoUrl && memoFormat && memoTimeProp) {
      // Find the value for the memoized property/source
      const memoCandidate = identifierCandidates.find(
        c => c.property === memoProp && c.value_source === memoValueSource
      ) || identifierCandidates.find(c => c.property === memoProp);

      if (memoCandidate) {
        const r = await tryCombo(memoProp, memoCandidate.value, memoCandidate.value_source, memoUrl, memoFormat, memoTimeProp, "unit_memo");
        if (r?.abort) return buildAbortResult(r.abortReason!, attempts, attemptCount);
        if (r && r.items.length > 0) {
          return await processPositions(r.items, r.resp, unit, mapping, supabase, config,
            { property: memoProp, value_source: memoCandidate.value_source, url: memoUrl, format: memoFormat, timeProp: memoTimeProp },
            "unit_memo", attempts, attemptCount, integration_account_id);
        }
      }
    }
  }

  // ===== STAGE 2: Try scout hint (from another unit's success this batch) =====
  if (scoutHint) {
    const hintCandidate = identifierCandidates.find(c => c.property === scoutHint.property)
      || identifierCandidates[0];
    if (hintCandidate) {
      const r = await tryCombo(scoutHint.property, hintCandidate.value, hintCandidate.value_source,
        scoutHint.url, scoutHint.format as any, scoutHint.timeProp, "scout_hint");
      if (r?.abort) return buildAbortResult(r.abortReason!, attempts, attemptCount);
      if (r && r.items.length > 0) {
        return await processPositions(r.items, r.resp, unit, mapping, supabase, config,
          { property: scoutHint.property, value_source: hintCandidate.value_source, url: scoutHint.url, format: scoutHint.format, timeProp: scoutHint.timeProp },
          "scout_hint", attempts, attemptCount, integration_account_id);
      }
      // Scout hint returned empty for this unit — fall through to per-unit discovery
    }
  }

  // ===== STAGE 3: Per-unit staged discovery =====
  // Try each identifier candidate × URL × time property
  for (const candidate of identifierCandidates) {
    if (attemptCount >= MAX_ATTEMPTS) break;

    for (const url of positionUrls) {
      if (attemptCount >= MAX_ATTEMPTS) break;

      for (const timeProp of timeProps) {
        if (attemptCount >= MAX_ATTEMPTS) break;

        // Try array format first
        const r = await tryCombo(candidate.property, candidate.value, candidate.value_source, url, "array", timeProp, "discovery");
        if (r?.abort) return buildAbortResult(r.abortReason!, attempts, attemptCount);
        if (r && r.items.length > 0) {
          return await processPositions(r.items, r.resp, unit, mapping, supabase, config,
            { property: candidate.property, value_source: candidate.value_source, url, format: "array", timeProp },
            "unit_rediscovery", attempts, attemptCount, integration_account_id);
        }

        // If 400/415, try wrapped
        if (r?.resp?.errorClass === "body_incompatible") {
          const rw = await tryCombo(candidate.property, candidate.value, candidate.value_source, url, "wrapped", timeProp, "discovery_wrapped");
          if (rw?.abort) return buildAbortResult(rw.abortReason!, attempts, attemptCount);
          if (rw && rw.items.length > 0) {
            return await processPositions(rw.items, rw.resp, unit, mapping, supabase, config,
              { property: candidate.property, value_source: candidate.value_source, url, format: "wrapped", timeProp },
              "unit_rediscovery", attempts, attemptCount, integration_account_id);
          }
        }

        // 404 → skip to next URL
        if (r?.resp?.errorClass === "route_not_found") break;
      }
    }
  }

  // All combos exhausted — no data for this unit
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
  positions: any[], resp: any, unit: any,
  mapping: { vehicle_id: string; tenant_id: string },
  supabase: any, config: any,
  combo: { property: string; value_source: string; url: string; format: string; timeProp: string },
  comboSource: string,
  attempts: PollingAttemptLog[], attemptCount: number,
  integration_account_id: string,
): Promise<PollUnitResult> {
  let inserted = 0;
  let duplicates = 0;
  let latestNormalized: any = null;

  // Normalize all positions first, compute hashes, then batch insert
  const rows: any[] = [];
  for (const point of positions) {
    const normalized = normalizePosition(point);
    if (!normalized) continue;

    if (!latestNormalized || new Date(normalized.captured_at) > new Date(latestNormalized.captured_at)) {
      latestNormalized = normalized;
    }

    const hashInput = `${unit.external_code}|${normalized.lat}|${normalized.lng}|${normalized.captured_at}`;
    // Use simple string hash to avoid expensive crypto
    const hash = simpleHash(hashInput);

    rows.push({
      tenant_id: mapping.tenant_id, vehicle_id: mapping.vehicle_id,
      captured_at: normalized.captured_at, lat: normalized.lat, lng: normalized.lng,
      speed: normalized.speed, heading: normalized.heading,
      telemetry: normalized.telemetry, provider_payload_hash: hash,
    });
  }

  // Batch insert in chunks of 100
  const CHUNK = 100;
  let persistenceFailed = false;
  let insertErrorClass: string | undefined;
  let insertErrorMessage: string | undefined;
  let rowsFailed = 0;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { data: insertedRows, error: insertErr } = await supabase
      .from("positions_raw").upsert(chunk, {
        onConflict: "tenant_id,vehicle_id,provider_payload_hash",
        ignoreDuplicates: true,
      })
      .select("id");

    if (insertErr) {
      // CRITICAL: Do NOT mask as duplicates. This is a real persistence failure.
      persistenceFailed = true;
      rowsFailed += chunk.length;
      insertErrorClass = insertErr.message?.includes("ON CONFLICT")
        ? "persistence_conflict_target_invalid"
        : "persistence_insert_failed";
      insertErrorMessage = insertErr.message;
      console.error(`[SSX:poll-positions] PERSISTENCE_FAILURE | on_conflict_target=tenant_id,vehicle_id,provider_payload_hash | rows_attempted=${chunk.length} | provider_unit=${unit.external_code} | vehicle=${mapping.vehicle_id} | error_class=${insertErrorClass} | error=${insertErr.message}`);
      // ABORT: stop inserting remaining chunks — DB path is broken
      break;
    } else {
      const ins = insertedRows?.length || 0;
      inserted += ins;
      duplicates += chunk.length - ins;
    }
  }

  const success = !persistenceFailed;

  await logIntegration(supabase, {
    tenant_id: mapping.tenant_id, integration_account_id,
    action: "ssx_poll_positions", endpoint: combo.url,
    status_code: 200, success,
    error_message: insertErrorMessage || undefined,
    duration_ms: resp.durationMs,
    metadata: {
      unit_code: unit.external_code,
      points_received: positions.length,
      rows_attempted: rows.length,
      inserted, duplicates,
      rows_failed: rowsFailed,
      insert_error_class: insertErrorClass || null,
      insert_error_message: insertErrorMessage || null,
      on_conflict_target_used: "tenant_id,vehicle_id,provider_payload_hash",
      filter_property: combo.property,
      value_source: combo.value_source,
      time_filter_property: combo.timeProp,
      body_format: combo.format,
      combo_source: comboSource,
    },
  });

  return {
    positions_found: true,
    inserted, duplicates,
    rows_attempted: rows.length,
    rows_failed: rowsFailed,
    latestCapturedAt: latestNormalized?.captured_at || null,
    latestNormalized,
    workingCombo: combo,
    comboSource,
    abortBatch: persistenceFailed,
    abortReason: persistenceFailed ? "persistence_failure" : undefined,
    persistenceFailed,
    insert_error_class: insertErrorClass,
    insert_error_message: insertErrorMessage,
    attemptCount,
    attemptMatrix: summarizePollingAttemptsV2(attempts),
  };
}

function buildAbortResult(reason: string, attempts: PollingAttemptLog[], attemptCount: number): PollUnitResult {
  return {
    positions_found: false, inserted: 0, duplicates: 0,
    rows_attempted: 0, rows_failed: 0,
    latestCapturedAt: null, latestNormalized: null,
    workingCombo: null, comboSource: "none",
    abortBatch: true, abortReason: reason, persistenceFailed: reason === "persistence_failure",
    attemptCount,
    attemptMatrix: summarizePollingAttemptsV2(attempts),
  };
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
  if (isNaN(parsedLat) || isNaN(parsedLng)) return null;
  if (parsedLat === 0 && parsedLng === 0) return null;

  let captured_at: string;
  try { captured_at = new Date(dateStr).toISOString(); } catch { return null; }

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

  return {
    lat: parsedLat, lng: parsedLng,
    speed: speed != null ? (typeof speed === "string" ? parseFloat(speed) : speed) : null,
    heading: heading != null ? (typeof heading === "string" ? parseFloat(heading) : heading) : null,
    captured_at, telemetry,
  };
}

// ==================== Helpers ====================

function summarizePollingAttemptsV2(attempts: PollingAttemptLog[]): string[] {
  return attempts.map(a =>
    `POST ${a.url} [${a.property}=${a.value}|${a.timeProp}|${a.format}] => ${a.statusCode} ${a.errorClass}${a.itemCount > 0 ? ` items=${a.itemCount}` : ""}`
  );
}

function simpleHash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) - h + input.charCodeAt(i)) | 0;
  }
  // Convert to hex and pad to make it look like a hash
  const hex = (h >>> 0).toString(16).padStart(8, "0");
  // Add more entropy from length and char sum
  let sum = 0;
  for (let i = 0; i < input.length; i++) sum += input.charCodeAt(i);
  const extra = ((sum * 31) >>> 0).toString(16).padStart(8, "0");
  return `sh_${hex}${extra}_${input.length}`;
}

async function upsertCursor(supabase: any, data: Record<string, any>) {
  await supabase.from("ingestion_cursors").upsert(data, { onConflict: "provider_unit_id,tenant_id" });
}

async function setAccountCooldown(supabase: any, accountId: string, config: any, cooldownSeconds: number) {
  const cooldownUntil = new Date(Date.now() + cooldownSeconds * 1000).toISOString();
  const { data: currentAccount } = await supabase
    .from("integration_accounts").select("settings").eq("id", accountId).single();
  const currentSettings = currentAccount?.settings || {};
  await supabase.from("integration_accounts").update({
    settings: { ...currentSettings, poll_cooldown_until: cooldownUntil },
    last_error: "Rate limited by SSX (429)",
    updated_at: new Date().toISOString(),
  }).eq("id", accountId);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function jsonResp(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
