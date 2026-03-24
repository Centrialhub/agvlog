/**
 * agvlog-compute-state — Vehicle State Engine
 *
 * Computes the definitive movement state for vehicles based on position data.
 * Called after every polling cycle and as a reprocessing job.
 *
 * Modes:
 *   - "batch": Compute state for specific vehicle_ids (called by pipeline after polling)
 *   - "reprocess": Recompute all vehicles for a tenant (scheduled job)
 *
 * State machine:
 *   moving   → speed > 3 km/h
 *   stopped  → speed ≤ 3 km/h, last position < OFFLINE_THRESHOLD
 *   idle     → stopped for > IDLE_THRESHOLD
 *   offline  → no signal for > OFFLINE_THRESHOLD
 *   unknown  → no data
 *
 * Always outputs: speed (never null), movement_state, timestamps
 * Detects events: stop_detected, movement_resumed, went_offline, came_online, idle_detected
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-agvlog-cron-secret",
};

const OFFLINE_THRESHOLD_MS = 25 * 60 * 1000;     // 25 min — no signal = offline
const IDLE_THRESHOLD_MS = 30 * 60 * 1000;         // 30 min stopped = idle
const SPEED_THRESHOLD_KMH = 3;                     // Below = stopped
const DISTANCE_THRESHOLD_M = 50;                   // Below = same position

interface ComputedState {
  speed: number;
  movement_state: "moving" | "stopped" | "idle" | "offline" | "unknown";
  last_movement_at: string | null;
  stopped_since: string | null;
  stopped_duration_seconds: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Auth: cron secret or JWT
    const cronSecret = req.headers.get("x-agvlog-cron-secret");
    const expectedCronSecret = Deno.env.get("AGVLOG_CRON_SECRET");
    const isCron = !!(cronSecret && expectedCronSecret && cronSecret === expectedCronSecret);
    console.log(`[compute-state] Auth check: isCron=${isCron}, hasCronHeader=${!!cronSecret}, hasExpectedSecret=${!!expectedCronSecret}`);

    if (!isCron) {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return jsonResp({ error: "Unauthorized" }, 401);
      }
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
      const anonClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData, error: userError } = await anonClient.auth.getUser();
      if (userError || !userData?.user) {
        return jsonResp({ error: "Unauthorized" }, 401);
      }
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const body = await req.json();
    const { tenant_id, vehicle_ids, mode = "batch" } = body;

    if (!tenant_id) {
      return jsonResp({ error: "tenant_id required" }, 400);
    }

    const now = new Date();
    let targetVehicleIds: string[] = [];

    if (mode === "reprocess") {
      // Reprocess ALL vehicles for this tenant
      const { data: vehicles } = await supabase
        .from("vehicles").select("id")
        .eq("tenant_id", tenant_id).eq("active", true);
      targetVehicleIds = (vehicles || []).map((v: any) => v.id);
    } else {
      // Batch mode — specific vehicles
      targetVehicleIds = vehicle_ids || [];
    }

    if (targetVehicleIds.length === 0) {
      return jsonResp({ success: true, processed: 0, events_emitted: 0 });
    }

    let processed = 0;
    let eventsEmitted = 0;

    for (const vehicleId of targetVehicleIds) {
      try {
        // 1. Get current position data (positions_last)
        const { data: posLast } = await supabase
          .from("positions_last")
          .select("*")
          .eq("tenant_id", tenant_id)
          .eq("vehicle_id", vehicleId)
          .single();

        // 2. Get previous state (if exists)
        const { data: prevState } = await supabase
          .from("vehicles_state")
          .select("*")
          .eq("vehicle_id", vehicleId)
          .single();

        // 3. Get the latest raw position for reference
        const { data: latestRaw } = await supabase
          .from("positions_raw")
          .select("id, captured_at, lat, lng, speed, heading")
          .eq("tenant_id", tenant_id)
          .eq("vehicle_id", vehicleId)
          .order("captured_at", { ascending: false })
          .limit(1)
          .single();

        // 4. Get previous raw position for haversine computation
        const { data: prevPositions } = await supabase
          .from("positions_raw")
          .select("captured_at, lat, lng, speed")
          .eq("tenant_id", tenant_id)
          .eq("vehicle_id", vehicleId)
          .order("captured_at", { ascending: false })
          .limit(2);

        // 5. Compute state
        const computed = computeVehicleState({
          currentPosition: latestRaw || posLast,
          previousPosition: prevPositions && prevPositions.length > 1 ? prevPositions[1] : null,
          previousState: prevState,
          now,
        });

        // 6. Detect events (state transitions)
        const events = detectEvents({
          vehicleId,
          tenantId: tenant_id,
          previousState: prevState,
          newState: computed,
          position: latestRaw || posLast,
          now,
        });

        // 7. Upsert vehicles_state
        await supabase.from("vehicles_state").upsert({
          vehicle_id: vehicleId,
          tenant_id: tenant_id,
          last_position_id: latestRaw?.id || null,
          lat: (latestRaw || posLast)?.lat || prevState?.lat || null,
          lng: (latestRaw || posLast)?.lng || prevState?.lng || null,
          speed: computed.speed,
          heading: (latestRaw || posLast)?.heading || null,
          movement_state: computed.movement_state,
          last_movement_at: computed.last_movement_at,
          last_position_at: (latestRaw || posLast)?.captured_at || prevState?.last_position_at || null,
          stopped_since: computed.stopped_since,
          stopped_duration_seconds: computed.stopped_duration_seconds,
          updated_at: now.toISOString(),
        }, { onConflict: "vehicle_id" });

        // 8. Insert events
        if (events.length > 0) {
          await supabase.from("vehicle_events").insert(events);
          eventsEmitted += events.length;
        }

        processed++;
      } catch (err: any) {
        console.error(`[compute-state] Error for vehicle ${vehicleId}: ${err.message}`);
      }
    }

    console.log(`[compute-state] Processed ${processed} vehicles, emitted ${eventsEmitted} events`);

    return jsonResp({
      success: true,
      processed,
      events_emitted: eventsEmitted,
      mode,
    });
  } catch (err: any) {
    console.error("[compute-state] error:", err);
    return jsonResp({ error: "Internal error", details: err.message }, 500);
  }
});

// ==================== Core State Engine ====================

function computeVehicleState(params: {
  currentPosition: any | null;
  previousPosition: any | null;
  previousState: any | null;
  now: Date;
}): ComputedState {
  const { currentPosition, previousPosition, previousState, now } = params;

  // No data at all
  if (!currentPosition) {
    return {
      speed: 0,
      movement_state: "unknown",
      last_movement_at: previousState?.last_movement_at || null,
      stopped_since: null,
      stopped_duration_seconds: 0,
    };
  }

  const positionAge = now.getTime() - new Date(currentPosition.captured_at).getTime();

  // Check offline: no recent signal
  if (positionAge > OFFLINE_THRESHOLD_MS) {
    return {
      speed: 0,
      movement_state: "offline",
      last_movement_at: previousState?.last_movement_at || null,
      stopped_since: previousState?.stopped_since || currentPosition.captured_at,
      stopped_duration_seconds: Math.floor(positionAge / 1000),
    };
  }

  // Compute speed from haversine if no provider speed
  let speed = currentPosition.speed ?? 0;

  if ((currentPosition.speed == null || currentPosition.speed === 0) && previousPosition) {
    const dist = haversineMeters(
      previousPosition.lat, previousPosition.lng,
      currentPosition.lat, currentPosition.lng
    );
    const timeDelta = (new Date(currentPosition.captured_at).getTime() -
      new Date(previousPosition.captured_at).getTime()) / 1000;

    if (dist < DISTANCE_THRESHOLD_M || timeDelta <= 0) {
      speed = 0;
    } else {
      speed = Math.round((dist / timeDelta) * 3.6 * 10) / 10; // m/s → km/h
    }
  }

  // Determine movement state
  const isMoving = speed > SPEED_THRESHOLD_KMH;

  if (isMoving) {
    return {
      speed,
      movement_state: "moving",
      last_movement_at: currentPosition.captured_at,
      stopped_since: null,
      stopped_duration_seconds: 0,
    };
  }

  // Stopped — check for idle
  const stoppedSince = previousState?.stopped_since ||
    (previousState?.movement_state === "stopped" || previousState?.movement_state === "idle"
      ? previousState.stopped_since
      : currentPosition.captured_at);

  const stoppedDuration = stoppedSince
    ? Math.floor((now.getTime() - new Date(stoppedSince).getTime()) / 1000)
    : 0;

  const isIdle = stoppedDuration * 1000 > IDLE_THRESHOLD_MS;

  return {
    speed,
    movement_state: isIdle ? "idle" : "stopped",
    last_movement_at: previousState?.last_movement_at || null,
    stopped_since: stoppedSince,
    stopped_duration_seconds: stoppedDuration,
  };
}

// ==================== Event Detection ====================

function detectEvents(params: {
  vehicleId: string;
  tenantId: string;
  previousState: any | null;
  newState: ComputedState;
  position: any | null;
  now: Date;
}): any[] {
  const { vehicleId, tenantId, previousState, newState, position, now } = params;
  const events: any[] = [];
  const prevMovement = previousState?.movement_state || "unknown";
  const newMovement = newState.movement_state;

  if (prevMovement === newMovement) return events;

  const base = {
    tenant_id: tenantId,
    vehicle_id: vehicleId,
    event_at: now.toISOString(),
    lat: position?.lat || null,
    lng: position?.lng || null,
  };

  // Moving → Stopped/Idle
  if (prevMovement === "moving" && (newMovement === "stopped" || newMovement === "idle")) {
    events.push({ ...base, event_type: "stop_detected", metadata: { speed: newState.speed } });
  }

  // Stopped → Idle
  if (prevMovement === "stopped" && newMovement === "idle") {
    events.push({
      ...base, event_type: "idle_detected",
      metadata: { stopped_duration_seconds: newState.stopped_duration_seconds },
    });
  }

  // Stopped/Idle/Offline → Moving
  if ((prevMovement === "stopped" || prevMovement === "idle" || prevMovement === "offline") && newMovement === "moving") {
    events.push({ ...base, event_type: "movement_resumed", metadata: { speed: newState.speed } });
  }

  // Any → Offline
  if (prevMovement !== "offline" && prevMovement !== "unknown" && newMovement === "offline") {
    events.push({ ...base, event_type: "went_offline", metadata: {} });
  }

  // Offline → Any online state
  if (prevMovement === "offline" && newMovement !== "offline" && newMovement !== "unknown") {
    events.push({ ...base, event_type: "came_online", metadata: { speed: newState.speed } });
  }

  return events;
}

// ==================== Helpers ====================

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function jsonResp(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
