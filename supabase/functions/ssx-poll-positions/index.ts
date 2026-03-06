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
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify user
    const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await anonClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { integration_account_id, provider_unit_ids } = await req.json();
    if (!integration_account_id) {
      return new Response(
        JSON.stringify({ error: "integration_account_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch integration account
    const { data: account, error: accErr } = await supabase
      .from("integration_accounts")
      .select("*")
      .eq("id", integration_account_id)
      .single();

    if (accErr || !account) {
      return new Response(
        JSON.stringify({ error: "Integration account not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Ensure token is valid
    if (!account.token_cache || !account.token_expires_at) {
      return new Response(
        JSON.stringify({ error: "No token cached. Run ssx-login first." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const expiresAt = new Date(account.token_expires_at);
    if (expiresAt.getTime() < Date.now()) {
      return new Response(
        JSON.stringify({ error: "Token expired. Run ssx-login first." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get provider units to poll
    let unitsQuery = supabase
      .from("provider_units")
      .select("*")
      .eq("integration_account_id", integration_account_id)
      .eq("active", true);

    if (provider_unit_ids?.length) {
      unitsQuery = unitsQuery.in("id", provider_unit_ids);
    }

    const { data: units, error: unitsErr } = await unitsQuery;
    if (unitsErr || !units?.length) {
      return new Response(
        JSON.stringify({ error: "No active provider units found", details: unitsErr?.message }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get vehicle_tracker_links to map provider_unit -> vehicle
    const unitIds = units.map((u: any) => u.id);
    const { data: links } = await supabase
      .from("vehicle_tracker_links")
      .select("*")
      .in("provider_unit_id", unitIds)
      .eq("active", true);

    const unitToVehicle: Record<string, { vehicle_id: string; tenant_id: string }> = {};
    for (const link of links || []) {
      unitToVehicle[link.provider_unit_id] = {
        vehicle_id: link.vehicle_id,
        tenant_id: link.tenant_id,
      };
    }

    const apiVersion = account.settings?.api_version || "v3";
    const baseUrl = account.base_url.replace(/\/$/, "");
    const positionUrl = `${baseUrl}/${apiVersion}/Tracking/PositionHistory/List`;

    const results: any[] = [];
    let totalInserted = 0;
    let totalDuplicates = 0;

    for (const unit of units) {
      const mapping = unitToVehicle[unit.id];
      if (!mapping) {
        results.push({
          unit_code: unit.external_code,
          status: "skipped",
          reason: "No active vehicle link",
        });
        continue;
      }

      // Get cursor for this unit
      const { data: cursor } = await supabase
        .from("ingestion_cursors")
        .select("*")
        .eq("provider_unit_id", unit.id)
        .eq("tenant_id", mapping.tenant_id)
        .single();

      // Check backoff
      if (cursor?.backoff_until && new Date(cursor.backoff_until) > new Date()) {
        results.push({
          unit_code: unit.external_code,
          status: "skipped",
          reason: "In backoff period",
        });
        continue;
      }

      // Build SSX request - use last 10 min window or from cursor
      const now = new Date();
      const windowStart = cursor?.last_success_at
        ? new Date(cursor.last_success_at)
        : new Date(now.getTime() - 10 * 60 * 1000);

      const filters = [
        {
          PropertyName: "TrackedUnit",
          Condition: "Equal",
          Value: unit.external_code,
        },
      ];

      const startTime = Date.now();
      let ssxResponse: Response;
      try {
        ssxResponse = await fetch(positionUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${account.token_cache}`,
          },
          body: JSON.stringify({ Filters: filters }),
        });
      } catch (fetchErr: any) {
        // Network error - apply backoff
        const backoffUntil = new Date(Date.now() + 60000).toISOString();
        await upsertCursor(supabase, {
          tenant_id: mapping.tenant_id,
          provider_unit_id: unit.id,
          last_polled_at: now.toISOString(),
          last_error_at: now.toISOString(),
          last_error: fetchErr.message,
          backoff_until: backoffUntil,
        });

        results.push({
          unit_code: unit.external_code,
          status: "error",
          error: fetchErr.message,
        });
        continue;
      }

      const duration = Date.now() - startTime;

      if (!ssxResponse.ok) {
        const errorText = await ssxResponse.text();
        await upsertCursor(supabase, {
          tenant_id: mapping.tenant_id,
          provider_unit_id: unit.id,
          last_polled_at: now.toISOString(),
          last_error_at: now.toISOString(),
          last_error: `HTTP ${ssxResponse.status}: ${errorText.substring(0, 200)}`,
          backoff_until: new Date(Date.now() + 60000).toISOString(),
        });

        await logIntegration(supabase, {
          tenant_id: mapping.tenant_id,
          integration_account_id,
          action: "ssx_poll_positions",
          endpoint: positionUrl,
          status_code: ssxResponse.status,
          success: false,
          error_message: errorText.substring(0, 500),
          duration_ms: duration,
        });

        results.push({
          unit_code: unit.external_code,
          status: "error",
          http_status: ssxResponse.status,
        });
        continue;
      }

      const responseData = await ssxResponse.json();
      const positions = Array.isArray(responseData)
        ? responseData
        : responseData?.Data || responseData?.data || responseData?.Items || [];

      let inserted = 0;
      let duplicates = 0;
      let latestPoint: any = null;

      for (const point of positions) {
        const normalized = normalizePosition(point);
        if (!normalized) continue;

        // Compute hash for dedupe
        const hashInput = `${unit.external_code}|${normalized.lat}|${normalized.lng}|${normalized.captured_at}`;
        const hash = await computeHash(hashInput);

        // Try insert (unique index will reject dupes)
        const { error: insertErr } = await supabase.from("positions_raw").insert({
          tenant_id: mapping.tenant_id,
          vehicle_id: mapping.vehicle_id,
          captured_at: normalized.captured_at,
          lat: normalized.lat,
          lng: normalized.lng,
          speed: normalized.speed,
          heading: normalized.heading,
          telemetry: normalized.telemetry,
          provider_payload_hash: hash,
        });

        if (insertErr) {
          if (insertErr.code === "23505") {
            duplicates++;
          } else {
            console.error("Insert error:", insertErr);
          }
        } else {
          inserted++;
          if (
            !latestPoint ||
            new Date(normalized.captured_at) > new Date(latestPoint.captured_at)
          ) {
            latestPoint = normalized;
          }
        }
      }

      // Update positions_last with latest point
      if (latestPoint) {
        await supabase.from("positions_last").upsert(
          {
            tenant_id: mapping.tenant_id,
            vehicle_id: mapping.vehicle_id,
            lat: latestPoint.lat,
            lng: latestPoint.lng,
            speed: latestPoint.speed,
            heading: latestPoint.heading,
            captured_at: latestPoint.captured_at,
            received_at: new Date().toISOString(),
            telemetry_snapshot: latestPoint.telemetry || {},
            source: { provider: "SSX", unit_code: unit.external_code },
          },
          { onConflict: "tenant_id,vehicle_id" }
        );
      }

      // Update cursor
      await upsertCursor(supabase, {
        tenant_id: mapping.tenant_id,
        provider_unit_id: unit.id,
        last_polled_at: now.toISOString(),
        last_success_at: now.toISOString(),
        last_error: null,
        backoff_until: null,
      });

      await logIntegration(supabase, {
        tenant_id: mapping.tenant_id,
        integration_account_id,
        action: "ssx_poll_positions",
        endpoint: positionUrl,
        status_code: 200,
        success: true,
        duration_ms: duration,
        metadata: {
          unit_code: unit.external_code,
          points_received: positions.length,
          inserted,
          duplicates,
        },
      });

      totalInserted += inserted;
      totalDuplicates += duplicates;

      results.push({
        unit_code: unit.external_code,
        status: "ok",
        points_received: positions.length,
        inserted,
        duplicates,
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        total_units: units.length,
        total_inserted: totalInserted,
        total_duplicates: totalDuplicates,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("ssx-poll-positions error:", err);
    return new Response(
      JSON.stringify({ error: "Internal error", details: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function normalizePosition(point: any): {
  lat: number;
  lng: number;
  speed: number | null;
  heading: number | null;
  captured_at: string;
  telemetry: Record<string, any>;
} | null {
  // Try multiple field name patterns from SSX
  const lat =
    point.Latitude ?? point.latitude ?? point.Lat ?? point.lat ?? point.Y ?? point.y;
  const lng =
    point.Longitude ?? point.longitude ?? point.Lng ?? point.lng ?? point.X ?? point.x;
  const speed =
    point.Speed ?? point.speed ?? point.Velocidade ?? null;
  const heading =
    point.Direction ?? point.direction ?? point.Heading ?? point.heading ?? point.Course ?? null;

  const dateStr =
    point.DateTimeGPS ?? point.DateTimeServer ?? point.DateTime ??
    point.dateTimeGPS ?? point.dateTimeServer ?? point.dateTime ??
    point.Date ?? point.date ?? point.Timestamp ?? point.timestamp;

  if (lat == null || lng == null || !dateStr) return null;

  const parsedLat = typeof lat === "string" ? parseFloat(lat) : lat;
  const parsedLng = typeof lng === "string" ? parseFloat(lng) : lng;

  if (isNaN(parsedLat) || isNaN(parsedLng)) return null;
  if (parsedLat === 0 && parsedLng === 0) return null; // Invalid GPS

  let captured_at: string;
  try {
    captured_at = new Date(dateStr).toISOString();
  } catch {
    return null;
  }

  // Collect all telemetry fields
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
    if (!knownFields.has(key) && val != null) {
      telemetry[key] = val;
    }
  }

  return {
    lat: parsedLat,
    lng: parsedLng,
    speed: speed != null ? (typeof speed === "string" ? parseFloat(speed) : speed) : null,
    heading: heading != null ? (typeof heading === "string" ? parseFloat(heading) : heading) : null,
    captured_at,
    telemetry,
  };
}

async function computeHash(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function upsertCursor(
  supabase: any,
  data: {
    tenant_id: string;
    provider_unit_id: string;
    last_polled_at: string;
    last_success_at?: string | null;
    last_error_at?: string | null;
    last_error?: string | null;
    backoff_until?: string | null;
  }
) {
  const { error } = await supabase.from("ingestion_cursors").upsert(data, {
    onConflict: "tenant_id,provider_unit_id",
  });
  if (error) console.error("Cursor upsert error:", error);
}

async function logIntegration(
  supabase: any,
  log: {
    tenant_id: string;
    integration_account_id: string;
    action: string;
    endpoint?: string;
    status_code?: number;
    success: boolean;
    error_message?: string;
    duration_ms?: number;
    metadata?: Record<string, any>;
  }
) {
  try {
    await supabase.from("integration_logs").insert(log);
  } catch (e) {
    console.error("Failed to log:", e);
  }
}
