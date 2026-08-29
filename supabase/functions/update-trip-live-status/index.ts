import { createClient } from '@supabase/supabase-js';
import { corsHeaders } from '../_shared/cors.ts';
import { haversineMeters, pointToLineDistanceMeters } from '../_shared/geo.ts';

type State =
  | 'normal' | 'arriving' | 'at_stop' | 'stopped'
  | 'delayed' | 'off_route' | 'no_signal' | 'critical';
type Severity = 'info' | 'success' | 'warning' | 'danger' | 'critical';

const ALLOWED_DEVIATION_M = 500;
const NO_SIGNAL_MIN = 15;
const STOPPED_MIN = 10;
const ARRIVING_M = 1000;
const AT_STOP_M = 150;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

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

    const supabase = createClient(
      supabaseUrl,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: membership } = await supabase
      .from('tenant_memberships')
      .select('role')
      .eq('tenant_id', tenant_id)
      .eq('user_id', userData.user.id)
      .eq('active', true)
      .in('role', ['owner', 'admin', 'operator'])
      .maybeSingle();
    if (!membership) return json({ error: 'Forbidden' }, 403);

    const { data: trips, error: tripsErr } = await supabase
      .from('dispatch_trips')
      .select('id, tenant_id, vehicle_id')
      .eq('tenant_id', tenant_id)
      .in('status', ['planned', 'in_progress', 'loading', 'dispatched']);
    if (tripsErr) return json({ error: tripsErr.message }, 500);

    const now = new Date();
    let processed = 0;
    const errors: string[] = [];

    for (const trip of trips || []) {
      try {
        await processTrip(supabase, trip, now);
        processed++;
      } catch (e) {
        errors.push(`${trip.id}: ${(e as Error).message}`);
      }
    }

    return json({ ok: true, processed, errors });
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});

async function processTrip(supabase: any, trip: any, now: Date) {
  // 1. Última posição
  const { data: pos } = await supabase
    .from('positions_last')
    .select('lat, lng, speed, captured_at')
    .eq('vehicle_id', trip.vehicle_id)
    .eq('tenant_id', trip.tenant_id)
    .maybeSingle();

  // 2. Paradas pendentes
  const { data: stops } = await supabase
    .from('dispatch_stops')
    .select('id, stop_order, latitude, longitude, planned_arrival_at, status')
    .eq('dispatch_trip_id', trip.id)
    .order('stop_order', { ascending: true });

  // Lista canônica de status terminais (espelho de public.stop_terminal_statuses()).
  // arrived é parada ativa (não terminal); departed também é considerado em trânsito.
  const TERMINAL_STATUSES = new Set([
    'completed', 'delivered', 'cancelled', 'skipped',
    'refused', 'returned', 'partial_delivery', 'failed',
  ]);
  const nextStop = (stops || []).find(
    (s: any) => !TERMINAL_STATUSES.has(s.status),
  );

  // 3. Rota planejada
  const { data: route } = await supabase
    .from('trip_routes')
    .select('geometry_geojson')
    .eq('trip_id', trip.id)
    .eq('provider', 'osrm')
    .maybeSingle();

  let state: State = 'normal';
  let severity: Severity = 'info';
  let message = 'Em rota';
  let distanceFromRoute: number | null = null;
  let delayMinutes: number | null = null;
  let stoppedMinutes: number | null = null;
  let etaNext: string | null = null;
  const lastSignalAt: string | null = pos?.captured_at ?? null;
  let lastSignalAgeSec: number | null = null;

  if (!pos) {
    state = 'no_signal';
    severity = 'danger';
    message = 'Veículo sem posição registrada';
  } else {
    const ageMs = now.getTime() - new Date(pos.captured_at).getTime();
    lastSignalAgeSec = Math.round(ageMs / 1000);
    const ageMin = ageMs / 60_000;
    const speed = Number(pos.speed ?? 0);

    if (ageMin >= NO_SIGNAL_MIN) {
      state = 'no_signal';
      severity = 'danger';
      message = `Sem sinal há ${Math.round(ageMin)} minutos`;
    } else if (route?.geometry_geojson) {
      distanceFromRoute = pointToLineDistanceMeters(
        { lat: Number(pos.lat), lng: Number(pos.lng) },
        route.geometry_geojson as any,
      );
      if (distanceFromRoute > ALLOWED_DEVIATION_M && speed > 10) {
        state = 'off_route';
        severity = 'critical';
        message = `Veículo a ${Math.round(distanceFromRoute)}m da rota planejada`;
      }
    }

    // Próxima parada
    if (state === 'normal' && nextStop?.latitude != null && nextStop?.longitude != null) {
      const dToStop = haversineMeters(
        { lat: Number(pos.lat), lng: Number(pos.lng) },
        { lat: Number(nextStop.latitude), lng: Number(nextStop.longitude) },
      );

      if (dToStop <= AT_STOP_M && speed < 5) {
        state = 'at_stop';
        severity = 'success';
        message = 'Na parada';
      } else if (dToStop <= ARRIVING_M) {
        state = 'arriving';
        severity = 'info';
        message = `Chegando (${Math.round(dToStop)}m)`;
      }

      // ETA simples
      if (speed > 5) {
        const etaSec = (dToStop / (speed * 1000 / 3600));
        etaNext = new Date(now.getTime() + etaSec * 1000).toISOString();
      }

      // Atraso vs planned_arrival_at
      if (nextStop.planned_arrival_at && etaNext) {
        const plannedMs = new Date(nextStop.planned_arrival_at).getTime();
        const etaMs = new Date(etaNext).getTime();
        if (etaMs > plannedMs) {
          delayMinutes = Math.round((etaMs - plannedMs) / 60_000);
          if (delayMinutes > 5 && state !== 'at_stop') {
            state = 'delayed';
            severity = delayMinutes > 30 ? 'danger' : 'warning';
            message = `ETA ${delayMinutes}min após o planejado`;
          }
        }
      }
    }

    // Parado fora de uma parada
    if (speed < 3) {
      const positionTime = new Date(pos.captured_at).getTime();
      const historyStart = new Date(positionTime - 2 * 60 * 60 * 1000).toISOString();
      const { data: lastMoving } = await supabase
        .from('positions_raw')
        .select('captured_at')
        .eq('tenant_id', trip.tenant_id)
        .eq('vehicle_id', trip.vehicle_id)
        .gte('speed', 3)
        .lte('captured_at', pos.captured_at)
        .gte('captured_at', historyStart)
        .order('captured_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      let stoppedSince = lastMoving?.captured_at || null;
      if (!stoppedSince) {
        const { data: oldestStationary } = await supabase
          .from('positions_raw')
          .select('captured_at')
          .eq('tenant_id', trip.tenant_id)
          .eq('vehicle_id', trip.vehicle_id)
          .lt('speed', 3)
          .gte('captured_at', historyStart)
          .lte('captured_at', pos.captured_at)
          .order('captured_at', { ascending: true })
          .limit(1)
          .maybeSingle();
        stoppedSince = oldestStationary?.captured_at || null;
      }

      stoppedMinutes = stoppedSince
        ? Math.min(Math.max(0, Math.floor((positionTime - new Date(stoppedSince).getTime()) / 60_000)), 120)
        : 0;
      if (stoppedMinutes >= STOPPED_MIN && state !== 'at_stop' && state !== 'arriving') {
        state = 'stopped';
        severity = 'warning';
        message = `Veículo parado há ${stoppedMinutes}min`;
      }
    }
  }

  // Upsert status
  await supabase.from('trip_live_status').upsert(
    {
      tenant_id: trip.tenant_id,
      trip_id: trip.id,
      vehicle_id: trip.vehicle_id,
      state,
      severity,
      next_stop_id: nextStop?.id ?? null,
      distance_from_route_meters: distanceFromRoute,
      delay_minutes: delayMinutes,
      stopped_minutes: stoppedMinutes,
      eta_next_stop_at: etaNext,
      last_signal_at: lastSignalAt,
      last_signal_age_seconds: lastSignalAgeSec,
      message,
      updated_at: now.toISOString(),
    },
    { onConflict: 'tenant_id,trip_id' },
  );

  // Alertas: criar para estados problemáticos, fechar quando normalizar
  const alertTypeByState: Record<State, string | null> = {
    off_route: 'off_route',
    no_signal: 'no_signal',
    delayed: 'delayed',
    stopped: 'stopped',
    critical: 'manual_occurrence',
    normal: null, arriving: null, at_stop: null,
  };
  const alertType = alertTypeByState[state];

  // Fecha alertas abertos cujo tipo já não se aplica
  await supabase
    .from('trip_alerts')
    .update({ status: 'closed', closed_at: now.toISOString() })
    .eq('tenant_id', trip.tenant_id)
    .eq('trip_id', trip.id)
    .eq('status', 'open')
    .neq('type', alertType ?? '__none__');

  // Abre/atualiza alerta atual
  if (alertType) {
    const { data: existing } = await supabase
      .from('trip_alerts')
      .select('id')
      .eq('tenant_id', trip.tenant_id)
      .eq('trip_id', trip.id)
      .eq('type', alertType)
      .eq('status', 'open')
      .maybeSingle();

    if (!existing) {
      await supabase.from('trip_alerts').insert({
        tenant_id: trip.tenant_id,
        trip_id: trip.id,
        vehicle_id: trip.vehicle_id,
        type: alertType,
        severity,
        title: titleFor(state),
        message,
      });
    }
  }
}

function titleFor(state: State): string {
  switch (state) {
    case 'off_route': return 'Fora da rota';
    case 'no_signal': return 'Sem sinal';
    case 'delayed':   return 'Atrasado';
    case 'stopped':   return 'Parado';
    case 'critical':  return 'Crítico';
    default:          return 'Alerta';
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}
