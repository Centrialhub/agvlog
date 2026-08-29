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
    const { tenant_id, day } = await req.json();

    if (!tenant_id) {
      return new Response(JSON.stringify({ error: "tenant_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    const targetDay = day || new Date().toISOString().slice(0, 10);
    const dayStart = `${targetDay}T00:00:00Z`;
    const dayEnd = `${targetDay}T23:59:59.999Z`;

    const { data: vehicles } = await supabase
      .from("vehicles").select("id")
      .eq("tenant_id", tenant_id).eq("active", true);

    if (!vehicles || vehicles.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No vehicles", aggregated: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let aggregated = 0;

    for (const vehicle of vehicles) {
      // Trips
      const { data: trips } = await supabase
        .from("trips")
        .select("distance_km_estimated, moving_time_seconds, stopped_time_seconds")
        .eq("tenant_id", tenant_id).eq("vehicle_id", vehicle.id)
        .gte("start_at", dayStart).lte("start_at", dayEnd);

      // Stops
      const { data: stops } = await supabase
        .from("trip_stops").select("id, stop_class")
        .eq("tenant_id", tenant_id).eq("vehicle_id", vehicle.id)
        .gte("start_at", dayStart).lte("start_at", dayEnd);

      // Overspeed events (sessions)
      const { data: overspeedEvents } = await supabase
        .from("events").select("id, payload")
        .eq("tenant_id", tenant_id).eq("vehicle_id", vehicle.id)
        .eq("event_type", "overspeed").eq("source", "engine")
        .gte("event_at", dayStart).lte("event_at", dayEnd);

      // Route deviation events
      const { data: routeDeviationEvents } = await supabase
        .from("events").select("id")
        .eq("tenant_id", tenant_id).eq("vehicle_id", vehicle.id)
        .eq("event_type", "route_deviation").eq("source", "engine")
        .gte("event_at", dayStart).lte("event_at", dayEnd);

      // Offline minutes from alert_instances
      let offlineMin = 0;
      const { data: offlineRules } = await supabase
        .from("alert_rules").select("id")
        .eq("tenant_id", tenant_id).eq("rule_type", "offline").eq("enabled", true);

      if (offlineRules && offlineRules.length > 0) {
        const ruleIds = offlineRules.map((r: any) => r.id);
        const { data: offlineAlerts } = await supabase
          .from("alert_instances")
          .select("opened_at, closed_at, status")
          .eq("tenant_id", tenant_id).eq("vehicle_id", vehicle.id)
          .eq("source", "engine")
          .in("rule_id", ruleIds);

        if (offlineAlerts) {
          for (const alert of offlineAlerts) {
            const start = new Date(Math.max(new Date(alert.opened_at).getTime(), new Date(dayStart).getTime()));
            const end = alert.closed_at
              ? new Date(Math.min(new Date(alert.closed_at).getTime(), new Date(dayEnd).getTime()))
              : new Date(Math.min(Date.now(), new Date(dayEnd).getTime()));
            if (end > start) offlineMin += (end.getTime() - start.getTime()) / 60000;
          }
        }
      }

      // Speed metrics from positions_raw
      let maxSpeedKmh = 0;
      let avgSpeedKmh = 0;
      const { data: speedPositions } = await supabase
        .from("positions_raw").select("speed")
        .eq("tenant_id", tenant_id).eq("vehicle_id", vehicle.id)
        .gte("captured_at", dayStart).lte("captured_at", dayEnd)
        .not("speed", "is", null)
        .limit(5000);

      if (speedPositions && speedPositions.length > 0) {
        const speeds = speedPositions.map((p: any) => p.speed).filter((s: number) => s != null);
        if (speeds.length > 0) {
          maxSpeedKmh = Math.round(Math.max(...speeds));
          avgSpeedKmh = Math.round(speeds.reduce((a: number, b: number) => a + b, 0) / speeds.length);
        }
      }

      // Overspeed minutes (sum session durations)
      let overspeedMinutes = 0;
      if (overspeedEvents) {
        for (const ev of overspeedEvents) {
          const p = ev.payload as any;
          if (p?.start_at && p?.end_at) {
            const durMs = new Date(p.end_at).getTime() - new Date(p.start_at).getTime();
            if (durMs > 0) overspeedMinutes += durMs / 60000;
          }
        }
      }

      // Overnight stops count
      const overnightStopsCount = (stops || []).filter((s: any) => s.stop_class === "overnight").length;

      // Fuel metrics
      let fuelStart: number | null = null;
      let fuelEnd: number | null = null;
      let fuelConsumed: number | null = null;

      const { data: firstFuel } = await supabase
        .from("fuel_readings").select("fuel_value")
        .eq("tenant_id", tenant_id).eq("vehicle_id", vehicle.id)
        .gte("captured_at", dayStart).lte("captured_at", dayEnd)
        .order("captured_at", { ascending: true }).limit(1);

      const { data: lastFuel } = await supabase
        .from("fuel_readings").select("fuel_value")
        .eq("tenant_id", tenant_id).eq("vehicle_id", vehicle.id)
        .gte("captured_at", dayStart).lte("captured_at", dayEnd)
        .order("captured_at", { ascending: false }).limit(1);

      if (firstFuel && firstFuel.length > 0) fuelStart = firstFuel[0].fuel_value;
      if (lastFuel && lastFuel.length > 0) fuelEnd = lastFuel[0].fuel_value;
      if (fuelStart != null && fuelEnd != null) fuelConsumed = Math.round((fuelStart - fuelEnd) * 100) / 100;

      // Fuel events count
      const { data: refuelEvents } = await supabase
        .from("fuel_events").select("id")
        .eq("tenant_id", tenant_id).eq("vehicle_id", vehicle.id)
        .eq("event_type", "refuel")
        .gte("event_at", dayStart).lte("event_at", dayEnd);

      const { data: drainEvents } = await supabase
        .from("fuel_events").select("id")
        .eq("tenant_id", tenant_id).eq("vehicle_id", vehicle.id)
        .eq("event_type", "drain")
        .gte("event_at", dayStart).lte("event_at", dayEnd);

      const kmEstimated = (trips || []).reduce((s: number, t: any) => s + (t.distance_km_estimated || 0), 0);
      const movingTime = (trips || []).reduce((s: number, t: any) => s + (t.moving_time_seconds || 0), 0);
      const stoppedTime = (trips || []).reduce((s: number, t: any) => s + (t.stopped_time_seconds || 0), 0);

      await supabase.from("metrics_daily").upsert({
        tenant_id,
        vehicle_id: vehicle.id,
        day: targetDay,
        km_estimated: Math.round(kmEstimated * 100) / 100,
        moving_time_seconds: movingTime,
        stopped_time_seconds: stoppedTime,
        trips_count: (trips || []).length,
        stops_count: (stops || []).length,
        overspeed_events: (overspeedEvents || []).length,
        offline_minutes: Math.round(offlineMin),
        max_speed_kmh: maxSpeedKmh,
        avg_speed_kmh: avgSpeedKmh,
        overspeed_minutes: Math.round(overspeedMinutes),
        overnight_stops_count: overnightStopsCount,
        route_deviation_events: (routeDeviationEvents || []).length,
        fuel_start: fuelStart,
        fuel_end: fuelEnd,
        fuel_consumed: fuelConsumed,
        fuel_refuel_events: (refuelEvents || []).length,
        fuel_drain_events: (drainEvents || []).length,
      }, { onConflict: "tenant_id,vehicle_id,day" });
      aggregated++;
    }

    return new Response(
      JSON.stringify({ success: true, day: targetDay, aggregated }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("agvlog-aggregate-daily error:", err);
    return new Response(
      JSON.stringify({ error: "Internal error", details: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
