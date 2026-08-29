import { createClient } from '@supabase/supabase-js';
import { corsHeaders } from '../_shared/cors.ts';
import { calculateOsrmRoute, type OsrmCoordinate } from '../_shared/osrm.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { trip_id } = await req.json();
    if (!trip_id) {
      return json({ error: 'trip_id required' }, 400);
    }

    const auth = req.headers.get('Authorization') ?? '';
    if (!auth.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anon = createClient(
      supabaseUrl,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: userData, error: userError } = await anon.auth.getUser();
    if (userError || !userData?.user) return json({ error: 'Unauthorized' }, 401);

    const supabase = createClient(
      supabaseUrl,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // 1. Buscar trip
    const { data: trip, error: tripErr } = await supabase
      .from('dispatch_trips')
      .select('id, tenant_id, vehicle_id')
      .eq('id', trip_id)
      .single();
    if (tripErr || !trip) return json({ error: 'trip not found' }, 404);

    const { data: membership } = await supabase
      .from('tenant_memberships')
      .select('role')
      .eq('tenant_id', trip.tenant_id)
      .eq('user_id', userData.user.id)
      .eq('active', true)
      .in('role', ['owner', 'admin', 'operator'])
      .maybeSingle();
    if (!membership) return json({ error: 'Forbidden' }, 403);

    // 2. Buscar paradas ordenadas com coordenadas
    const { data: stops } = await supabase
      .from('dispatch_stops')
      .select('id, stop_order, latitude, longitude, destination')
      .eq('dispatch_trip_id', trip_id)
      .order('stop_order', { ascending: true });

    const stopCoords: OsrmCoordinate[] = (stops || [])
      .filter((stop) => stop.latitude != null && stop.longitude != null)
      .map((stop) => ({ lat: Number(stop.latitude), lng: Number(stop.longitude) }));

    // 3. Origem: posição atual do veículo (se houver), senão primeira parada
    let origin: OsrmCoordinate | null = null;
    if (trip.vehicle_id) {
      const { data: pos } = await supabase
        .from('positions_last')
        .select('lat, lng')
        .eq('vehicle_id', trip.vehicle_id)
        .eq('tenant_id', trip.tenant_id)
        .maybeSingle();
      if (pos?.lat != null && pos?.lng != null) {
        origin = { lat: Number(pos.lat), lng: Number(pos.lng) };
      }
    }

    const coords: OsrmCoordinate[] = [];
    if (origin) coords.push(origin);
    coords.push(...stopCoords);

    if (coords.length < 2) {
      return json({ error: 'Não há coordenadas suficientes para calcular a rota (origem + paradas geocodificadas).' }, 422);
    }

    // 4. Chamar OSRM
    let route;
    try {
      route = await calculateOsrmRoute(coords);
    } catch (e) {
      console.error('OSRM error', e);
      return json({ error: `OSRM indisponível: ${(e as Error).message}` }, 502);
    }

    const first = coords[0];
    const last = coords[coords.length - 1];

    // 5. Upsert em trip_routes
    const { error: upErr } = await supabase
      .from('trip_routes')
      .upsert(
        {
          tenant_id: trip.tenant_id,
          trip_id,
          provider: 'osrm',
          geometry_geojson: route.geometryGeoJson,
          distance_meters: route.distanceMeters,
          duration_seconds: route.durationSeconds,
          origin_lat: first.lat,
          origin_lng: first.lng,
          destination_lat: last.lat,
          destination_lng: last.lng,
          waypoints: route.waypoints,
          calculated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'trip_id,provider' },
      );
    if (upErr) return json({ error: upErr.message }, 500);

    return json({
      ok: true,
      distance_meters: route.distanceMeters,
      duration_seconds: route.durationSeconds,
      waypoint_count: coords.length,
    });
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}
