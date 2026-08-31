import { createClient } from '@supabase/supabase-js';
import { corsHeaders } from '../_shared/cors.ts';
import { calculateOsrmRoute } from '../_shared/osrm.ts';
import { canManageControlTower } from '../_shared/control-tower-auth.ts';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    let body;
    try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const { trip_id, request_id, tenant_id, actor_id } = body ?? {};
    if (![trip_id,request_id,tenant_id,actor_id].every(value=>typeof value==='string' && uuid.test(value))) {
      return json({ error: 'trip_id, request_id, tenant_id and actor_id must be UUIDs' }, 400);
    }
    const auth = req.headers.get('Authorization') ?? '';
    if (!auth.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
    const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: auth } } });
    const { data: userData, error: userError } = await anon.auth.getUser();
    if (userError || !userData?.user) return json({ error: 'Unauthorized' }, 401);
    if(userData.user.id!==actor_id)return json({error:'A conta mudou. Reabra a viagem antes de calcular.',code:'route_context_changed'},409);
    const supabase = anon;
    const { data: trip, error: tripError } = await supabase.from('dispatch_trips').select('id, tenant_id').eq('id', trip_id).single();
    if (tripError || !trip) return json({ error: 'Trip unavailable' }, 404);
    if(trip.tenant_id!==tenant_id)return json({error:'Forbidden'},403);
    if (!await canManageControlTower(anon, trip.tenant_id, userData.user.id)) return json({ error: 'Forbidden' }, 403);
    const args = { _tenant_id: trip.tenant_id, _trip_id: trip_id, _request_id: request_id, _attempt_id: crypto.randomUUID() };
    const prepared = await supabase.rpc('prepare_trip_route_v1', args);
    if (prepared.error) return databaseError(prepared.error);
    if (prepared.data?.completed === true && prepared.data.result?.ok === true) return json(prepared.data.result);
    if (prepared.data?.completed !== false || !Array.isArray(prepared.data.coordinates)) return json({ error: 'Routing preparation not confirmed' }, 500);
    let route;
    try { route = await calculateOsrmRoute(prepared.data.coordinates); }
    catch { return json({ error: 'Provedor de rotas indisponível ou resposta inválida. Tente novamente após 30 segundos.', code: 'route_provider_unavailable' }, 502); }
    // The commit repeats authorization, locks the trip and verifies the prepared
    // revision. No independent HTTP read/check/write race remains here.
    const committed = await supabase.rpc('commit_trip_route_v1', { ...args, _route: {
      geometry: route.geometryGeoJson, distance_meters: route.distanceMeters,
      duration_seconds: route.durationSeconds, waypoints: route.waypoints,
    } });
    if (committed.error) return databaseError(committed.error);
    if (committed.data?.ok !== true || committed.data.trip_id !== trip_id || committed.data.request_id !== request_id) {
      return json({ error: 'Routing commit not confirmed' }, 500);
    }
    return json(committed.data);
  } catch { return json({ error: 'Não foi possível confirmar o cálculo. Repita a mesma solicitação.' }, 500); }
});

function databaseError(error: { code?: string; hint?: string; message?: string }) {
  const status = ({ '42501': 403, PT409: 409, PT422: 422, '22023': 422, '55P03': 409 } as Record<string, number>)[error.code ?? ''] ?? 500;
  return json({ error: status === 500 ? 'Gravação não confirmada. Repita a mesma solicitação.' : error.message,
    code: error.hint || (error.code === '55P03' ? 'route_in_progress' : error.code) }, status);
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
