/**
 * ssx-poll-positions — Polls position history from SSX for active provider units.
 *
 * IMPROVEMENTS:
 * - Uses buildSsxUrlCandidates for versioned + unversioned tracking URLs.
 * - Sends BOTH unit filter AND time window filter to SSX to reduce data + rate limits.
 * - Tries multiple filter property names in order.
 * - Tries both array and wrapped body formats.
 * - Logs the exact property name and endpoint that worked.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  corsHeaders,
  buildSsxUrlCandidates,
  readAccountConfig,
  extractResponseItems,
  ssxPost,
  logIntegration,
  logSsxCall,
  getTenantRole,
  classifyError,
  type SsxErrorClass,
} from "../_shared/ssx-utils.ts";

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

    // Fetch integration account
    const { data: account, error: accErr } = await supabase
      .from("integration_accounts").select("*").eq("id", integration_account_id).single();
    if (accErr || !account) {
      return jsonResp({ error: "Integration account not found" }, 404);
    }

    // Auth check
    if (!isCron && callerId) {
      const memberRole = await getTenantRole(supabase, account.tenant_id, callerId);
      if (!memberRole || !["owner", "admin"].includes(memberRole)) {
        return jsonResp({ error: "Forbidden: admin role required" }, 403);
      }
    }

    const config = readAccountConfig(account);

    // Token check
    if (!config.token || !account.token_expires_at) {
      return jsonResp({ error: "No token cached. Run ssx-login first." }, 400);
    }
    if (new Date(account.token_expires_at).getTime() < Date.now()) {
      return jsonResp({ error: "Token expired. Run ssx-login first." }, 400);
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

    // Get vehicle_tracker_links
    const unitIds = units.map((u: any) => u.id);
    const { data: links } = await supabase
      .from("vehicle_tracker_links").select("*")
      .in("provider_unit_id", unitIds).eq("active", true);

    const unitToVehicle: Record<string, { vehicle_id: string; tenant_id: string }> = {};
    for (const link of links || []) {
      unitToVehicle[link.provider_unit_id] = { vehicle_id: link.vehicle_id, tenant_id: link.tenant_id };
    }

    // Build position URL candidates using centralized builder
    const positionUrls = buildSsxUrlCandidates(config.baseUrl, config.apiVersion, "/Tracking/PositionHistory/List");
    const defaultPollWindow = config.pollWindowMinutes;

    // Filter property candidates — swagger-aligned order (TrackedUnitIntegrationCode first)
    const filterPropertyCandidates = [
      config.settings.filter_property, // explicitly configured first
      "TrackedUnitIntegrationCode",    // swagger-documented property
      "TrackedUnit",
      "TrackerIntegrationCode",
      "IntegrationCode",
    ].filter(Boolean) as string[];
    // Deduplicate
    const uniqueFilterProps = [...new Set(filterPropertyCandidates)];

    // Time filter property — swagger shows EventDate, not DateTimeGPS
    const timeFilterProp = config.settings.time_filter_property || "EventDate";
    const timeFilterPropAlt = "DateTimeGPS"; // legacy fallback

    const results: any[] = [];
    let totalInserted = 0;
    let totalDuplicates = 0;
    const touchedVehicles: { tenant_id: string; vehicle_id: string; captured_at: string }[] = [];

    // Track which property + URL + format worked (memoize for subsequent units)
    let workingProperty: string | null = null;
    let workingUrl: string | null = null;
    let workingFormat: "array" | "wrapped" | null = null;

    for (const unit of units) {
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
      const pollWindowMinutes = isFirstPoll ? 1440 : defaultPollWindow;

      // Derive time window start from cursor or poll window
      const timeStart = cursor?.last_success_at
        ? new Date(new Date(cursor.last_success_at).getTime() - 2 * 60_000).toISOString() // 2min overlap
        : new Date(Date.now() - pollWindowMinutes * 60_000).toISOString();

      // Try to find working combination
      let resp: any = null;
      let usedProperty = workingProperty;
      let usedUrl = workingUrl;
      let usedFormat = workingFormat;

      if (workingProperty && workingUrl && workingFormat) {
        // Use memoized combination — swagger-aligned "=" condition
        const filters = [
          { PropertyName: workingProperty, Condition: "=", Value: unit.external_code },
          { PropertyName: timeFilterProp, Condition: ">=", Value: timeStart },
        ];
        const body = workingFormat === "array" ? filters : { Filters: filters };
        resp = await ssxPost(workingUrl, config.token, body, config.requestTimeoutMs);

        logSsxCall({
          routine: "poll-positions", endpoint: workingUrl, method: "POST",
          apiVersion: config.apiVersion, attemptType: `memo:${workingProperty}:${workingFormat}`,
          statusCode: resp.status, durationMs: resp.durationMs,
          responsePreview: (resp.text || "").substring(0, 150),
          result: resp.ok ? "success" : "error", errorClass: resp.errorClass,
        });

        // If memo failed, clear and fall through to discovery
        if (!resp.ok) {
          resp = null;
          workingProperty = null;
          workingUrl = null;
          workingFormat = null;
        }
      }

      // Discovery: try all property × URL × format combinations
      if (!resp || !resp.ok) {
        let found = false;
        for (const prop of uniqueFilterProps) {
          if (found) break;
          for (const url of positionUrls) {
            if (found) break;
            const filters = [
              { PropertyName: prop, Condition: "=", Value: unit.external_code },
              { PropertyName: timeFilterProp, Condition: ">=", Value: timeStart },
            ];

            // Try array format
            resp = await ssxPost(url, config.token, filters, config.requestTimeoutMs);
            logSsxCall({
              routine: "poll-positions", endpoint: url, method: "POST",
              apiVersion: config.apiVersion, attemptType: `discover:${prop}:array`,
              statusCode: resp.status, durationMs: resp.durationMs,
              responsePreview: (resp.text || "").substring(0, 150),
              result: resp.ok ? "success" : "error", errorClass: resp.errorClass,
            });

            if (resp.ok) {
              usedProperty = prop;
              usedUrl = url;
              usedFormat = "array";
              workingProperty = prop;
              workingUrl = url;
              workingFormat = "array";
              found = true;
              break;
            }

            if (resp.status === 400 || resp.status === 415) {
              // Try wrapped format
              resp = await ssxPost(url, config.token, { Filters: filters }, config.requestTimeoutMs);
              logSsxCall({
                routine: "poll-positions", endpoint: url, method: "POST",
                apiVersion: config.apiVersion, attemptType: `discover:${prop}:wrapped`,
                statusCode: resp.status, durationMs: resp.durationMs,
                responsePreview: (resp.text || "").substring(0, 150),
                result: resp.ok ? "success" : "error", errorClass: resp.errorClass,
              });

              if (resp.ok) {
                usedProperty = prop;
                usedUrl = url;
                usedFormat = "wrapped";
                workingProperty = prop;
                workingUrl = url;
                workingFormat = "wrapped";
                found = true;
                break;
              }
            }

            // If 404, try next URL
            if (resp.errorClass === "route_not_found") continue;
            // If auth error, stop trying this property
            if (resp.errorClass === "auth_error") break;
          }
        }
      }

      if (!resp || resp.networkError) {
        const errMsg = resp?.networkError || "No working endpoint found";
        const backoffUntil = new Date(Date.now() + 60000).toISOString();
        await upsertCursor(supabase, {
          tenant_id: mapping.tenant_id, provider_unit_id: unit.id,
          last_polled_at: now.toISOString(), last_error_at: now.toISOString(),
          last_error: errMsg, backoff_until: backoffUntil,
        });
        results.push({ unit_code: unit.external_code, status: "error", error: errMsg, error_class: resp?.errorClass || "network_error" });
        continue;
      }

      if (!resp.ok) {
        await upsertCursor(supabase, {
          tenant_id: mapping.tenant_id, provider_unit_id: unit.id,
          last_polled_at: now.toISOString(), last_error_at: now.toISOString(),
          last_error: `HTTP ${resp.status}: ${resp.text.substring(0, 200)}`,
          backoff_until: new Date(Date.now() + 60000).toISOString(),
        });

        await logIntegration(supabase, {
          tenant_id: mapping.tenant_id, integration_account_id,
          action: "ssx_poll_positions", endpoint: usedUrl || positionUrls[0],
          status_code: resp.status, success: false,
          error_message: resp.text.substring(0, 500),
          duration_ms: resp.durationMs,
          metadata: {
            unit_code: unit.external_code, error_class: resp.errorClass,
            filter_property: usedProperty, body_format: usedFormat,
          },
        });

        results.push({ unit_code: unit.external_code, status: "error", http_status: resp.status, error_class: resp.errorClass });
        continue;
      }

      const positions = extractResponseItems(resp.parsed);
      let inserted = 0;
      let duplicates = 0;
      let latestPoint: any = null;

      for (const point of positions) {
        const normalized = normalizePosition(point);
        if (!normalized) continue;

        const pointAge = (Date.now() - new Date(normalized.captured_at).getTime()) / 60000;
        if (pointAge > pollWindowMinutes) continue;

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

      // Update cursor
      const cursorUpdate: any = {
        tenant_id: mapping.tenant_id, provider_unit_id: unit.id,
        last_polled_at: now.toISOString(), last_error: null, backoff_until: null,
      };
      if (inserted > 0) cursorUpdate.last_success_at = now.toISOString();
      await upsertCursor(supabase, cursorUpdate);

      await logIntegration(supabase, {
        tenant_id: mapping.tenant_id, integration_account_id,
        action: "ssx_poll_positions", endpoint: usedUrl || positionUrls[0],
        status_code: 200, success: true, duration_ms: resp.durationMs,
        metadata: {
          unit_code: unit.external_code, points_received: positions.length,
          inserted, duplicates,
          filter_property: usedProperty, body_format: usedFormat,
          time_window_start: timeStart,
          endpoint_used: usedUrl,
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
        points_received: positions.length, inserted, duplicates,
        filter_property: usedProperty, body_format: usedFormat,
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
      success: true, total_units: units.length,
      total_inserted: totalInserted, total_duplicates: totalDuplicates,
      touched_vehicles: touchedVehicles.length,
      working_filter_property: workingProperty,
      working_endpoint: workingUrl,
      working_format: workingFormat,
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
  const dateStr = point.DateTimeGPS ?? point.DateTimeServer ?? point.DateTime ??
    point.dateTimeGPS ?? point.dateTimeServer ?? point.dateTime ??
    point.Date ?? point.date ?? point.Timestamp ?? point.timestamp;

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
    "DateTimeGPS", "DateTimeServer", "DateTime",
    "dateTimeGPS", "dateTimeServer", "dateTime",
    "Date", "date", "Timestamp", "timestamp",
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

function jsonResp(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
