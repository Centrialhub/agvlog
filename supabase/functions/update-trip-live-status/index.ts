import { createClient } from '@supabase/supabase-js';
import { corsHeaders } from '../_shared/cors.ts';
import { canManageControlTower } from '../_shared/control-tower-auth.ts';
import { requireIntegrationCapability } from '../_shared/capabilities.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({error:'Method not allowed'},405);

  try {
    const body = await req.json().catch(() => ({}));
    const tenant_id: string | undefined = body.tenant_id;
    if (!tenant_id) return json({ error: 'tenant_id required' }, 400);

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

    const capabilityClient = createClient(
      supabaseUrl,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    if (!await canManageControlTower(anon,tenant_id,userData.user.id)) return json({error:'Forbidden'},403);
    const disabled=await requireIntegrationCapability(capabilityClient,tenant_id,'ssx');
    if(disabled) return disabled;
    const supabase=anon;

    const { data: trips, error: tripsErr } = await supabase
      .from('dispatch_trips')
      .select('id, tenant_id, vehicle_id')
      .eq('tenant_id', tenant_id)
      .in('status', ['in_transit', 'in_progress']);
    if (tripsErr) return json({ error: tripsErr.message }, 500);

    let processed = 0;
    const errors: string[] = [];

    for (const trip of trips || []) {
      if (!trip.vehicle_id) continue;
      try {
        const { data, error } = await supabase.rpc('evaluate_trip_live_status_v1', {
          _tenant_id: tenant_id, _trip_id: trip.id,
        });
        if (error) throw error;
        if (data?.ok !== true) throw new Error('Evaluation was not confirmed');
        if (data.evaluated === true) processed++;
      } catch (e) {
        errors.push(`${trip.id}: ${(e as Error).message}`);
      }
    }

    return json({ ok: errors.length===0, processed, errors },errors.length ? 500 : 200);
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
