/**
 * ssx-poll-positions — Polls position history from SSX for active provider units.
 *
 * KEY FIXES (patch 5 — scout approach):
 * - URL order: unversioned FIRST (production-proven), then v3, then v2
 * - Property order: IntegrationCode FIRST (production-proven)
 * - Scout approach: first unit discovers combo, rest reuse it
 * - 200 OK with zero items is NOT memoized
 * - Spacing increased to 500ms default to reduce 429 risk
 * - POLL_MEMO_VERSION bumped to 6 to force rediscovery
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
  timeProp: string;
  format: string;
  statusCode: number;
  errorClass: string;
  itemCount: number;
}

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
    const { integration_account_id, provider_unit_ids } = await req.json();

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

    // Check account-level cooldown (set by previous 429)
    const cooldownUntil = config.settings.poll_cooldown_until;
    if (cooldownUntil && new Date(cooldownUntil) > new Date()) {
      const retryAfterSec = Math.ceil((new Date(cooldownUntil).getTime() - Date.now()) / 1000);
      return jsonResp({
        error: "Account in cooldown from previous rate limit",
        retry_after_seconds: retryAfterSec,
        cooldown_until: cooldownUntil,
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
      return jsonResp({ error: "No active provider units found", details: unitsErr?.message }, 404);
    }

    // Single-unit debug mode
    const isDebugMode = provider_unit_ids?.length === 1;

    // Apply max_units_per_poll_run
    const maxUnits = config.settings.max_units_per_poll_run || units.length;
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

    // Build PositionHistory URL candidates: unversioned, v3, v2
    const positionUrls = buildPositionHistoryUrlCandidates(config.baseUrl, config.apiVersion);
    const defaultPollWindow = config.pollWindowMinutes;

    // Load persisted working combination from account settings
    let workingProperty: string | null = config.settings.poll_working_property || null;
    let workingUrl: string | null = config.settings.poll_working_url || null;
    let workingFormat: "array" | "wrapped" | null = config.settings.poll_working_format || null;
    let workingTimeProp: string | null = config.settings.poll_working_time_prop || null;

    // Track consecutive empty runs for stale memo invalidation
    let memoEmptyCount: number = config.settings.poll_memo_empty_count ?? 0;
    const STALE_MEMO_THRESHOLD = config.settings.poll_stale_memo_threshold ?? 2;

    // ===== Auto-reset memo from older code versions =====
    const POLL_MEMO_VERSION = 6;
    const needsMemoReset = config.settings.poll_memo_version !== POLL_MEMO_VERSION;
    if (needsMemoReset) {
      console.log(`[SSX:poll-positions] Resetting poll memo (version ${config.settings.poll_memo_version || "none"} → ${POLL_MEMO_VERSION})`);
      workingProperty = null; workingUrl = null; workingFormat = null; workingTimeProp = null;
      memoEmptyCount = 0;
      const { data: resetAcc } = await supabase.from("integration_accounts").select("settings").eq("id", integration_account_id).single();
      const resetSettings = resetAcc?.settings || {};
      await supabase.from("integration_accounts").update({
        settings: {
          ...resetSettings,
          poll_working_property: null, poll_working_url: null,
          poll_working_format: null, poll_working_time_prop: null,
          poll_memo_empty_count: 0, poll_memo_version: POLL_MEMO_VERSION,
        },
        updated_at: new Date().toISOString(),
      }).eq("id", integration_account_id);
    }

    // ===== Filter property candidates — IntegrationCode FIRST =====
    const filterPropertyCandidates = [
      config.settings.filter_property,
      "IntegrationCode",               // proven to work in production
      "TrackedUnitIntegrationCode",
      "TrackedUnit",
      "TrackerIntegrationCode",
    ].filter(Boolean) as string[];
    const uniqueFilterProps = [...new Set(filterPropertyCandidates)];

    // Time filter property candidates
    const timeFilterCandidates = [
      config.settings.time_filter_property,
      "EventDate",
      "UpdateDate",
    ].filter(Boolean) as string[];
    const uniqueTimeProps = [...new Set(timeFilterCandidates)];

    // ===== Throttle settings — increased spacing =====
    const requestSpacingMs = config.settings.request_spacing_ms ?? 300;
    const discoverySpacingMs = config.settings.discovery_request_spacing_ms ?? 400;
    const discoveryMaxAttempts = config.settings.discovery_max_attempts_per_unit ?? 6;
    const initialPollWindowMinutes = config.settings.initial_poll_window_minutes ?? 10080; // 7 days

    const results: any[] = [];
    let totalInserted = 0;
    let totalDuplicates = 0;
    const touchedVehicles: { tenant_id: string; vehicle_id: string; captured_at: string }[] = [];
    let batchAborted = false;
    let abortReason = "";
    let memoProducedItems = false;

    // ===== SCOUT APPROACH =====
    // The first unit that needs discovery acts as the "scout".
    // Once the scout finds a working combo, all remaining units reuse it.
    let scoutCompleted = false;

    for (let unitIdx = 0; unitIdx < unitsToProcess.length; unitIdx++) {
      const unit = unitsToProcess[unitIdx];

      // Throttle between units (skip first)
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

      // Check backoff
      if (cursor?.backoff_until && new Date(cursor.backoff_until) > new Date()) {
        results.push({ unit_code: unit.external_code, status: "skipped", reason: "In backoff period" });
        continue;
      }

      const now = new Date();
      const isFirstPoll = !cursor?.last_success_at;
      const pollWindowMinutes = isFirstPoll ? initialPollWindowMinutes : defaultPollWindow;

      // Derive time window
      const timeStart = cursor?.last_success_at
        ? new Date(new Date(cursor.last_success_at).getTime() - 2 * 60_000).toISOString()
        : new Date(Date.now() - pollWindowMinutes * 60_000).toISOString();

      const unitAttempts: PollingAttemptLog[] = [];
      let resp: any = null;
      let usedProperty = workingProperty;
      let usedUrl = workingUrl;
      let usedFormat = workingFormat;
      let usedTimeProp = workingTimeProp || uniqueTimeProps[0];
      let discoveryAttemptCount = 0;
      let foundWithItems = false;

      // === Try memoized combination first (only if not stale) ===
      const memoIsStale = memoEmptyCount >= STALE_MEMO_THRESHOLD;

      if (workingProperty && workingUrl && workingFormat && workingTimeProp && !memoIsStale) {
        const filters = [
          { PropertyName: workingProperty, Condition: "=", Value: unit.external_code },
          { PropertyName: workingTimeProp, Condition: ">=", Value: timeStart },
        ];
        const body = workingFormat === "array" ? filters : { Filters: filters };
        resp = await ssxPost(workingUrl, config.token, body, config.requestTimeoutMs);
        discoveryAttemptCount++;

        const memoItems = resp.ok ? extractResponseItems(resp.parsed) : [];

        logSsxCall({
          routine: "poll-positions", endpoint: workingUrl, method: "POST",
          apiVersion: config.apiVersion,
          attemptType: `memo:${workingProperty}:${workingFormat}:${workingTimeProp}`,
          statusCode: resp.status, durationMs: resp.durationMs,
          responsePreview: (resp.text || "").substring(0, 150),
          result: memoItems.length > 0 ? "success" : (resp.ok ? "empty" : "error"),
          errorClass: resp.ok ? (memoItems.length > 0 ? undefined : "empty_response" as SsxErrorClass) : resp.errorClass,
        });

        unitAttempts.push({
          url: workingUrl, property: workingProperty, timeProp: workingTimeProp,
          format: workingFormat, statusCode: resp.status,
          errorClass: resp.ok ? (memoItems.length > 0 ? "success" : "empty_response") : resp.errorClass,
          itemCount: memoItems.length,
        });

        // 429 early-stop
        if (resp.errorClass === "rate_limited") {
          batchAborted = true;
          abortReason = "rate_limited";
          await setAccountCooldown(supabase, integration_account_id, config, 120);
          results.push({
            unit_code: unit.external_code, status: "error", error_class: "rate_limited",
            attempt_matrix: isDebugMode ? summarizePollingAttempts(unitAttempts) : undefined,
          });
          break;
        }

        if (resp.ok && memoItems.length > 0) {
          foundWithItems = true;
          memoProducedItems = true;
        } else {
          // Memo returned empty or failed — fall through to discovery
          resp = null;
        }
      } else if (memoIsStale && workingProperty) {
        console.log(`[SSX:poll-positions] Memo is stale (${memoEmptyCount} consecutive empty runs), forcing rediscovery`);
        workingProperty = null; workingUrl = null; workingFormat = null; workingTimeProp = null;
        // Clear stale memo from DB immediately
        const { data: staleAcc } = await supabase.from("integration_accounts").select("settings").eq("id", integration_account_id).single();
        const staleSettings = staleAcc?.settings || {};
        await supabase.from("integration_accounts").update({
          settings: {
            ...staleSettings,
            poll_working_property: null, poll_working_url: null,
            poll_working_format: null, poll_working_time_prop: null,
            poll_memo_empty_count: 0,
          },
          updated_at: new Date().toISOString(),
        }).eq("id", integration_account_id);
      }

      // === Staged Discovery (only if no memo or memo failed) ===
      // Scout: only the first unit does full discovery; rest skip if scout already found combo
      if (!foundWithItems && !batchAborted) {
        if (scoutCompleted && workingProperty && workingUrl && workingFormat && workingTimeProp) {
          // Reuse scout combo directly — single request
          const filters = [
            { PropertyName: workingProperty, Condition: "=", Value: unit.external_code },
            { PropertyName: workingTimeProp, Condition: ">=", Value: timeStart },
          ];
          const body = workingFormat === "array" ? filters : { Filters: filters };
          resp = await ssxPost(workingUrl, config.token, body, config.requestTimeoutMs);
          discoveryAttemptCount++;

          const items = resp.ok ? extractResponseItems(resp.parsed) : [];
          unitAttempts.push({
            url: workingUrl, property: workingProperty, timeProp: workingTimeProp,
            format: workingFormat, statusCode: resp.status,
            errorClass: resp.ok ? (items.length > 0 ? "success" : "empty_response") : resp.errorClass,
            itemCount: items.length,
          });

          if (resp.errorClass === "rate_limited") {
            batchAborted = true; abortReason = "rate_limited";
            await setAccountCooldown(supabase, integration_account_id, config, 120);
          } else if (resp.ok && items.length > 0) {
            foundWithItems = true;
            memoProducedItems = true;
          }
          // If empty for this unit, that's ok — the combo still works, this unit just has no data
          // Don't fall through to discovery for non-scout units
          if (!foundWithItems && resp.ok) {
            // Mark as "no data" — not an error, just no positions for this unit in window
            usedProperty = workingProperty;
            usedUrl = workingUrl;
            usedFormat = workingFormat;
            usedTimeProp = workingTimeProp;
          }
        } else {
          // === SCOUT DISCOVERY — full staged discovery ===
          const discoveryTimeProp = uniqueTimeProps[0] || "EventDate";

          console.log(`[SSX:poll-positions] Scout discovery for unit ${unit.external_code} | URLs: ${positionUrls.join(", ")} | Props: ${uniqueFilterProps.join(", ")}`);

          for (const prop of uniqueFilterProps) {
            if (foundWithItems || batchAborted || discoveryAttemptCount >= discoveryMaxAttempts) break;

            for (const url of positionUrls) {
              if (foundWithItems || batchAborted || discoveryAttemptCount >= discoveryMaxAttempts) break;

              if (discoveryAttemptCount > 0) await sleep(discoverySpacingMs);

              const filters = [
                { PropertyName: prop, Condition: "=", Value: unit.external_code },
                { PropertyName: discoveryTimeProp, Condition: ">=", Value: timeStart },
              ];

              // Try array format first
              resp = await ssxPost(url, config.token, filters, config.requestTimeoutMs);
              discoveryAttemptCount++;
              const items = resp.ok ? extractResponseItems(resp.parsed) : [];

              logSsxCall({
                routine: "poll-positions", endpoint: url, method: "POST",
                apiVersion: config.apiVersion,
                attemptType: `scout:${prop}:array:${discoveryTimeProp}`,
                statusCode: resp.status, durationMs: resp.durationMs,
                responsePreview: (resp.text || "").substring(0, 150),
                result: items.length > 0 ? "success" : (resp.ok ? "empty" : "error"),
                errorClass: resp.ok ? (items.length > 0 ? undefined : "empty_response" as SsxErrorClass) : resp.errorClass,
              });

              unitAttempts.push({
                url, property: prop, timeProp: discoveryTimeProp, format: "array",
                statusCode: resp.status,
                errorClass: resp.ok ? (items.length > 0 ? "success" : "empty_response") : resp.errorClass,
                itemCount: items.length,
              });

              if (resp.errorClass === "rate_limited") {
                batchAborted = true; abortReason = "rate_limited";
                await setAccountCooldown(supabase, integration_account_id, config, 120);
                break;
              }
              if (resp.errorClass === "auth_error") {
                batchAborted = true; abortReason = "auth_error"; break;
              }

              if (resp.ok && items.length > 0) {
                usedProperty = prop; usedUrl = url; usedFormat = "array"; usedTimeProp = discoveryTimeProp;
                foundWithItems = true;
                // Scout found the combo — set it for all remaining units
                workingProperty = prop; workingUrl = url; workingFormat = "array"; workingTimeProp = discoveryTimeProp;
                scoutCompleted = true;
                memoProducedItems = true;
                console.log(`[SSX:poll-positions] Scout found working combo: ${prop} + ${url} + array + ${discoveryTimeProp} (${items.length} items)`);
                break;
              }

              // If 400/415, try wrapped format
              if (resp.errorClass === "body_incompatible" && discoveryAttemptCount < discoveryMaxAttempts) {
                await sleep(discoverySpacingMs);
                resp = await ssxPost(url, config.token, { Filters: filters }, config.requestTimeoutMs);
                discoveryAttemptCount++;
                const wrappedItems = resp.ok ? extractResponseItems(resp.parsed) : [];

                unitAttempts.push({
                  url, property: prop, timeProp: discoveryTimeProp, format: "wrapped",
                  statusCode: resp.status,
                  errorClass: resp.ok ? (wrappedItems.length > 0 ? "success" : "empty_response") : resp.errorClass,
                  itemCount: wrappedItems.length,
                });

                if (resp.errorClass === "rate_limited") {
                  batchAborted = true; abortReason = "rate_limited";
                  await setAccountCooldown(supabase, integration_account_id, config, 120);
                  break;
                }

                if (resp.ok && wrappedItems.length > 0) {
                  usedProperty = prop; usedUrl = url; usedFormat = "wrapped"; usedTimeProp = discoveryTimeProp;
                  foundWithItems = true;
                  workingProperty = prop; workingUrl = url; workingFormat = "wrapped"; workingTimeProp = discoveryTimeProp;
                  scoutCompleted = true;
                  memoProducedItems = true;
                  console.log(`[SSX:poll-positions] Scout found working combo: ${prop} + ${url} + wrapped + ${discoveryTimeProp} (${wrappedItems.length} items)`);
                  break;
                }
              }

              // 404 → skip to next URL
              if (resp.errorClass === "route_not_found") continue;
            }
          }
        }
      }

      if (batchAborted) {
        results.push({
          unit_code: unit.external_code, status: "error", error_class: abortReason,
          attempts_made: discoveryAttemptCount,
          attempt_matrix: isDebugMode ? summarizePollingAttempts(unitAttempts) : undefined,
        });
        break;
      }

      // No working combination found (all empty or errors)
      if (!foundWithItems) {
        // For non-scout units reusing a known combo, empty is expected (unit has no data)
        if (scoutCompleted && resp?.ok) {
          await upsertCursor(supabase, {
            tenant_id: mapping.tenant_id, provider_unit_id: unit.id,
            last_polled_at: now.toISOString(), last_error: null, backoff_until: null,
          });
          results.push({
            unit_code: unit.external_code, status: "ok",
            points_received: 0, inserted: 0, duplicates: 0,
            note: "No positions in time window (combo valid from scout)",
            attempts_made: discoveryAttemptCount,
            attempt_matrix: isDebugMode ? summarizePollingAttempts(unitAttempts) : undefined,
          });
          continue;
        }

        const errMsg = resp?.networkError || "No combination returned positions";
        const errClass: SsxErrorClass = resp?.errorClass || "empty_response";
        await upsertCursor(supabase, {
          tenant_id: mapping.tenant_id, provider_unit_id: unit.id,
          last_polled_at: now.toISOString(), last_error_at: now.toISOString(),
          last_error: errMsg, backoff_until: new Date(Date.now() + 60000).toISOString(),
        });
        await logIntegration(supabase, {
          tenant_id: mapping.tenant_id, integration_account_id,
          action: "ssx_poll_positions", endpoint: usedUrl || positionUrls[0],
          status_code: resp?.status || 0, success: false,
          error_message: errMsg,
          duration_ms: resp?.durationMs,
          metadata: {
            unit_code: unit.external_code, error_class: errClass,
            attempts_made: discoveryAttemptCount,
            endpoint_candidates: positionUrls,
            property_candidates: uniqueFilterProps,
            time_property_candidates: uniqueTimeProps,
            attempt_matrix: summarizePollingAttempts(unitAttempts),
          },
        });
        results.push({
          unit_code: unit.external_code, status: "error",
          error: errMsg, error_class: errClass,
          attempts_made: discoveryAttemptCount,
          attempt_matrix: isDebugMode ? summarizePollingAttempts(unitAttempts) : undefined,
        });
        continue;
      }

      // === Process positions (foundWithItems === true, resp is valid) ===
      const positions = extractResponseItems(resp.parsed);
      let inserted = 0;
      let duplicates = 0;
      let normalized_count = 0;
      let latestPoint: any = null;

      for (const point of positions) {
        const normalized = normalizePosition(point);
        if (!normalized) continue;
        normalized_count++;

        const hashInput = `${unit.external_code}|${normalized.lat}|${normalized.lng}|${normalized.captured_at}`;
        const hash = await computeHash(hashInput);

        const { error: insertErr } = await supabase.from("positions_raw").insert({
          tenant_id: mapping.tenant_id, vehicle_id: mapping.vehicle_id,
          captured_at: normalized.captured_at, lat: normalized.lat, lng: normalized.lng,
          speed: normalized.speed, heading: normalized.heading,
          telemetry: normalized.telemetry, provider_payload_hash: hash,
        });

        if (insertErr) {
          if (insertErr.code === "23505") duplicates++;
          else console.error("[SSX:poll-positions] Insert error:", insertErr);
        } else {
          inserted++;
          if (!latestPoint || new Date(normalized.captured_at) > new Date(latestPoint.captured_at)) {
            latestPoint = normalized;
          }
        }
      }

      // Update positions_last
      if (latestPoint) {
        await supabase.from("positions_last").upsert({
          tenant_id: mapping.tenant_id, vehicle_id: mapping.vehicle_id,
          lat: latestPoint.lat, lng: latestPoint.lng,
          speed: latestPoint.speed, heading: latestPoint.heading,
          captured_at: latestPoint.captured_at, received_at: new Date().toISOString(),
          telemetry_snapshot: latestPoint.telemetry || {},
          source: { provider: "SSX", unit_code: unit.external_code },
        }, { onConflict: "tenant_id,vehicle_id" });
      }

      // Update cursor — use provider timestamp for last_success_at
      const cursorUpdate: any = {
        tenant_id: mapping.tenant_id, provider_unit_id: unit.id,
        last_polled_at: now.toISOString(), last_error: null, backoff_until: null,
      };
      if (inserted > 0) {
        cursorUpdate.last_success_at = latestPoint?.captured_at || now.toISOString();
      }
      await upsertCursor(supabase, cursorUpdate);

      // Memoize ONLY if we got items
      workingProperty = usedProperty;
      workingUrl = usedUrl;
      workingFormat = usedFormat;
      workingTimeProp = usedTimeProp;
      memoProducedItems = true;
      if (!scoutCompleted) scoutCompleted = true;

      await logIntegration(supabase, {
        tenant_id: mapping.tenant_id, integration_account_id,
        action: "ssx_poll_positions", endpoint: usedUrl || positionUrls[0],
        status_code: 200, success: true, duration_ms: resp.durationMs,
        metadata: {
          unit_code: unit.external_code,
          points_received: positions.length,
          points_normalized: normalized_count,
          inserted, duplicates,
          filter_property: usedProperty,
          time_filter_property: usedTimeProp,
          body_format: usedFormat,
          time_window_start: timeStart,
          endpoint_used: usedUrl,
          attempts_made: discoveryAttemptCount,
          is_scout: unitIdx === 0 || !scoutCompleted,
          memoized: true,
          attempt_matrix: summarizePollingAttempts(unitAttempts),
        },
      });

      totalInserted += inserted;
      totalDuplicates += duplicates;

      if (inserted > 0 && mapping) {
        touchedVehicles.push({
          tenant_id: mapping.tenant_id, vehicle_id: mapping.vehicle_id,
          captured_at: latestPoint?.captured_at || new Date().toISOString(),
        });
      }

      results.push({
        unit_code: unit.external_code, status: "ok",
        points_received: positions.length, points_normalized: normalized_count,
        inserted, duplicates,
        filter_property: usedProperty, time_filter_property: usedTimeProp,
        body_format: usedFormat,
        attempts_made: discoveryAttemptCount,
        is_scout: !scoutCompleted,
        attempt_matrix: isDebugMode ? summarizePollingAttempts(unitAttempts) : undefined,
      });
    }

    // Persist working combination ONLY if it produced items this run
    if (memoProducedItems && workingProperty && workingUrl && workingFormat && workingTimeProp) {
      const { data: currentAccount } = await supabase
        .from("integration_accounts").select("settings").eq("id", integration_account_id).single();
      const currentSettings = currentAccount?.settings || {};
      const needsUpdate =
        currentSettings.poll_working_property !== workingProperty ||
        currentSettings.poll_working_url !== workingUrl ||
        currentSettings.poll_working_format !== workingFormat ||
        currentSettings.poll_working_time_prop !== workingTimeProp ||
        (currentSettings.poll_memo_empty_count || 0) !== 0;
      if (needsUpdate) {
        await supabase.from("integration_accounts").update({
          settings: {
            ...currentSettings,
            poll_working_property: workingProperty,
            poll_working_url: workingUrl,
            poll_working_format: workingFormat,
            poll_working_time_prop: workingTimeProp,
            poll_memo_empty_count: 0,
            poll_memo_version: POLL_MEMO_VERSION,
          },
          updated_at: new Date().toISOString(),
        }).eq("id", integration_account_id);
        console.log(`[SSX:poll-positions] Persisted working combo: ${workingProperty} + ${workingUrl} + ${workingFormat} + ${workingTimeProp}`);
      }
    } else if (!memoProducedItems && !batchAborted && workingProperty) {
      // Memo existed but produced no items this run — increment stale counter
      const { data: currentAccount } = await supabase
        .from("integration_accounts").select("settings").eq("id", integration_account_id).single();
      const currentSettings = currentAccount?.settings || {};
      const newCount = (currentSettings.poll_memo_empty_count || 0) + 1;
      const updates: Record<string, any> = {
        settings: { ...currentSettings, poll_memo_empty_count: newCount },
        updated_at: new Date().toISOString(),
      };
      if (newCount >= STALE_MEMO_THRESHOLD) {
        updates.settings.poll_working_property = null;
        updates.settings.poll_working_url = null;
        updates.settings.poll_working_format = null;
        updates.settings.poll_working_time_prop = null;
        console.log(`[SSX:poll-positions] Cleared stale memo after ${newCount} consecutive empty runs`);
      }
      await supabase.from("integration_accounts").update(updates).eq("id", integration_account_id);
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
      total_units_available: units.length,
      total_inserted: totalInserted, total_duplicates: totalDuplicates,
      touched_vehicles: touchedVehicles.length,
      working_filter_property: workingProperty,
      working_time_property: workingTimeProp,
      working_endpoint: workingUrl,
      working_format: workingFormat,
      scout_completed: scoutCompleted,
      batch_aborted: batchAborted,
      abort_reason: abortReason || null,
      endpoint_candidates: positionUrls,
      initial_poll_window_minutes: initialPollWindowMinutes,
      results,
    });
  } catch (err: any) {
    console.error("[SSX:poll-positions] error:", err);
    return jsonResp({ error: "Internal error", details: err.message }, 500);
  }
});

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

async function computeHash(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
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
  console.log(`[SSX:poll-positions] Set account cooldown until ${cooldownUntil}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function jsonResp(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
