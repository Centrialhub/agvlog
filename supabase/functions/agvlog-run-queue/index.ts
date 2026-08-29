import { createClient } from "@supabase/supabase-js";
import { isCronRequest } from "../_shared/cron-auth.ts";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    let callerId: string | null = null;

    // Auth: JWT or cron secret
    const isCron = await isCronRequest(req, supabaseUrl, serviceKey);

    if (!isCron) {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const anonClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(
        authHeader.replace("Bearer ", "")
      );
      if (claimsError || !claimsData?.claims) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      callerId = claimsData.claims.sub as string;
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const { tenant_id, limit: maxItems } = await req.json();

    if (!tenant_id) {
      return new Response(JSON.stringify({ error: "tenant_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify admin (skip for cron)
    if (!isCron && callerId) {
      const { data: membership } = await supabase
        .from("tenant_memberships").select("role")
        .eq("tenant_id", tenant_id).eq("user_id", callerId).eq("active", true)
        .limit(1).single();
      if (!membership || !["owner", "admin"].includes(membership.role)) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const batchLimit = Math.min(maxItems || 20, 50);

    // Fetch unprocessed items, skip backoff (attempts >= 5 and recent error)
    const { data: queue, error: qErr } = await supabase
      .from("vehicle_processing_queue")
      .select("*")
      .eq("tenant_id", tenant_id)
      .is("processed_at", null)
      .order("queued_at", { ascending: true })
      .limit(batchLimit);

    if (qErr || !queue || queue.length === 0) {
      return new Response(
        JSON.stringify({ success: true, processed: 0, message: "Queue empty" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch tenant settings & timezone
    const { data: tenant } = await supabase
      .from("tenants").select("settings, timezone").eq("id", tenant_id).single();
    const settings = (tenant?.settings as any) || {};
    const tenantTimezone = tenant?.timezone || "America/Sao_Paulo";

    // Pre-load telemetry mapping for this tenant (once)
    const { data: telemetryMappings } = await supabase
      .from("telemetry_mapping").select("telemetry_id, canonical_key, transform")
      .eq("tenant_id", tenant_id);
    const mappingMap = new Map<string, string>();
    if (telemetryMappings) {
      for (const m of telemetryMappings) {
        mappingMap.set(m.telemetry_id, m.canonical_key);
      }
    }

    // Pre-load route templates
    const { data: routeTemplates } = await supabase
      .from("route_templates").select("*")
      .eq("tenant_id", tenant_id).eq("enabled", true);

    let processed = 0;
    let errors = 0;
    const stats = {
      positions_analyzed: 0,
      trips_created: 0,
      stops_created: 0,
      events_created: 0,
      alerts_opened: 0,
      alerts_closed: 0,
      geofence_events_created: 0,
      fuel_readings_created: 0,
      fuel_events_created: 0,
      route_runs_created: 0,
    };

    for (const item of queue) {
      if (item.attempts >= 5) continue;

      try {
        const result = await processVehicle(supabase, tenant_id, item.vehicle_id, settings, tenantTimezone, mappingMap, routeTemplates || []);

        stats.positions_analyzed += result.positions_analyzed || 0;
        stats.trips_created += result.trips_created || 0;
        stats.stops_created += result.stops_created || 0;
        stats.events_created += result.events_created || 0;
        stats.alerts_opened += result.alerts_opened || 0;
        stats.alerts_closed += result.alerts_closed || 0;
        stats.geofence_events_created += result.geofence_events_created || 0;
        stats.fuel_readings_created += result.fuel_readings_created || 0;
        stats.fuel_events_created += result.fuel_events_created || 0;
        stats.route_runs_created += result.route_runs_created || 0;

        await supabase.from("vehicle_processing_queue").update({
          processed_at: new Date().toISOString(),
          attempts: item.attempts + 1,
          last_error: null,
        }).eq("tenant_id", tenant_id).eq("vehicle_id", item.vehicle_id);

        processed++;
      } catch (e: any) {
        console.error(`Process error for vehicle ${item.vehicle_id}:`, e);
        await supabase.from("vehicle_processing_queue").update({
          attempts: item.attempts + 1,
          last_error: e.message?.substring(0, 500),
        }).eq("tenant_id", tenant_id).eq("vehicle_id", item.vehicle_id);
        errors++;
      }
    }

    return new Response(
      JSON.stringify({ success: true, processed, errors, stats }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("agvlog-run-queue error:", err);
    return new Response(
      JSON.stringify({ error: "Internal error", details: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ============ VEHICLE PROCESSOR (idempotent) ============

async function processVehicle(
  supabase: any,
  tenantId: string,
  vehicleId: string,
  tenantSettings: any,
  tenantTimezone: string,
  mappingMap: Map<string, string>,
  routeTemplates: any[]
) {
  // Load vehicle config
  const { data: vehicleData } = await supabase
    .from("vehicles").select("speed_limit_kmh, fuel_canonical_key, tank_capacity_liters")
    .eq("id", vehicleId).single();

  const overspeedLimit = vehicleData?.speed_limit_kmh || tenantSettings.overspeed_limit_kmh || 80;
  const longStopThresholdMin = tenantSettings.long_stop_threshold_minutes || 40;

  // Night window from tenant settings
  const nightStart = tenantSettings.night_start_hour ?? 21;
  const nightEnd = tenantSettings.night_end_hour ?? 5;

  // Determine processing window (last 24h with 30min overlap)
  const windowTo = new Date().toISOString();
  const windowFrom = new Date(Date.now() - 24 * 3600 * 1000 - 30 * 60 * 1000).toISOString();

  // Fetch positions
  const { data: positions, error: posErr } = await supabase
    .from("positions_raw")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("vehicle_id", vehicleId)
    .gte("captured_at", windowFrom)
    .lte("captured_at", windowTo)
    .order("captured_at", { ascending: true })
    .limit(5000);

  if (posErr) throw posErr;
  if (!positions || positions.length === 0) {
    return { positions_analyzed: 0 };
  }

  const result: any = {
    positions_analyzed: positions.length,
    trips_created: 0,
    stops_created: 0,
    events_created: 0,
    alerts_opened: 0,
    alerts_closed: 0,
    geofence_events_created: 0,
    fuel_readings_created: 0,
    fuel_events_created: 0,
    route_runs_created: 0,
  };

  // IDEMPOTENT: Delete engine-generated data in window before recreating
  await supabase.from("trips")
    .delete()
    .eq("tenant_id", tenantId).eq("vehicle_id", vehicleId)
    .gte("start_at", windowFrom).lte("start_at", windowTo);

  await supabase.from("trip_stops")
    .delete()
    .eq("tenant_id", tenantId).eq("vehicle_id", vehicleId)
    .gte("start_at", windowFrom).lte("start_at", windowTo);

  await supabase.from("events")
    .delete()
    .eq("tenant_id", tenantId).eq("vehicle_id", vehicleId)
    .eq("source", "engine")
    .gte("event_at", windowFrom).lte("event_at", windowTo);

  // 1) Classify movement
  const classified = classifyMovement(positions);

  // 2) Extract canonical signals for each point
  const canonicalByIndex: Record<string, number>[] = [];
  for (const p of classified) {
    canonicalByIndex.push(extractCanonicalSignals(p.telemetry, mappingMap));
  }

  // 3) Detect trips
  const trips = detectTrips(classified);
  for (const trip of trips) {
    const distance = computeTripDistance(trip.points);
    const movingTime = computeMovingTime(trip.points);

    const { data: tripData, error: tripErr } = await supabase.from("trips").insert({
      tenant_id: tenantId, vehicle_id: vehicleId,
      start_at: trip.start, end_at: trip.end,
      distance_km_estimated: Math.round(distance * 100) / 100,
      moving_time_seconds: movingTime,
      stopped_time_seconds: trip.stoppedTime,
      detection_mode: "basic", confidence_score: 0.6,
    }).select("id").single();

    if (!tripErr) {
      result.trips_created++;
      trip.id = tripData?.id;
    }
  }

  // 4) Detect stops V2 (with merge + overnight classification)
  const stops = detectStopsV2(classified, nightStart, nightEnd, tenantTimezone);
  for (const stop of stops) {
    let tripId = null;
    for (const trip of trips) {
      if (trip.id && stop.start >= trip.start && stop.start <= trip.end) {
        tripId = trip.id;
        break;
      }
    }

    const { error: stopErr } = await supabase.from("trip_stops").insert({
      tenant_id: tenantId, vehicle_id: vehicleId,
      lat: stop.lat, lng: stop.lng,
      start_at: stop.start, end_at: stop.end,
      duration_seconds: Math.round(stop.duration),
      stop_class: stop.stopClass, trip_id: tripId,
    });
    if (!stopErr) result.stops_created++;

    // Overnight stop event
    if (stop.stopClass === "overnight") {
      await supabase.from("events").insert({
        tenant_id: tenantId, vehicle_id: vehicleId,
        event_type: "overnight_stop", severity: "info", source: "engine",
        event_at: stop.start,
        payload: {
          duration_minutes: Math.round(stop.duration / 60),
          lat: stop.lat, lng: stop.lng,
          start: stop.start, end: stop.end,
        },
      });
      result.events_created++;
    }
  }

  // 5) Overspeed SESSIONS
  const overspeedSessions = detectOverspeedSessions(classified, overspeedLimit);
  for (const session of overspeedSessions) {
    const { error: evErr } = await supabase.from("events").insert({
      tenant_id: tenantId, vehicle_id: vehicleId,
      event_type: "overspeed", severity: "warning", source: "engine",
      event_at: session.start_at,
      payload: {
        start_at: session.start_at, end_at: session.end_at,
        max_speed: session.max_speed, avg_speed: session.avg_speed,
        count_points: session.count_points,
      },
    });
    if (!evErr) result.events_created++;
  }

  // 6) Harsh accel/brake detection
  for (let i = 1; i < classified.length; i++) {
    const p = classified[i];
    const prev = classified[i - 1];
    if (p.speed == null || prev.speed == null) continue;
    const dt = (new Date(p.captured_at).getTime() - new Date(prev.captured_at).getTime()) / 1000;
    if (dt <= 0 || dt > 30) continue;
    const deltaSpeed = p.speed - prev.speed;
    if (Math.abs(deltaSpeed) >= 20) {
      const evType = deltaSpeed > 0 ? "harsh_accel" : "harsh_brake";
      await supabase.from("events").insert({
        tenant_id: tenantId, vehicle_id: vehicleId,
        event_type: evType, severity: "warning", source: "engine",
        event_at: p.captured_at,
        payload: { delta_speed: Math.round(deltaSpeed * 10) / 10, delta_t: Math.round(dt), speed: p.speed },
      });
      result.events_created++;
    }
  }

  // 7) Long stop events
  for (const stop of stops) {
    if (stop.duration / 60 > longStopThresholdMin && stop.stopClass !== "overnight") {
      await supabase.from("events").insert({
        tenant_id: tenantId, vehicle_id: vehicleId,
        event_type: "long_stop", severity: "info", source: "engine",
        event_at: stop.start,
        payload: {
          duration_minutes: Math.round(stop.duration / 60),
          lat: stop.lat, lng: stop.lng, start: stop.start, end: stop.end,
        },
      });
      result.events_created++;
    }
  }

  // 8) Fuel processing (only if canonical fuel exists)
  const fuelKey = vehicleData?.fuel_canonical_key || "fuel_level_percent";
  const hasFuel = canonicalByIndex.some(c => c[fuelKey] !== undefined);
  if (hasFuel) {
    const fuelResult = await processFuel(
      supabase, tenantId, vehicleId, classified, canonicalByIndex, fuelKey,
      vehicleData?.tank_capacity_liters || null
    );
    result.fuel_readings_created += fuelResult.readingsCreated;
    result.fuel_events_created += fuelResult.eventsCreated;
    result.events_created += fuelResult.eventsCreated;
  }

  // 9) Offline check
  const { data: lastPos } = await supabase
    .from("positions_last")
    .select("captured_at")
    .eq("tenant_id", tenantId).eq("vehicle_id", vehicleId)
    .maybeSingle();

  const ageMin = lastPos
    ? (Date.now() - new Date(lastPos.captured_at).getTime()) / 60000
    : null;

  // 10) Alert engine
  const { data: alertRules } = await supabase
    .from("alert_rules")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("enabled", true);

  if (alertRules && alertRules.length > 0) {
    for (const rule of alertRules) {
      const params = rule.params as any || {};

      if (rule.rule_type === "offline") {
        const threshold = params.threshold_minutes || 15;
        const { data: existingOpen } = await supabase
          .from("alert_instances").select("id")
          .eq("tenant_id", tenantId).eq("vehicle_id", vehicleId)
          .eq("rule_id", rule.id).eq("source", "engine")
          .in("status", ["open", "ack"]).limit(1);

        if (ageMin != null && ageMin > threshold) {
          if (!existingOpen || existingOpen.length === 0) {
            await supabase.from("alert_instances").insert({
              tenant_id: tenantId, vehicle_id: vehicleId,
              rule_id: rule.id, status: "open", source: "engine",
              opened_at: new Date().toISOString(),
            });
            result.alerts_opened++;
          }
        } else {
          if (existingOpen && existingOpen.length > 0) {
            await supabase.from("alert_instances")
              .update({ status: "closed", closed_at: new Date().toISOString() })
              .eq("id", existingOpen[0].id);
            result.alerts_closed++;
          }
        }
      }

      if (rule.rule_type === "overspeed") {
        for (const session of overspeedSessions) {
          const recentThreshold = new Date(Date.now() - 30 * 60 * 1000).toISOString();
          const { data: recentAlert } = await supabase
            .from("alert_instances").select("id")
            .eq("tenant_id", tenantId).eq("vehicle_id", vehicleId)
            .eq("rule_id", rule.id).eq("source", "engine")
            .gte("opened_at", recentThreshold).limit(1);

          if (!recentAlert || recentAlert.length === 0) {
            await supabase.from("alert_instances").insert({
              tenant_id: tenantId, vehicle_id: vehicleId,
              rule_id: rule.id, status: "open", source: "engine",
              opened_at: session.start_at,
            });
            result.alerts_opened++;
          }
        }
      }

      if (rule.rule_type === "long_stop") {
        const threshold = params.threshold_minutes || 120;
        for (const stop of stops) {
          if (stop.duration / 60 > threshold) {
            const { data: existing } = await supabase
              .from("alert_instances").select("id, status")
              .eq("tenant_id", tenantId).eq("vehicle_id", vehicleId)
              .eq("rule_id", rule.id).eq("source", "engine")
              .in("status", ["open", "ack"]).limit(1);

            if (!existing || existing.length === 0) {
              await supabase.from("alert_instances").insert({
                tenant_id: tenantId, vehicle_id: vehicleId,
                rule_id: rule.id, status: "open", source: "engine",
                opened_at: stop.start,
              });
              result.alerts_opened++;
            } else if (stop.end) {
              await supabase.from("alert_instances")
                .update({ status: "closed", closed_at: stop.end })
                .eq("id", existing[0].id);
              result.alerts_closed++;
            }
          }
        }
      }

      if (rule.rule_type === "overnight") {
        for (const stop of stops) {
          if (stop.stopClass === "overnight") {
            const { data: existing } = await supabase
              .from("alert_instances").select("id")
              .eq("tenant_id", tenantId).eq("vehicle_id", vehicleId)
              .eq("rule_id", rule.id).eq("source", "engine")
              .in("status", ["open", "ack"]).limit(1);

            if (!existing || existing.length === 0) {
              await supabase.from("alert_instances").insert({
                tenant_id: tenantId, vehicle_id: vehicleId,
                rule_id: rule.id, status: "open", source: "engine",
                opened_at: stop.start,
              });
              result.alerts_opened++;
            }
          }
        }
      }

      if (rule.rule_type === "fuel_drain") {
        // handled by fuel processing inserting events
      }

      if (rule.rule_type === "route_deviation") {
        // handled below
      }
    }
  }

  // 11) Geofence checks
  if (positions.length > 0) {
    const lastPoint = positions[positions.length - 1];
    try {
      const geoResult = await checkGeofences(supabase, tenantId, vehicleId, lastPoint, alertRules || []);
      result.geofence_events_created += geoResult;
    } catch (e) {
      console.log("Geofence check error:", e);
    }
  }

  // 12) Route matching
  if (routeTemplates.length > 0 && trips.length > 0) {
    for (const trip of trips) {
      if (!trip.id || !trip.points || trip.points.length < 5) continue;
      try {
        const routeResult = await matchRoute(supabase, tenantId, vehicleId, trip, routeTemplates, alertRules || []);
        if (routeResult) {
          result.route_runs_created++;
          if (routeResult.deviated) result.events_created++;
        }
      } catch (e) {
        console.log("Route matching error:", e);
      }
    }
  }

  // 13) POIs auto-detect
  await autoDetectPois(supabase, tenantId);

  // 14) Capability detection (enhanced with canonical signals)
  await detectCapabilities(supabase, tenantId, vehicleId, positions, mappingMap);

  // 15) Telemetry observations
  await updateTelemetryObservations(supabase, tenantId, vehicleId, positions);

  return result;
}

// ============ CANONICAL TELEMETRY ============

function extractCanonicalSignals(telemetry: any, mappingMap: Map<string, string>): Record<string, number> {
  const result: Record<string, number> = {};
  if (!telemetry) return result;

  // Handle SSX format: telemetry.Telemetry = [{Id, Value}, ...]
  if (telemetry.Telemetry && Array.isArray(telemetry.Telemetry)) {
    for (const item of telemetry.Telemetry) {
      const id = String(item.Id || item.id || "");
      const val = parseFloat(item.Value ?? item.value);
      if (!id || isNaN(val)) continue;
      const canonical = mappingMap.get(id);
      if (canonical) result[canonical] = val;
    }
  }

  // Flat keys (heuristic)
  for (const [key, val] of Object.entries(telemetry)) {
    if (key === "Telemetry") continue;
    const lk = key.toLowerCase();
    const numVal = parseFloat(String(val));
    if (isNaN(numVal)) continue;

    // Check mapping first
    const canonical = mappingMap.get(key);
    if (canonical) { result[canonical] = numVal; continue; }

    // Heuristic fallback
    if ((lk.includes("fuel") || lk.includes("combust")) && !result["fuel_level_percent"]) {
      result["fuel_level_percent"] = numVal;
    }
    if ((lk.includes("igni") || lk === "acc") && !result["ignition"]) {
      result["ignition"] = numVal;
    }
    if ((lk.includes("odom") || lk.includes("hodometro") || lk.includes("km_total")) && !result["odometer_km"]) {
      result["odometer_km"] = numVal;
    }
  }

  return result;
}

// ============ FUEL PROCESSING ============

async function processFuel(
  supabase: any, tenantId: string, vehicleId: string,
  points: ClassifiedPoint[], canonicals: Record<string, number>[],
  fuelKey: string, _tankCapacity: number | null
): Promise<{ readingsCreated: number; eventsCreated: number }> {
  let readingsCreated = 0;
  let eventsCreated = 0;
  let lastRecordedValue: number | null = null;
  let lastRecordedTime = 0;

  const fuelUnit = fuelKey.includes("liters") ? "liters" : "percent";

  // Collect fuel points for event detection
  const fuelTimeline: { time: number; value: number; moving: boolean; captured_at: string; lat: number; lng: number }[] = [];

  for (let i = 0; i < points.length; i++) {
    const fuelVal = canonicals[i]?.[fuelKey];
    if (fuelVal === undefined) continue;

    const clamped = fuelUnit === "percent" ? Math.max(0, Math.min(100, fuelVal)) : Math.max(0, fuelVal);
    const timeMs = new Date(points[i].captured_at).getTime();

    fuelTimeline.push({
      time: timeMs, value: clamped, moving: points[i].moving,
      captured_at: points[i].captured_at, lat: points[i].lat, lng: points[i].lng,
    });

    // Downsample: first of day, delta >= 0.5, or >= 5min since last
    const shouldRecord =
      lastRecordedValue === null ||
      Math.abs(clamped - lastRecordedValue) >= 0.5 ||
      (timeMs - lastRecordedTime) >= 300000;

    if (shouldRecord) {
      await supabase.from("fuel_readings").upsert({
        tenant_id: tenantId, vehicle_id: vehicleId,
        captured_at: points[i].captured_at,
        fuel_value: clamped, fuel_unit: fuelUnit,
        source_key: fuelKey,
      }, { onConflict: "tenant_id,vehicle_id,captured_at" });
      readingsCreated++;
      lastRecordedValue = clamped;
      lastRecordedTime = timeMs;
    }
  }

  // Detect refuel/drain events
  const THRESHOLD = 8; // 8% or 8 liters
  const WINDOW_MS = 10 * 60 * 1000; // 10 minutes

  for (let i = 1; i < fuelTimeline.length; i++) {
    const dt = fuelTimeline[i].time - fuelTimeline[i - 1].time;
    if (dt > WINDOW_MS) continue;
    const delta = fuelTimeline[i].value - fuelTimeline[i - 1].value;

    if (delta >= THRESHOLD) {
      // Refuel
      await supabase.from("fuel_events").upsert({
        tenant_id: tenantId, vehicle_id: vehicleId,
        event_type: "refuel", event_at: fuelTimeline[i].captured_at,
        delta, start_value: fuelTimeline[i - 1].value, end_value: fuelTimeline[i].value,
        payload: { lat: fuelTimeline[i].lat, lng: fuelTimeline[i].lng },
      }, { onConflict: "tenant_id,vehicle_id,event_type,event_at" });

      await supabase.from("events").insert({
        tenant_id: tenantId, vehicle_id: vehicleId,
        event_type: "fuel_refuel", severity: "info", source: "engine",
        event_at: fuelTimeline[i].captured_at,
        payload: { delta, start_value: fuelTimeline[i - 1].value, end_value: fuelTimeline[i].value },
      });
      eventsCreated++;
    } else if (delta <= -THRESHOLD) {
      // Drain
      await supabase.from("fuel_events").upsert({
        tenant_id: tenantId, vehicle_id: vehicleId,
        event_type: "drain", event_at: fuelTimeline[i].captured_at,
        delta, start_value: fuelTimeline[i - 1].value, end_value: fuelTimeline[i].value,
        payload: { lat: fuelTimeline[i].lat, lng: fuelTimeline[i].lng },
      }, { onConflict: "tenant_id,vehicle_id,event_type,event_at" });

      await supabase.from("events").insert({
        tenant_id: tenantId, vehicle_id: vehicleId,
        event_type: "fuel_drain", severity: "critical", source: "engine",
        event_at: fuelTimeline[i].captured_at,
        payload: { delta, start_value: fuelTimeline[i - 1].value, end_value: fuelTimeline[i].value },
      });
      eventsCreated++;
    }
  }

  return { readingsCreated, eventsCreated };
}

// ============ ROUTE MATCHING ============

async function matchRoute(
  supabase: any, tenantId: string, vehicleId: string,
  trip: any, routeTemplates: any[], alertRules: any[]
): Promise<{ deviated: boolean } | null> {
  let bestRoute: any = null;
  let bestRatio = 0;

  for (const route of routeTemplates) {
    if (!route.corridor_geofence_id) continue;

    // Sample points from trip (max 200)
    const sampleStep = Math.max(1, Math.floor(trip.points.length / 200));
    const sampled = trip.points.filter((_: any, idx: number) => idx % sampleStep === 0);

    const pointsJson = sampled.map((p: any) => ({ lat: p.lat, lng: p.lng }));

    const { data: countResult } = await supabase.rpc("count_points_in_geofence", {
      _geofence_id: route.corridor_geofence_id,
      _points: pointsJson,
    });

    if (!countResult) continue;
    const total = countResult.total || 1;
    const inside = countResult.inside || 0;
    const ratio = inside / total;

    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestRoute = route;
    }
  }

  if (!bestRoute || bestRatio < 0.3) return null;

  const threshold = bestRoute.corridor_inside_ratio_threshold || 0.85;
  const outsideRatio = 1 - bestRatio;
  const tripDurationMin = (new Date(trip.end).getTime() - new Date(trip.start).getTime()) / 60000;
  const outsideMinutes = Math.round(outsideRatio * tripDurationMin);
  const deviated = bestRatio < threshold || outsideMinutes > (bestRoute.allowed_outside_minutes || 5);
  const status = deviated ? "deviated" : "ok";

  await supabase.from("route_runs").upsert({
    tenant_id: tenantId, vehicle_id: vehicleId,
    trip_id: trip.id, route_id: bestRoute.id,
    inside_ratio: Math.round(bestRatio * 1000) / 1000,
    outside_minutes: outsideMinutes,
    status,
  }, { onConflict: "tenant_id,trip_id,route_id" });

  if (deviated) {
    await supabase.from("events").insert({
      tenant_id: tenantId, vehicle_id: vehicleId,
      event_type: "route_deviation", severity: "warning", source: "engine",
      event_at: trip.start,
      payload: {
        route_id: bestRoute.id, route_name: bestRoute.name,
        inside_ratio: bestRatio, outside_minutes: outsideMinutes,
      },
    });

    // Check for route_deviation alert rule
    for (const rule of alertRules) {
      if (rule.rule_type === "route_deviation" && rule.enabled) {
        await supabase.from("alert_instances").insert({
          tenant_id: tenantId, vehicle_id: vehicleId,
          rule_id: rule.id, status: "open", source: "engine",
          opened_at: trip.start,
        });
      }
    }
  }

  return { deviated };
}

// ============ HELPERS ============

interface ClassifiedPoint {
  lat: number; lng: number; speed: number | null;
  captured_at: string; moving: boolean; telemetry: any;
}

function classifyMovement(positions: any[]): ClassifiedPoint[] {
  return positions.map((p, i) => {
    let moving = false;
    if (p.speed != null) {
      moving = p.speed > 2;
    } else if (i > 0) {
      const prev = positions[i - 1];
      const dist = haversine(prev.lat, prev.lng, p.lat, p.lng);
      const timeDiff = (new Date(p.captured_at).getTime() - new Date(prev.captured_at).getTime()) / 1000;
      if (timeDiff > 0) moving = (dist / timeDiff) * 3.6 > 3;
    }
    return { lat: p.lat, lng: p.lng, speed: p.speed, captured_at: p.captured_at, moving, telemetry: p.telemetry || {} };
  });
}

function detectTrips(points: ClassifiedPoint[]): any[] {
  const trips: any[] = [];
  let tripStart: number | null = null;
  let consecutiveMoving = 0;
  let consecutiveStopped = 0;
  let stoppedTime = 0;
  const MOVE_THRESHOLD = 180;
  const STOP_THRESHOLD = 1800;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const prevTime = i > 0 ? new Date(points[i - 1].captured_at).getTime() : 0;
    const curTime = new Date(p.captured_at).getTime();
    const delta = i > 0 ? (curTime - prevTime) / 1000 : 0;

    if (p.moving) {
      consecutiveMoving += delta;
      if (consecutiveStopped > 0 && tripStart !== null) stoppedTime += consecutiveStopped;
      consecutiveStopped = 0;
      if (tripStart === null && consecutiveMoving >= MOVE_THRESHOLD) {
        tripStart = Math.max(0, i - Math.ceil(MOVE_THRESHOLD / (delta || 30)));
      }
    } else {
      consecutiveStopped += delta;
      consecutiveMoving = 0;
      if (tripStart !== null && consecutiveStopped >= STOP_THRESHOLD) {
        trips.push({
          start: points[tripStart].captured_at, end: points[i].captured_at,
          points: points.slice(tripStart, i + 1), stoppedTime: Math.round(stoppedTime),
        });
        tripStart = null; stoppedTime = 0; consecutiveStopped = 0;
      }
    }
  }
  if (tripStart !== null) {
    trips.push({
      start: points[tripStart].captured_at, end: points[points.length - 1].captured_at,
      points: points.slice(tripStart), stoppedTime: Math.round(stoppedTime),
    });
  }
  return trips;
}

// ============ STOPS V2 (with merge, overnight, better classification) ============

function detectStopsV2(
  points: ClassifiedPoint[],
  nightStartHour: number,
  nightEndHour: number,
  _timezone: string
): any[] {
  // Step 1: Detect raw stops (same as before but with radius check)
  const rawStops: any[] = [];
  let stopStart: number | null = null;

  for (let i = 0; i < points.length; i++) {
    if (!points[i].moving) {
      if (stopStart === null) stopStart = i;
    } else {
      if (stopStart !== null) {
        const duration = (new Date(points[i].captured_at).getTime() - new Date(points[stopStart].captured_at).getTime()) / 1000;
        if (duration >= 120) {
          const cnt = i - stopStart;
          const centerLat = points.slice(stopStart, i).reduce((s, p) => s + p.lat, 0) / cnt;
          const centerLng = points.slice(stopStart, i).reduce((s, p) => s + p.lng, 0) / cnt;
          rawStops.push({
            lat: Math.round(centerLat * 1e6) / 1e6, lng: Math.round(centerLng * 1e6) / 1e6,
            start: points[stopStart].captured_at, end: points[i - 1].captured_at, duration,
          });
        }
        stopStart = null;
      }
    }
  }
  if (stopStart !== null && stopStart < points.length - 1) {
    const last = points.length - 1;
    const duration = (new Date(points[last].captured_at).getTime() - new Date(points[stopStart].captured_at).getTime()) / 1000;
    if (duration >= 120) {
      const cnt = last - stopStart + 1;
      const centerLat = points.slice(stopStart, last + 1).reduce((s, p) => s + p.lat, 0) / cnt;
      const centerLng = points.slice(stopStart, last + 1).reduce((s, p) => s + p.lng, 0) / cnt;
      rawStops.push({
        lat: Math.round(centerLat * 1e6) / 1e6, lng: Math.round(centerLng * 1e6) / 1e6,
        start: points[stopStart].captured_at, end: points[last].captured_at, duration,
      });
    }
  }

  // Step 2: Merge nearby stops (<=120m and gap <=3min)
  const merged: any[] = [];
  for (const stop of rawStops) {
    if (merged.length > 0) {
      const prev = merged[merged.length - 1];
      const dist = haversine(prev.lat, prev.lng, stop.lat, stop.lng);
      const gap = (new Date(stop.start).getTime() - new Date(prev.end).getTime()) / 1000;
      if (dist <= 120 && gap <= 180) {
        // Merge
        prev.end = stop.end;
        prev.duration = (new Date(prev.end).getTime() - new Date(prev.start).getTime()) / 1000;
        prev.lat = (prev.lat + stop.lat) / 2;
        prev.lng = (prev.lng + stop.lng) / 2;
        continue;
      }
    }
    merged.push({ ...stop });
  }

  // Step 3: Classify
  for (const stop of merged) {
    const durationMin = stop.duration / 60;

    // Check if overlaps night window
    const startDate = new Date(stop.start);
    const startHour = startDate.getUTCHours() - 3; // Rough BRT offset
    const isNightOverlap = isInNightWindow(startHour, nightStartHour, nightEndHour);

    if (durationMin >= 240 || (durationMin >= 120 && isNightOverlap)) {
      stop.stopClass = "overnight";
    } else if (durationMin >= 40) {
      stop.stopClass = "long";
    } else if (durationMin >= 10) {
      stop.stopClass = "operational";
    } else {
      stop.stopClass = "short";
    }
  }

  return merged;
}

function isInNightWindow(hour: number, nightStart: number, nightEnd: number): boolean {
  const h = ((hour % 24) + 24) % 24;
  if (nightStart > nightEnd) {
    return h >= nightStart || h < nightEnd;
  }
  return h >= nightStart && h < nightEnd;
}

function detectOverspeedSessions(points: ClassifiedPoint[], limit: number) {
  const sessions: any[] = [];
  let inOverspeed = false;
  let sessionStart = "";
  let maxSpeed = 0;
  let sumSpeed = 0;
  let count = 0;

  for (const p of points) {
    const speed = p.speed || 0;
    if (speed > limit) {
      if (!inOverspeed) {
        inOverspeed = true;
        sessionStart = p.captured_at;
        maxSpeed = speed; sumSpeed = speed; count = 1;
      } else {
        if (speed > maxSpeed) maxSpeed = speed;
        sumSpeed += speed; count++;
      }
    } else {
      if (inOverspeed) {
        sessions.push({
          start_at: sessionStart, end_at: p.captured_at,
          max_speed: Math.round(maxSpeed * 10) / 10,
          avg_speed: Math.round((sumSpeed / count) * 10) / 10,
          count_points: count,
        });
        inOverspeed = false;
      }
    }
  }
  if (inOverspeed && count > 0) {
    sessions.push({
      start_at: sessionStart, end_at: points[points.length - 1].captured_at,
      max_speed: Math.round(maxSpeed * 10) / 10,
      avg_speed: Math.round((sumSpeed / count) * 10) / 10,
      count_points: count,
    });
  }
  return sessions;
}

function computeTripDistance(points: ClassifiedPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversine(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
  }
  return total / 1000;
}

function computeMovingTime(points: ClassifiedPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i].moving) {
      total += (new Date(points[i].captured_at).getTime() - new Date(points[i - 1].captured_at).getTime()) / 1000;
    }
  }
  return Math.round(total);
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function checkGeofences(
  supabase: any, tenantId: string, vehicleId: string,
  lastPoint: any, alertRules: any[]
): Promise<number> {
  const { data: geofences } = await supabase
    .from("geofences").select("id, name, geometry")
    .eq("tenant_id", tenantId).eq("enabled", true);

  if (!geofences || geofences.length === 0) return 0;

  let eventsCreated = 0;

  for (const geo of geofences) {
    const { data: insideResult } = await supabase.rpc("is_point_in_geofence", {
      _geofence_id: geo.id, _lng: lastPoint.lng, _lat: lastPoint.lat,
    }).single();

    if (insideResult === null || insideResult === undefined) continue;
    const isInside = !!insideResult;

    const { data: state } = await supabase
      .from("geofence_states").select("*")
      .eq("tenant_id", tenantId).eq("vehicle_id", vehicleId).eq("geofence_id", geo.id)
      .maybeSingle();

    const wasInside = state?.is_inside || false;

    if (isInside !== wasInside) {
      const direction = isInside ? "enter" : "exit";
      const eventType = isInside ? "geofence_enter" : "geofence_exit";

      await supabase.from("geofence_events").insert({
        tenant_id: tenantId, vehicle_id: vehicleId,
        geofence_id: geo.id, direction,
        event_at: lastPoint.captured_at,
        payload: { geofence_name: geo.name, lat: lastPoint.lat, lng: lastPoint.lng },
      });

      await supabase.from("events").insert({
        tenant_id: tenantId, vehicle_id: vehicleId,
        event_type: eventType, severity: "info", source: "engine",
        event_at: lastPoint.captured_at,
        payload: { geofence_id: geo.id, geofence_name: geo.name, direction },
      });

      eventsCreated += 2;

      for (const rule of alertRules) {
        if (rule.rule_type === "geofence" && rule.enabled) {
          const rp = rule.params as any || {};
          if (rp.geofence_id === geo.id && (!rp.direction || rp.direction === direction)) {
            await supabase.from("alert_instances").insert({
              tenant_id: tenantId, vehicle_id: vehicleId,
              rule_id: rule.id, status: "open", source: "engine",
              opened_at: lastPoint.captured_at,
            });
          }
        }
      }
    }

    await supabase.from("geofence_states").upsert({
      tenant_id: tenantId, vehicle_id: vehicleId, geofence_id: geo.id,
      is_inside: isInside,
      last_changed_at: isInside !== wasInside ? new Date().toISOString() : (state?.last_changed_at || new Date().toISOString()),
      last_checked_at: new Date().toISOString(),
    }, { onConflict: "tenant_id,vehicle_id,geofence_id" });
  }

  return eventsCreated;
}

async function autoDetectPois(supabase: any, tenantId: string) {
  const { data: recentStops } = await supabase
    .from("trip_stops")
    .select("lat, lng, vehicle_id")
    .eq("tenant_id", tenantId)
    .gte("start_at", new Date(Date.now() - 14 * 86400000).toISOString())
    .in("stop_class", ["operational", "long", "overnight"]);

  if (!recentStops || recentStops.length === 0) return;

  const clusters = clusterStops(recentStops, 80);
  for (const cluster of clusters) {
    if (cluster.count < 5) continue;
    const uniqueVehicles = new Set(cluster.vehicleIds);
    const category = uniqueVehicles.size >= 3 ? "base_candidate" : "client_candidate";
    const dedupeKey = `${Math.round(cluster.lat * 1e4)}|${Math.round(cluster.lng * 1e4)}`;

    await supabase.from("pois").upsert({
      tenant_id: tenantId, lat: cluster.lat, lng: cluster.lng,
      category, source: "auto", dedupe_key: dedupeKey,
      confidence_score: Math.min(0.9, 0.3 + cluster.count * 0.05),
      metadata: { stop_count: cluster.count, unique_vehicles: uniqueVehicles.size },
    }, { onConflict: "tenant_id,dedupe_key", ignoreDuplicates: false });
  }
}

function clusterStops(stops: any[], radiusM: number) {
  const clusters: any[] = [];
  const used = new Set<number>();
  for (let i = 0; i < stops.length; i++) {
    if (used.has(i)) continue;
    const cluster = { lat: stops[i].lat, lng: stops[i].lng, count: 1, vehicleIds: [stops[i].vehicle_id] };
    used.add(i);
    for (let j = i + 1; j < stops.length; j++) {
      if (used.has(j)) continue;
      if (haversine(cluster.lat, cluster.lng, stops[j].lat, stops[j].lng) <= radiusM) {
        cluster.count++; cluster.vehicleIds.push(stops[j].vehicle_id); used.add(j);
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}

async function detectCapabilities(supabase: any, tenantId: string, vehicleId: string, positions: any[], mappingMap: Map<string, string>) {
  const capabilities: Record<string, boolean> = {
    gps: true, speed: false, heading: false, ignition: false, odometer: false, fuel: false, temperature: false,
  };
  for (const p of positions) {
    if (p.speed != null) capabilities.speed = true;
    if (p.heading != null) capabilities.heading = true;
    const canonical = extractCanonicalSignals(p.telemetry || {}, mappingMap);
    if (canonical.ignition !== undefined) capabilities.ignition = true;
    if (canonical.odometer_km !== undefined) capabilities.odometer = true;
    if (canonical.fuel_level_percent !== undefined || canonical.fuel_liters !== undefined) capabilities.fuel = true;
    if (canonical.temperature_c !== undefined) capabilities.temperature = true;

    const tel = p.telemetry || {};
    for (const key of Object.keys(tel)) {
      const lk = key.toLowerCase();
      if (lk.includes("ignit") || lk.includes("ignicao") || lk === "acc") capabilities.ignition = true;
      if (lk.includes("odometer") || lk.includes("hodometro") || lk.includes("km")) capabilities.odometer = true;
      if (lk.includes("fuel") || lk.includes("combust")) capabilities.fuel = true;
    }
  }
  await supabase.from("vehicle_capabilities").upsert({
    tenant_id: tenantId, vehicle_id: vehicleId,
    capabilities, confidence_score: 0.8,
    last_detected_at: new Date().toISOString(),
  }, { onConflict: "vehicle_id" });
}

async function updateTelemetryObservations(supabase: any, tenantId: string, vehicleId: string, positions: any[]) {
  const telemetryKeys = new Set<string>();
  for (const p of positions) {
    const tel = p.telemetry || {};
    for (const key of Object.keys(tel)) telemetryKeys.add(key);
  }

  for (const key of telemetryKeys) {
    const { data: existing } = await supabase
      .from("telemetry_observations")
      .select("id, times_seen")
      .eq("tenant_id", tenantId).eq("vehicle_id", vehicleId).eq("canonical_key", key)
      .maybeSingle();

    if (existing) {
      await supabase.from("telemetry_observations")
        .update({ times_seen: existing.times_seen + 1, last_seen_at: new Date().toISOString() })
        .eq("id", existing.id);
    } else {
      await supabase.from("telemetry_observations").insert({
        tenant_id: tenantId, vehicle_id: vehicleId,
        canonical_key: key, times_seen: 1,
        first_seen_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
      });
    }
  }
}
