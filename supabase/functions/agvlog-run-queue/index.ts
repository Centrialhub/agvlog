import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-agvlog-cron-secret",
};

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
    const cronSecret = req.headers.get("x-agvlog-cron-secret");
    const expectedCronSecret = Deno.env.get("AGVLOG_CRON_SECRET");
    const isCron = cronSecret && expectedCronSecret && cronSecret === expectedCronSecret;

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

    // Fetch tenant settings
    const { data: tenant } = await supabase
      .from("tenants").select("settings, timezone").eq("id", tenant_id).single();
    const settings = (tenant?.settings as any) || {};

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
    };

    for (const item of queue) {
      // Skip if too many attempts
      if (item.attempts >= 5) {
        continue;
      }

      try {
        const result = await processVehicle(supabase, tenant_id, item.vehicle_id, settings);

        // Accumulate stats
        stats.positions_analyzed += result.positions_analyzed || 0;
        stats.trips_created += result.trips_created || 0;
        stats.stops_created += result.stops_created || 0;
        stats.events_created += result.events_created || 0;
        stats.alerts_opened += result.alerts_opened || 0;
        stats.alerts_closed += result.alerts_closed || 0;
        stats.geofence_events_created += result.geofence_events_created || 0;

        // Mark done
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
  tenantSettings: any
) {
  const offlineThresholdMin = tenantSettings.offline_threshold_minutes || 15;
  const overspeedLimit = tenantSettings.overspeed_limit_kmh || 80;
  const longStopThresholdMin = tenantSettings.long_stop_threshold_minutes || 40;

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

  // 2) Detect trips
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

  // 3) Detect stops with trip_id assignment
  const stops = detectStops(classified);
  for (const stop of stops) {
    const durationMin = stop.duration / 60;
    let stopClass = "short";
    if (durationMin >= 40) stopClass = "long";
    else if (durationMin >= 10) stopClass = "operational";

    // Try to assign trip_id
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
      stop_class: stopClass, trip_id: tripId,
    });
    if (!stopErr) result.stops_created++;
  }

  // 4) Overspeed SESSIONS (not per-point)
  const overspeedSessions = detectOverspeedSessions(classified, overspeedLimit);
  for (const session of overspeedSessions) {
    const dedupeKey = `overspeed|${vehicleId}|${session.start_at}`;
    const { error: evErr } = await supabase.from("events").insert({
      tenant_id: tenantId, vehicle_id: vehicleId,
      event_type: "overspeed", severity: "warning", source: "engine",
      event_at: session.start_at,
      payload: {
        start_at: session.start_at, end_at: session.end_at,
        max_speed: session.max_speed, avg_speed: session.avg_speed,
        count_points: session.count_points, dedupe_key: dedupeKey,
      },
    });
    if (!evErr) result.events_created++;
  }

  // 5) Long stop events
  for (const stop of stops) {
    if (stop.duration / 60 > longStopThresholdMin) {
      const { error: evErr } = await supabase.from("events").insert({
        tenant_id: tenantId, vehicle_id: vehicleId,
        event_type: "long_stop", severity: "info", source: "engine",
        event_at: stop.start,
        payload: {
          duration_minutes: Math.round(stop.duration / 60),
          lat: stop.lat, lng: stop.lng,
          start: stop.start, end: stop.end,
          dedupe_key: `long_stop|${vehicleId}|${stop.start}`,
        },
      });
      if (!evErr) result.events_created++;
    }
  }

  // 6) Offline check
  const { data: lastPos } = await supabase
    .from("positions_last")
    .select("captured_at")
    .eq("tenant_id", tenantId).eq("vehicle_id", vehicleId)
    .single();

  const ageMin = lastPos
    ? (Date.now() - new Date(lastPos.captured_at).getTime()) / 60000
    : null;

  // 7) Alert engine
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
          .from("alert_instances")
          .select("id")
          .eq("tenant_id", tenantId).eq("vehicle_id", vehicleId)
          .eq("rule_id", rule.id).eq("source", "engine")
          .in("status", ["open", "ack"])
          .limit(1);

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
          // Close if exists
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
          // Check if recent open alert exists for this rule+vehicle (last 30min)
          const recentThreshold = new Date(Date.now() - 30 * 60 * 1000).toISOString();
          const { data: recentAlert } = await supabase
            .from("alert_instances")
            .select("id")
            .eq("tenant_id", tenantId).eq("vehicle_id", vehicleId)
            .eq("rule_id", rule.id).eq("source", "engine")
            .gte("opened_at", recentThreshold)
            .limit(1);

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
            const dedupeKey = `${Math.round(stop.lat * 1e4)}|${Math.round(stop.lng * 1e4)}|${stop.start}`;
            const { data: existing } = await supabase
              .from("alert_instances")
              .select("id, status")
              .eq("tenant_id", tenantId).eq("vehicle_id", vehicleId)
              .eq("rule_id", rule.id).eq("source", "engine")
              .in("status", ["open", "ack"])
              .limit(1);

            if (!existing || existing.length === 0) {
              await supabase.from("alert_instances").insert({
                tenant_id: tenantId, vehicle_id: vehicleId,
                rule_id: rule.id, status: "open", source: "engine",
                opened_at: stop.start,
              });
              result.alerts_opened++;
            } else if (stop.end) {
              // Close if stop ended
              await supabase.from("alert_instances")
                .update({ status: "closed", closed_at: stop.end })
                .eq("id", existing[0].id);
              result.alerts_closed++;
            }
          }
        }
      }

      if (rule.rule_type === "geofence" && params.geofence_id) {
        // Handled below in geofence check
      }
    }
  }

  // 8) Geofence checks
  if (positions.length > 0) {
    const lastPoint = positions[positions.length - 1];
    try {
      const geoResult = await checkGeofences(supabase, tenantId, vehicleId, lastPoint, alertRules || []);
      result.geofence_events_created += geoResult;
    } catch (e) {
      console.log("Geofence check error:", e);
    }
  }

  // 9) POIs auto-detect (with dedupe)
  await autoDetectPois(supabase, tenantId);

  // 10) Capability detection
  await detectCapabilities(supabase, tenantId, vehicleId, positions);

  // 11) Telemetry observations (incremental)
  await updateTelemetryObservations(supabase, tenantId, vehicleId, positions);

  return result;
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

function detectStops(points: ClassifiedPoint[]): any[] {
  const stops: any[] = [];
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
          stops.push({
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
      stops.push({
        lat: Math.round(centerLat * 1e6) / 1e6, lng: Math.round(centerLng * 1e6) / 1e6,
        start: points[stopStart].captured_at, end: points[last].captured_at, duration,
      });
    }
  }
  return stops;
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
  // Get enabled geofences
  const { data: geofences } = await supabase
    .from("geofences").select("id, name, geometry")
    .eq("tenant_id", tenantId).eq("enabled", true);

  if (!geofences || geofences.length === 0) return 0;

  let eventsCreated = 0;

  for (const geo of geofences) {
    // Check if point is inside geofence using PostGIS
    const { data: insideResult } = await supabase.rpc("is_point_in_geofence", {
      _geofence_id: geo.id,
      _lng: lastPoint.lng,
      _lat: lastPoint.lat,
    }).single();

    // If RPC doesn't exist, skip
    if (insideResult === null || insideResult === undefined) continue;
    const isInside = !!insideResult;

    // Get current state
    const { data: state } = await supabase
      .from("geofence_states")
      .select("*")
      .eq("tenant_id", tenantId).eq("vehicle_id", vehicleId).eq("geofence_id", geo.id)
      .single();

    const wasInside = state?.is_inside || false;

    if (isInside !== wasInside) {
      const direction = isInside ? "enter" : "exit";
      const eventType = isInside ? "geofence_enter" : "geofence_exit";

      // Insert geofence_event
      await supabase.from("geofence_events").insert({
        tenant_id: tenantId, vehicle_id: vehicleId,
        geofence_id: geo.id, direction,
        event_at: lastPoint.captured_at,
        payload: { geofence_name: geo.name, lat: lastPoint.lat, lng: lastPoint.lng },
      });

      // Insert event
      await supabase.from("events").insert({
        tenant_id: tenantId, vehicle_id: vehicleId,
        event_type: eventType, severity: "info", source: "engine",
        event_at: lastPoint.captured_at,
        payload: { geofence_id: geo.id, geofence_name: geo.name, direction },
      });

      eventsCreated += 2;

      // Check geofence alert rules
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

    // Upsert state
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
    .in("stop_class", ["operational", "long"]);

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

async function detectCapabilities(supabase: any, tenantId: string, vehicleId: string, positions: any[]) {
  const capabilities: Record<string, boolean> = { gps: true, speed: false, heading: false, ignition: false, odometer: false };
  for (const p of positions) {
    if (p.speed != null) capabilities.speed = true;
    if (p.heading != null) capabilities.heading = true;
    const tel = p.telemetry || {};
    for (const key of Object.keys(tel)) {
      const lk = key.toLowerCase();
      if (lk.includes("ignit") || lk.includes("ignicao") || lk === "acc") capabilities.ignition = true;
      if (lk.includes("odometer") || lk.includes("hodometro") || lk.includes("km")) capabilities.odometer = true;
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
    // Try upsert then increment
    const { data: existing } = await supabase
      .from("telemetry_observations")
      .select("id, times_seen")
      .eq("tenant_id", tenantId).eq("vehicle_id", vehicleId).eq("canonical_key", key)
      .single();

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
