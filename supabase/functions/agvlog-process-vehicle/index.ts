import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify user
    const anonClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const callerId = claimsData.claims.sub as string;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { tenant_id, vehicle_id, from, to } = await req.json();
    if (!tenant_id || !vehicle_id) {
      return new Response(
        JSON.stringify({ error: "tenant_id and vehicle_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify caller is admin/owner
    const { data: membership } = await supabase
      .from("tenant_memberships")
      .select("role")
      .eq("tenant_id", tenant_id)
      .eq("user_id", callerId)
      .eq("active", true)
      .limit(1)
      .single();

    if (!membership || !["owner", "admin"].includes(membership.role)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch tenant settings
    const { data: tenant } = await supabase
      .from("tenants")
      .select("settings, timezone")
      .eq("id", tenant_id)
      .single();

    const settings = (tenant?.settings as any) || {};
    const offlineThresholdMin = settings.offline_threshold_minutes || 15;
    const overspeedLimit = settings.overspeed_limit_kmh || 80;
    const longStopThresholdMin = settings.long_stop_threshold_minutes || 40;

    // Fetch positions_raw
    const defaultFrom = from || new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const defaultTo = to || new Date().toISOString();

    const posQuery = supabase
      .from("positions_raw")
      .select("*")
      .eq("tenant_id", tenant_id)
      .eq("vehicle_id", vehicle_id)
      .gte("captured_at", defaultFrom)
      .lte("captured_at", defaultTo)
      .order("captured_at", { ascending: true })
      .limit(5000);

    const { data: positions, error: posErr } = await posQuery;
    if (posErr) throw posErr;
    if (!positions || positions.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No positions to process", stats: {} }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stats = {
      positions_analyzed: positions.length,
      trips_created: 0,
      stops_created: 0,
      events_created: 0,
      pois_updated: 0,
    };

    // ==========================================
    // 1) CLASSIFY MOVEMENT vs STOPPED per point
    // ==========================================
    const classified = classifyMovement(positions);

    // ==========================================
    // 2) DETECT TRIPS
    // ==========================================
    const trips = detectTrips(classified);

    for (const trip of trips) {
      const distance = computeTripDistance(trip.points);
      const movingTime = computeMovingTime(trip.points, classified);

      const { error: tripErr } = await supabase.from("trips").insert({
        tenant_id,
        vehicle_id,
        start_at: trip.start,
        end_at: trip.end,
        distance_km_estimated: Math.round(distance * 100) / 100,
        moving_time_seconds: movingTime,
        stopped_time_seconds: trip.stoppedTime,
        detection_mode: "basic",
        confidence_score: 0.6,
      });

      if (!tripErr) stats.trips_created++;
    }

    // ==========================================
    // 3) DETECT STOPS
    // ==========================================
    const stops = detectStops(classified);

    for (const stop of stops) {
      const durationMin = stop.duration / 60;
      let stopClass = "short";
      if (durationMin >= 40) stopClass = "long";
      else if (durationMin >= 10) stopClass = "operational";

      const { error: stopErr } = await supabase.from("trip_stops").insert({
        tenant_id,
        vehicle_id,
        lat: stop.lat,
        lng: stop.lng,
        start_at: stop.start,
        end_at: stop.end,
        duration_seconds: Math.round(stop.duration),
        stop_class: stopClass,
      });

      if (!stopErr) stats.stops_created++;
    }

    // ==========================================
    // 4) AUTO POIs from repeated stops (last 14 days)
    // ==========================================
    const { data: recentStops } = await supabase
      .from("trip_stops")
      .select("lat, lng, vehicle_id")
      .eq("tenant_id", tenant_id)
      .gte("start_at", new Date(Date.now() - 14 * 86400000).toISOString())
      .in("stop_class", ["operational", "long"]);

    if (recentStops && recentStops.length > 0) {
      const clusters = clusterStops(recentStops, 80);
      for (const cluster of clusters) {
        if (cluster.count < 5) continue;

        const uniqueVehicles = new Set(cluster.vehicleIds);
        const category =
          uniqueVehicles.size >= 3
            ? "base_candidate"
            : uniqueVehicles.size <= 2
            ? "client_candidate"
            : "unknown";

        const { data: existing } = await supabase
          .from("pois")
          .select("id")
          .eq("tenant_id", tenant_id)
          .gte("lat", cluster.lat - 0.001)
          .lte("lat", cluster.lat + 0.001)
          .gte("lng", cluster.lng - 0.001)
          .lte("lng", cluster.lng + 0.001)
          .limit(1);

        if (!existing || existing.length === 0) {
          await supabase.from("pois").insert({
            tenant_id,
            lat: cluster.lat,
            lng: cluster.lng,
            category,
            source: "auto",
            confidence_score: Math.min(0.9, 0.3 + cluster.count * 0.05),
            metadata: { stop_count: cluster.count, unique_vehicles: uniqueVehicles.size },
          });
          stats.pois_updated++;
        }
      }
    }

    // ==========================================
    // 5) EVENTS: OFFLINE, OVERSPEED, LONG_STOP
    // ==========================================
    // OFFLINE check
    const { data: lastPos } = await supabase
      .from("positions_last")
      .select("captured_at")
      .eq("tenant_id", tenant_id)
      .eq("vehicle_id", vehicle_id)
      .single();

    if (lastPos) {
      const ageMin = (Date.now() - new Date(lastPos.captured_at).getTime()) / 60000;
      if (ageMin > offlineThresholdMin) {
        await insertEvent(supabase, tenant_id, vehicle_id, "offline", "warning", {
          minutes_offline: Math.round(ageMin),
          threshold: offlineThresholdMin,
        });
        stats.events_created++;
      }
    }

    // OVERSPEED check
    for (const p of positions) {
      if (p.speed != null && p.speed > overspeedLimit) {
        await insertEvent(supabase, tenant_id, vehicle_id, "overspeed", "warning", {
          speed: p.speed,
          limit: overspeedLimit,
          at: p.captured_at,
          lat: p.lat,
          lng: p.lng,
        });
        stats.events_created++;
      }
    }

    // LONG_STOP check
    for (const stop of stops) {
      if (stop.duration / 60 > longStopThresholdMin) {
        await insertEvent(supabase, tenant_id, vehicle_id, "long_stop", "info", {
          duration_minutes: Math.round(stop.duration / 60),
          lat: stop.lat,
          lng: stop.lng,
          start: stop.start,
          end: stop.end,
        });
        stats.events_created++;
      }
    }

    // ==========================================
    // 6) GEOFENCE checks (if PostGIS available)
    // ==========================================
    try {
      const { data: geoEvents } = await checkGeofences(supabase, tenant_id, vehicle_id, positions);
      if (geoEvents) stats.events_created += geoEvents;
    } catch (e) {
      console.log("Geofence check skipped:", e);
    }

    // ==========================================
    // 7) CAPABILITY DETECTION
    // ==========================================
    await detectCapabilities(supabase, tenant_id, vehicle_id, positions);

    return new Response(
      JSON.stringify({ success: true, stats }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("agvlog-process-vehicle error:", err);
    return new Response(
      JSON.stringify({ error: "Internal error", details: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ============ HELPERS ============

interface ClassifiedPoint {
  lat: number;
  lng: number;
  speed: number | null;
  captured_at: string;
  moving: boolean;
  telemetry: any;
}

function classifyMovement(positions: any[]): ClassifiedPoint[] {
  return positions.map((p, i) => {
    let moving = false;
    if (p.speed != null) {
      moving = p.speed > 2;
    } else if (i > 0) {
      const prev = positions[i - 1];
      const dist = haversine(prev.lat, prev.lng, p.lat, p.lng);
      const timeDiff =
        (new Date(p.captured_at).getTime() - new Date(prev.captured_at).getTime()) / 1000;
      if (timeDiff > 0) {
        const speedEstimate = (dist / timeDiff) * 3.6; // km/h
        moving = speedEstimate > 3;
      }
    }
    return {
      lat: p.lat,
      lng: p.lng,
      speed: p.speed,
      captured_at: p.captured_at,
      moving,
      telemetry: p.telemetry || {},
    };
  });
}

function detectTrips(
  points: ClassifiedPoint[]
): { start: string; end: string; points: ClassifiedPoint[]; stoppedTime: number }[] {
  const trips: any[] = [];
  let tripStart: number | null = null;
  let consecutiveMoving = 0;
  let consecutiveStopped = 0;
  let stoppedTime = 0;

  const MOVE_THRESHOLD = 180; // 3 min of sustained movement
  const STOP_THRESHOLD = 1800; // 30 min stop ends trip

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const prevTime = i > 0 ? new Date(points[i - 1].captured_at).getTime() : 0;
    const curTime = new Date(p.captured_at).getTime();
    const delta = i > 0 ? (curTime - prevTime) / 1000 : 0;

    if (p.moving) {
      consecutiveMoving += delta;
      if (consecutiveStopped > 0 && tripStart !== null) {
        stoppedTime += consecutiveStopped;
      }
      consecutiveStopped = 0;

      if (tripStart === null && consecutiveMoving >= MOVE_THRESHOLD) {
        // Find actual start (backtrack)
        tripStart = Math.max(0, i - Math.ceil(MOVE_THRESHOLD / (delta || 30)));
      }
    } else {
      consecutiveStopped += delta;
      consecutiveMoving = 0;

      if (tripStart !== null && consecutiveStopped >= STOP_THRESHOLD) {
        trips.push({
          start: points[tripStart].captured_at,
          end: points[i].captured_at,
          points: points.slice(tripStart, i + 1),
          stoppedTime: Math.round(stoppedTime),
        });
        tripStart = null;
        stoppedTime = 0;
        consecutiveStopped = 0;
      }
    }
  }

  // Close open trip at end of data
  if (tripStart !== null) {
    trips.push({
      start: points[tripStart].captured_at,
      end: points[points.length - 1].captured_at,
      points: points.slice(tripStart),
      stoppedTime: Math.round(stoppedTime),
    });
  }

  return trips;
}

function detectStops(
  points: ClassifiedPoint[]
): { lat: number; lng: number; start: string; end: string; duration: number }[] {
  const stops: any[] = [];
  let stopStart: number | null = null;

  for (let i = 0; i < points.length; i++) {
    if (!points[i].moving) {
      if (stopStart === null) stopStart = i;
    } else {
      if (stopStart !== null) {
        const duration =
          (new Date(points[i].captured_at).getTime() -
            new Date(points[stopStart].captured_at).getTime()) /
          1000;
        if (duration >= 120) {
          // At least 2 min
          const centerLat =
            points
              .slice(stopStart, i)
              .reduce((s, p) => s + p.lat, 0) / (i - stopStart);
          const centerLng =
            points
              .slice(stopStart, i)
              .reduce((s, p) => s + p.lng, 0) / (i - stopStart);
          stops.push({
            lat: Math.round(centerLat * 1e6) / 1e6,
            lng: Math.round(centerLng * 1e6) / 1e6,
            start: points[stopStart].captured_at,
            end: points[i - 1].captured_at,
            duration,
          });
        }
        stopStart = null;
      }
    }
  }

  // Handle trailing stop
  if (stopStart !== null && stopStart < points.length - 1) {
    const last = points.length - 1;
    const duration =
      (new Date(points[last].captured_at).getTime() -
        new Date(points[stopStart].captured_at).getTime()) /
      1000;
    if (duration >= 120) {
      const cnt = last - stopStart + 1;
      const centerLat =
        points.slice(stopStart, last + 1).reduce((s, p) => s + p.lat, 0) / cnt;
      const centerLng =
        points.slice(stopStart, last + 1).reduce((s, p) => s + p.lng, 0) / cnt;
      stops.push({
        lat: Math.round(centerLat * 1e6) / 1e6,
        lng: Math.round(centerLng * 1e6) / 1e6,
        start: points[stopStart].captured_at,
        end: points[last].captured_at,
        duration,
      });
    }
  }

  return stops;
}

function computeTripDistance(points: ClassifiedPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversine(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
  }
  return total / 1000; // km
}

function computeMovingTime(points: ClassifiedPoint[], classified: ClassifiedPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i].moving) {
      total +=
        (new Date(points[i].captured_at).getTime() -
          new Date(points[i - 1].captured_at).getTime()) /
        1000;
    }
  }
  return Math.round(total);
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function clusterStops(
  stops: { lat: number; lng: number; vehicle_id: string }[],
  radiusM: number
): { lat: number; lng: number; count: number; vehicleIds: string[] }[] {
  const clusters: { lat: number; lng: number; count: number; vehicleIds: string[] }[] = [];
  const used = new Set<number>();

  for (let i = 0; i < stops.length; i++) {
    if (used.has(i)) continue;
    const cluster = { lat: stops[i].lat, lng: stops[i].lng, count: 1, vehicleIds: [stops[i].vehicle_id] };
    used.add(i);

    for (let j = i + 1; j < stops.length; j++) {
      if (used.has(j)) continue;
      if (haversine(cluster.lat, cluster.lng, stops[j].lat, stops[j].lng) <= radiusM) {
        cluster.count++;
        cluster.vehicleIds.push(stops[j].vehicle_id);
        used.add(j);
      }
    }
    clusters.push(cluster);
  }

  return clusters;
}

async function insertEvent(
  supabase: any,
  tenantId: string,
  vehicleId: string,
  eventType: string,
  severity: string,
  payload: any
) {
  await supabase.from("events").insert({
    tenant_id: tenantId,
    vehicle_id: vehicleId,
    event_type: eventType,
    severity,
    payload,
    event_at: payload.at || new Date().toISOString(),
  });
}

async function checkGeofences(
  supabase: any,
  tenantId: string,
  vehicleId: string,
  positions: any[]
): Promise<{ data: number }> {
  // Get enabled geofences for tenant
  const { data: geofences } = await supabase
    .from("geofences")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .eq("enabled", true);

  if (!geofences || geofences.length === 0) return { data: 0 };

  const eventsCreated = 0;

  // For each geofence, check first and last point to detect enter/exit
  // Simple approach: check if first point is inside and last point is outside (or vice versa)
  for (const geo of geofences) {
    const first = positions[0];
    const last = positions[positions.length - 1];

    // Use a simple RPC-based check if available, otherwise skip
    // For MVP, we log that geofence checking requires PostGIS spatial queries
    // which are better done as a DB function
  }

  return { data: eventsCreated };
}

async function detectCapabilities(
  supabase: any,
  tenantId: string,
  vehicleId: string,
  positions: any[]
) {
  const capabilities: Record<string, boolean> = {
    gps: true,
    speed: false,
    heading: false,
    ignition: false,
    odometer: false,
  };

  const telemetryKeys = new Set<string>();

  for (const p of positions) {
    if (p.speed != null) capabilities.speed = true;
    if (p.heading != null) capabilities.heading = true;

    const tel = p.telemetry || {};
    for (const key of Object.keys(tel)) {
      telemetryKeys.add(key);
      const lk = key.toLowerCase();
      if (lk.includes("ignit") || lk.includes("ignicao") || lk === "acc") {
        capabilities.ignition = true;
      }
      if (lk.includes("odometer") || lk.includes("hodometro") || lk.includes("km")) {
        capabilities.odometer = true;
      }
    }
  }

  // Upsert vehicle_capabilities
  await supabase.from("vehicle_capabilities").upsert(
    {
      tenant_id: tenantId,
      vehicle_id: vehicleId,
      capabilities,
      confidence_score: 0.8,
      last_detected_at: new Date().toISOString(),
    },
    { onConflict: "vehicle_id" }
  );

  // Upsert telemetry_observations
  for (const key of telemetryKeys) {
    await supabase.from("telemetry_observations").upsert(
      {
        tenant_id: tenantId,
        vehicle_id: vehicleId,
        canonical_key: key,
        last_seen_at: new Date().toISOString(),
        times_seen: 1,
      },
      { onConflict: "tenant_id,vehicle_id,canonical_key", count: "exact" }
    );
  }
}
