/**
 * ssx-poll-positions — Polls position history from SSX for active provider units.
 *
 * BROADBAND-FIRST DESIGN (v10):
 * - Normal polling: 1 single request to PositionHistory WITHOUT unit filter
 * - Distributes returned positions to matching vehicles locally
 * - Vehicles not in response = heartbeat (stopped)
 * - Speed computed via haversine delta between current and previous position
 * - Per-unit discovery preserved ONLY for manual/debug runs
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
  type SsxErrorClass,
} from "../_shared/ssx-utils.ts";

const POLL_MEMO_VERSION = 10;
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

    // Get vehicle_tracker_links for all units
    const unitIds = units.map((u: any) => u.id);
    const { data: links } = await supabase
      .from("vehicle_tracker_links").select("*")
      .in("provider_unit_id", unitIds).eq("active", true);

    const unitToVehicle: Record<string, { vehicle_id: string; tenant_id: string }> = {};
    for (const link of links || []) {
      unitToVehicle[link.provider_unit_id] = { vehicle_id: link.vehicle_id, tenant_id: link.tenant_id };
    }

    // Build PositionHistory URL candidates
    const positionUrls = buildPositionHistoryUrlCandidates(config.baseUrl, config.apiVersion);

    const isDebugMode = provider_unit_ids?.length === 1;
    const ON_CONFLICT_TARGET = "tenant_id,vehicle_id,provider_payload_hash";

    // ============================================================
    // BROADBAND-FIRST: 1 request for the entire fleet
    // ============================================================
    if (!manual_run && !isDebugMode) {
      return await broadbandPoll({
        units, unitToVehicle, positionUrls, config, supabase,
        integration_account_id, lookback_minutes, ON_CONFLICT_TARGET,
      });
    }

    // ============================================================
    // LEGACY PER-UNIT: Only for manual/debug runs
    // ============================================================
    return await legacyPerUnitPoll({
      units, unitToVehicle, positionUrls, config, supabase,
      integration_account_id, manual_run, force_rediscovery,
      lookback_minutes, isDebugMode, ON_CONFLICT_TARGET,
    });

  } catch (err: any) {
    console.error("[SSX:poll-positions] error:", err);
    return jsonResp({ error: "Internal error", details: err.message }, 500);
  }
});

// ==================== BROADBAND POLL (1 request for all units) ====================

async function broadbandPoll(params: {
  units: any[];
  unitToVehicle: Record<string, { vehicle_id: string; tenant_id: string }>;
  positionUrls: string[];
  config: any;
  supabase: any;
  integration_account_id: string;
  lookback_minutes?: number;
  ON_CONFLICT_TARGET: string;
}): Promise<Response> {
  const { units, unitToVehicle, positionUrls, config, supabase,
    integration_account_id, lookback_minutes, ON_CONFLICT_TARGET } = params;

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
    await setAccountCooldown(supabase, integration_account_id, config, 120);
    return jsonResp({
      success: false, batch_aborted: true, abort_reason: "rate_limited",
      total_units: units.length, total_inserted: 0,
    });
  }

  if (!resp.ok) {
    return jsonResp({
      success: false, error: `SSX returned ${resp.status}`,
      total_units: units.length, total_inserted: 0,
    });
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

  for (const item of allItems) {
    const normalized = normalizePosition(item);
    if (!normalized) continue;

    const telemetry = { ...item };
    let matched = false;

    for (const { unit, mapping, identifiers } of unitIdentifierSets) {
      if (isPointFromCurrentUnit(telemetry, identifiers)) {
        const key = mapping.vehicle_id;
        if (!vehiclePositions.has(key)) {
          vehiclePositions.set(key, { unit, mapping, points: [] });
        }
        vehiclePositions.get(key)!.points.push(item);
        matched = true;
        break; // Each point belongs to exactly one unit
      }
    }

    if (!matched) unmatched++;
  }

  console.log(`[SSX:poll-positions] BROADBAND distributed: ${vehiclePositions.size} vehicles matched, ${unmatched} unmatched points`);

  // Process each vehicle's positions
  let totalInserted = 0;
  let totalDuplicates = 0;
  let totalFailed = 0;
  const touchedVehicles: { tenant_id: string; vehicle_id: string; captured_at: string }[] = [];
  const results: any[] = [];
  let persistenceFailed = false;

  for (const [vehicleId, { unit, mapping, points }] of vehiclePositions) {
    // Normalize, hash, and prepare rows
    const rows: any[] = [];
    let latestNormalized: any = null;

    for (const point of points) {
      const normalized = normalizePosition(point);
      if (!normalized) continue;

      if (!latestNormalized || new Date(normalized.captured_at) > new Date(latestNormalized.captured_at)) {
        latestNormalized = normalized;
      }

      const telemetry = normalized.telemetry || {};
      const trackedUnitForHash = String(
        telemetry.TrackedUnit ?? telemetry.trackedUnit ?? telemetry.IdTrackedUnit ?? telemetry.idTrackedUnit ?? ""
      );
      const hashInput = `${unit.external_code}|${trackedUnitForHash}|${normalized.lat}|${normalized.lng}|${normalized.captured_at}`;
      const hash = simpleHash(hashInput);

      rows.push({
        tenant_id: mapping.tenant_id, vehicle_id: mapping.vehicle_id,
        captured_at: normalized.captured_at, lat: normalized.lat, lng: normalized.lng,
        speed: normalized.speed, heading: normalized.heading,
        telemetry: normalized.telemetry, provider_payload_hash: hash,
      });
    }

    if (rows.length === 0) continue;

    // Insert into positions_raw
    let inserted = 0;
    let duplicates = 0;

    const CHUNK = 100;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const { data: insertedRows, error: insertErr } = await supabase
        .from("positions_raw").upsert(chunk, {
          onConflict: ON_CONFLICT_TARGET,
          ignoreDuplicates: true,
        })
        .select("id");

      if (insertErr) {
        persistenceFailed = true;
        totalFailed += chunk.length;
        console.error(`[SSX:poll-positions] PERSISTENCE_FAILURE | vehicle=${vehicleId} | error=${insertErr.message}`);
        break;
      } else {
        const ins = insertedRows?.length || 0;
        inserted += ins;
        duplicates += chunk.length - ins;
      }
    }

    totalInserted += inserted;
    totalDuplicates += duplicates;

    // Update positions_last with computed speed
    if (latestNormalized && !persistenceFailed) {
      await updatePositionsLast(supabase, mapping, unit, latestNormalized, "broadband");

      if (inserted > 0) {
        touchedVehicles.push({
          tenant_id: mapping.tenant_id, vehicle_id: mapping.vehicle_id,
          captured_at: latestNormalized.captured_at,
        });
      }
    }

    // Update cursor
    const now = new Date();
    if (!persistenceFailed) {
      await upsertCursor(supabase, {
        tenant_id: mapping.tenant_id, provider_unit_id: unit.id,
        last_polled_at: now.toISOString(),
        last_error: null, backoff_until: null,
        last_success_at: latestNormalized?.captured_at || now.toISOString(),
        poll_memo: {
          memo_version: POLL_MEMO_VERSION,
          poll_mode: "broadband",
          last_success_run: now.toISOString(),
        },
      });
    }

    results.push({
      unit_code: unit.external_code, status: "ok",
      positions_found: true, inserted, duplicates,
      combo_source: "broadband",
    });
  }

  // Heartbeat for vehicles with NO new positions (vehicle is stopped)
  const matchedVehicleIds = new Set(vehiclePositions.keys());
  for (const { unit, mapping } of unitIdentifierSets) {
    if (matchedVehicleIds.has(mapping.vehicle_id)) continue;
    if (persistenceFailed) continue;

    // Heartbeat — update received_at and confirm stopped status
    const heartbeatNow = new Date().toISOString();
    const { data: existingPos } = await supabase.from("positions_last")
      .select("speed, source, captured_at")
      .eq("tenant_id", mapping.tenant_id).eq("vehicle_id", mapping.vehicle_id).single();

    if (existingPos) {
      const existingSource = (existingPos.source as Record<string, any>) || {};
      await supabase.from("positions_last")
        .update({
          received_at: heartbeatNow,
          speed: existingPos.speed ?? 0,
          source: {
            ...existingSource,
            speed_source: "heartbeat",
            movement_state: "stopped",
          },
        })
        .eq("tenant_id", mapping.tenant_id)
        .eq("vehicle_id", mapping.vehicle_id);
    }

    // Update cursor last_polled_at (no error)
    await upsertCursor(supabase, {
      tenant_id: mapping.tenant_id, provider_unit_id: unit.id,
      last_polled_at: heartbeatNow,
      last_error: null, backoff_until: null,
      poll_memo: {
        memo_version: POLL_MEMO_VERSION,
        poll_mode: "broadband",
        last_heartbeat: heartbeatNow,
      },
    });

    results.push({
      unit_code: unit.external_code, status: "heartbeat",
      positions_found: false, inserted: 0, duplicates: 0,
      combo_source: "broadband_heartbeat",
    });
  }

  // Enqueue touched vehicles for processing
  for (const tv of touchedVehicles) {
    await supabase.from("vehicle_processing_queue").upsert({
      tenant_id: tv.tenant_id, vehicle_id: tv.vehicle_id,
      queued_at: new Date().toISOString(), last_position_at: tv.captured_at,
      processed_at: null, attempts: 0, last_error: null,
    }, { onConflict: "tenant_id,vehicle_id" });
  }

  // Log integration
  await logIntegration(supabase, {
    tenant_id: units[0] ? unitToVehicle[units[0].id]?.tenant_id : null,
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
      vehicles_heartbeat: unitIdentifierSets.length - vehiclePositions.size,
      unmatched_positions: unmatched,
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
    vehicles_heartbeat: unitIdentifierSets.length - vehiclePositions.size,
    unmatched_positions: unmatched,
    total_inserted: totalInserted,
    total_duplicates: totalDuplicates,
    total_failed: totalFailed,
    batch_aborted: persistenceFailed,
    abort_reason: persistenceFailed ? "persistence_failure" : null,
    touched_vehicles: touchedVehicles.length,
    results,
  });
}

// ==================== Update positions_last with computed speed ====================

async function updatePositionsLast(
  supabase: any,
  mapping: { vehicle_id: string; tenant_id: string },
  unit: any,
  latestNormalized: any,
  comboSource: string,
) {
  const ln = latestNormalized;
  const { data: currentLast } = await supabase
    .from("positions_last").select("captured_at,lat,lng,speed")
    .eq("tenant_id", mapping.tenant_id).eq("vehicle_id", mapping.vehicle_id).single();

  const shouldUpdate = !currentLast || new Date(ln.captured_at) >= new Date(currentLast.captured_at);
  if (!shouldUpdate) return;

  // Compute speed from position delta (haversine)
  let computedSpeed: number | null = ln.speed;
  const speedSource: "provider" | "computed" = ln.speed != null ? "provider" : "computed";
  let distanceFromPreviousM: number | null = null;
  let timeSincePreviousS: number | null = null;
  let movementState: "moving" | "stopped" = "stopped";

  if (currentLast) {
    distanceFromPreviousM = haversineMeters(currentLast.lat, currentLast.lng, ln.lat, ln.lng);
    timeSincePreviousS = (new Date(ln.captured_at).getTime() - new Date(currentLast.captured_at).getTime()) / 1000;

    if (ln.speed == null) {
      if (timeSincePreviousS <= 0 || distanceFromPreviousM < 50) {
        // Same position or same timestamp → stationary
        computedSpeed = 0;
      } else {
        computedSpeed = Math.round((distanceFromPreviousM / timeSincePreviousS) * 3.6 * 10) / 10;
      }
    }
    const effectiveSpeed = computedSpeed ?? ln.speed ?? 0;
    movementState = effectiveSpeed > 3 ? "moving" : "stopped";
  } else if (ln.speed != null) {
    movementState = ln.speed > 3 ? "moving" : "stopped";
  } else {
    computedSpeed = 0;
  }

  const staleMinutes = (Date.now() - new Date(ln.captured_at).getTime()) / 60000;
  await supabase.from("positions_last").upsert({
    tenant_id: mapping.tenant_id, vehicle_id: mapping.vehicle_id,
    lat: ln.lat, lng: ln.lng,
    speed: computedSpeed, heading: ln.heading,
    captured_at: ln.captured_at, received_at: new Date().toISOString(),
    telemetry_snapshot: ln.telemetry || {},
    source: {
      provider: "SSX", unit_code: unit.external_code,
      stale: staleMinutes > STALE_AFTER_MINUTES,
      combo_source: comboSource,
      speed_source: speedSource,
      movement_state: movementState,
      distance_from_previous_m: distanceFromPreviousM != null ? Math.round(distanceFromPreviousM) : null,
      time_since_previous_s: timeSincePreviousS != null ? Math.round(timeSincePreviousS) : null,
    },
  }, { onConflict: "tenant_id,vehicle_id" });
}

// ==================== LEGACY PER-UNIT POLL (manual/debug only) ====================

async function legacyPerUnitPoll(params: {
  units: any[];
  unitToVehicle: Record<string, { vehicle_id: string; tenant_id: string }>;
  positionUrls: string[];
  config: any;
  supabase: any;
  integration_account_id: string;
  manual_run: boolean;
  force_rediscovery: boolean;
  lookback_minutes?: number;
  isDebugMode: boolean;
  ON_CONFLICT_TARGET: string;
}): Promise<Response> {
  const { units, unitToVehicle, positionUrls, config, supabase,
    integration_account_id, manual_run, force_rediscovery,
    lookback_minutes, isDebugMode, ON_CONFLICT_TARGET } = params;

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
  const touchedVehicles: { tenant_id: string; vehicle_id: string; captured_at: string }[] = [];
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

    const timeStart = incrementalStart && !force_rediscovery
      ? new Date(Math.max(incrementalStart.getTime(), maxLookbackStart.getTime())).toISOString()
      : maxLookbackStart.toISOString();

    const meta = (unit as any).metadata || {};
    const identifierCandidates = buildIdentifierCandidates(unit.external_code, meta);

    const cursorMemo = (cursor?.poll_memo || {}) as Record<string, any>;
    const memoValid = cursorMemo.memo_version === POLL_MEMO_VERSION && !force_rediscovery;

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
        await setAccountCooldown(supabase, integration_account_id, config, 120);
      }
    }

    if (unitResult.workingCombo && !scoutHint) {
      scoutHint = unitResult.workingCombo;
    }

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
      const advanceCursorTo = unitResult.latestCapturedAt || cursor?.last_success_at || null;
      await upsertCursor(supabase, {
        tenant_id: mapping.tenant_id, provider_unit_id: unit.id,
        last_polled_at: now.toISOString(),
        last_error: null, backoff_until: null,
        last_success_at: advanceCursorTo,
        poll_memo: newMemo,
      });
    } else {
      await upsertCursor(supabase, {
        tenant_id: mapping.tenant_id, provider_unit_id: unit.id,
        last_polled_at: now.toISOString(),
        last_error_at: unitResult.positions_found ? null : now.toISOString(),
        last_error: unitResult.positions_found ? null : (unitResult.error || "No combination returned positions"),
        backoff_until: unitResult.positions_found ? null : new Date(Date.now() + 60000).toISOString(),
        poll_memo: { memo_version: POLL_MEMO_VERSION, cleared: true, cleared_reason: unitResult.comboSource || "no_working_combo", cleared_at: now.toISOString() },
      });
    }

    if (!unitResult.persistenceFailed) {
      await invalidateMismatchedPositionLast(supabase, mapping, unit);
    }

    if (unitResult.latestNormalized && !unitResult.persistenceFailed) {
      await updatePositionsLast(supabase, mapping, unit, unitResult.latestNormalized, unitResult.comboSource);
    } else if (!unitResult.latestNormalized && unitResult.workingCombo && !unitResult.persistenceFailed) {
      const heartbeatNow = new Date().toISOString();
      const { data: existingPos } = await supabase.from("positions_last")
        .select("speed, source")
        .eq("tenant_id", mapping.tenant_id).eq("vehicle_id", mapping.vehicle_id).single();

      if (existingPos) {
        const existingSource = (existingPos?.source as Record<string, any>) || {};
        await supabase.from("positions_last")
          .update({
            received_at: heartbeatNow,
            speed: existingPos?.speed ?? 0,
            source: {
              ...existingSource,
              speed_source: "heartbeat",
              movement_state: "stopped",
            },
          })
          .eq("tenant_id", mapping.tenant_id)
          .eq("vehicle_id", mapping.vehicle_id);
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
      combo_source: unitResult.comboSource,
      attempt_matrix: isDebugMode ? unitResult.attemptMatrix : undefined,
    });
  }

  for (const tv of touchedVehicles) {
    await supabase.from("vehicle_processing_queue").upsert({
      tenant_id: tv.tenant_id, vehicle_id: tv.vehicle_id,
      queued_at: new Date().toISOString(), last_position_at: tv.captured_at,
      processed_at: null, attempts: 0, last_error: null,
    }, { onConflict: "tenant_id,vehicle_id" });
  }

  return jsonResp({
    success: !batchAborted, mode: "legacy_per_unit",
    total_units: units.length,
    total_inserted: totalInserted, total_duplicates: totalDuplicates,
    total_failed: totalFailed,
    on_conflict_target: ON_CONFLICT_TARGET,
    touched_vehicles: touchedVehicles.length,
    scout_hint: scoutHint ? `${scoutHint.property}:${scoutHint.value_source}@${scoutHint.url}` : null,
    batch_aborted: batchAborted,
    abort_reason: abortReason || null,
    manual_run, force_rediscovery: params.force_rediscovery,
    results,
  });
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
  error?: string;
  attemptCount: number;
  attemptMatrix: string[];
  crossUnitFiltered?: number;
  totalReceived?: number;
  rejectedByCrossUnitFilter?: boolean;
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

  const meta = (unit as any).metadata || {};
  const unitIdentifiers = buildUnitIdentifierSet(unit, meta);
  let crossUnitFiltered = 0;

  const rows: any[] = [];
  for (const point of positions) {
    const normalized = normalizePosition(point);
    if (!normalized) continue;

    if (!isPointFromCurrentUnit(normalized.telemetry || {}, unitIdentifiers)) {
      crossUnitFiltered++;
      continue;
    }

    if (!latestNormalized || new Date(normalized.captured_at) > new Date(latestNormalized.captured_at)) {
      latestNormalized = normalized;
    }

    const telemetry = normalized.telemetry || {};
    const trackedUnitForHash = String(
      telemetry.TrackedUnit ?? telemetry.trackedUnit ?? telemetry.IdTrackedUnit ?? telemetry.idTrackedUnit ?? ""
    );
    const hashInput = `${unit.external_code}|${trackedUnitForHash}|${normalized.lat}|${normalized.lng}|${normalized.captured_at}`;
    const hash = simpleHash(hashInput);

    rows.push({
      tenant_id: mapping.tenant_id, vehicle_id: mapping.vehicle_id,
      captured_at: normalized.captured_at, lat: normalized.lat, lng: normalized.lng,
      speed: normalized.speed, heading: normalized.heading,
      telemetry: normalized.telemetry, provider_payload_hash: hash,
    });
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

  const CHUNK = 100;
  let persistenceFailed = false;
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
      persistenceFailed = true;
      rowsFailed += chunk.length;
      console.error(`[SSX:poll-positions] PERSISTENCE_FAILURE | unit=${unit.external_code} | error=${insertErr.message}`);
      break;
    } else {
      const ins = insertedRows?.length || 0;
      inserted += ins;
      duplicates += chunk.length - ins;
    }
  }

  return {
    positions_found: true, inserted, duplicates,
    rows_attempted: rows.length, rows_failed: rowsFailed,
    latestCapturedAt: latestNormalized?.captured_at || null,
    latestNormalized,
    workingCombo: combo, comboSource,
    abortBatch: persistenceFailed, abortReason: persistenceFailed ? "persistence_failure" : undefined,
    persistenceFailed,
    attemptCount, attemptMatrix: summarizePollingAttemptsV2(attempts),
    crossUnitFiltered, totalReceived: positions.length,
    rejectedByCrossUnitFilter: false,
  };
}

async function invalidateMismatchedPositionLast(
  supabase: any, mapping: { vehicle_id: string; tenant_id: string }, unit: any,
) {
  const { data: currentLast } = await supabase
    .from("positions_last").select("telemetry_snapshot")
    .eq("tenant_id", mapping.tenant_id).eq("vehicle_id", mapping.vehicle_id).maybeSingle();

  if (!currentLast?.telemetry_snapshot) return;

  const meta = (unit as any).metadata || {};
  const unitIdentifiers = buildUnitIdentifierSet(unit, meta);
  if (!isPointFromCurrentUnit(currentLast.telemetry_snapshot || {}, unitIdentifiers)) {
    await supabase.from("positions_last").delete()
      .eq("tenant_id", mapping.tenant_id).eq("vehicle_id", mapping.vehicle_id);
    console.log(`[SSX:poll-positions] INVALIDATED_STALE_POSITION_LAST | unit=${unit.external_code}`);
  }
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
  const hex = (h >>> 0).toString(16).padStart(8, "0");
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

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function jsonResp(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
