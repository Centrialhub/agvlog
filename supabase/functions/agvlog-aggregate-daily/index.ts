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

    const { tenant_id, day } = await req.json();
    if (!tenant_id) {
      return new Response(
        JSON.stringify({ error: "tenant_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify admin
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

    const targetDay = day || new Date().toISOString().slice(0, 10);
    const dayStart = `${targetDay}T00:00:00Z`;
    const dayEnd = `${targetDay}T23:59:59.999Z`;

    // Get all active vehicles
    const { data: vehicles } = await supabase
      .from("vehicles")
      .select("id")
      .eq("tenant_id", tenant_id)
      .eq("active", true);

    if (!vehicles || vehicles.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No vehicles", aggregated: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let aggregated = 0;

    for (const vehicle of vehicles) {
      // Trips for this day
      const { data: trips } = await supabase
        .from("trips")
        .select("distance_km_estimated, moving_time_seconds, stopped_time_seconds")
        .eq("tenant_id", tenant_id)
        .eq("vehicle_id", vehicle.id)
        .gte("start_at", dayStart)
        .lte("start_at", dayEnd);

      // Stops for this day
      const { data: stops } = await supabase
        .from("trip_stops")
        .select("id")
        .eq("tenant_id", tenant_id)
        .eq("vehicle_id", vehicle.id)
        .gte("start_at", dayStart)
        .lte("start_at", dayEnd);

      // Events for this day
      const { data: overspeedEvents } = await supabase
        .from("events")
        .select("id")
        .eq("tenant_id", tenant_id)
        .eq("vehicle_id", vehicle.id)
        .eq("event_type", "overspeed")
        .gte("event_at", dayStart)
        .lte("event_at", dayEnd);

      const { data: offlineEvents } = await supabase
        .from("events")
        .select("id, payload")
        .eq("tenant_id", tenant_id)
        .eq("vehicle_id", vehicle.id)
        .eq("event_type", "offline")
        .gte("event_at", dayStart)
        .lte("event_at", dayEnd);

      const kmEstimated = (trips || []).reduce(
        (s: number, t: any) => s + (t.distance_km_estimated || 0),
        0
      );
      const movingTime = (trips || []).reduce(
        (s: number, t: any) => s + (t.moving_time_seconds || 0),
        0
      );
      const stoppedTime = (trips || []).reduce(
        (s: number, t: any) => s + (t.stopped_time_seconds || 0),
        0
      );
      const offlineMin = (offlineEvents || []).reduce(
        (s: number, e: any) => s + ((e.payload as any)?.minutes_offline || 0),
        0
      );

      await supabase.from("metrics_daily").upsert(
        {
          tenant_id,
          vehicle_id: vehicle.id,
          day: targetDay,
          km_estimated: Math.round(kmEstimated * 100) / 100,
          moving_time_seconds: movingTime,
          stopped_time_seconds: stoppedTime,
          trips_count: (trips || []).length,
          stops_count: (stops || []).length,
          overspeed_events: (overspeedEvents || []).length,
          offline_minutes: offlineMin,
        },
        { onConflict: "tenant_id,vehicle_id,day" }
      );
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
