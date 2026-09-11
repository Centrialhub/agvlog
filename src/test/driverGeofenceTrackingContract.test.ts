import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260910142613_driver_geocoding_geofence_tracking.sql', 'utf8');
const hardening = readFileSync('supabase/migrations/20260910170901_harden_delivery_geofence_scope.sql', 'utf8');
const queue = readFileSync('supabase/functions/agvlog-run-queue/index.ts', 'utf8');
const processor = readFileSync('supabase/functions/agvlog-process-vehicle/index.ts', 'utf8');
const geocoder = readFileSync('supabase/functions/geocode-address/index.ts', 'utf8');

describe('driver geocoding, geofence and SSX tracking contract', () => {
  it('persists provenance, precision and audit for stops and geofences', () => {
    for (const field of ['location_source', 'location_address', 'location_provider', 'location_accuracy_m',
      'location_confidence', 'location_resolved_at', 'location_resolved_by', 'location_audit']) {
      expect(migration).toContain(field);
    }
    expect(migration).toContain('dispatch_planned_route_v2');
    expect(migration).toContain("source_kind in ('address_geocoded','map_selected','imported','legacy_coordinates')");
  });

  it('evaluates every ordered point with hysteresis and consecutive confirmation', () => {
    expect(migration).toContain('process_geofence_position_batch_v1');
    expect(migration).toContain('transition_confirmations');
    expect(migration).toContain('pending_count');
    expect(migration).toContain('exit_margin_m');
    expect(migration).toContain('order by captured_at,provider_payload_hash');
    expect(migration).toContain("v_direction:=case when v_candidate then 'enter' else 'exit' end");
    expect(queue).toContain('read_vehicle_position_processing_page_v1');
    expect(queue).toContain('checkGeofences(supabase, tenantId, vehicleId, pagePositions)');
    expect(queue).toContain('process_geofence_position_batch_v2');
    expect(processor).toContain('process_geofence_position_batch_v2');
  });

  it('keeps the batch evaluator service-only and the operator writers authenticated', () => {
    expect(migration).toMatch(/revoke all on function public\.process_geofence_position_batch_v1[\s\S]*from public,anon,authenticated,service_role/);
    expect(migration).toContain('grant execute on function public.process_geofence_position_batch_v1(uuid,uuid,jsonb) to service_role');
    expect(migration).toContain('grant execute on function public.upsert_geofence_v2(jsonb) to authenticated,service_role');
  });

  it('binds one running dispatch trip to the active SSX tracker and blocks remap conflicts', () => {
    expect(migration).toContain('uq_running_dispatch_trip_tracker');
    expect(migration).toContain('trip_tracker_binding_required');
    expect(migration).toContain('trip_tracker_binding_ambiguous');
    expect(migration).toContain('tracker_link_in_use_by_running_trip');
    expect(migration).toContain("status in ('in_transit','in_progress')");
  });

  it('authenticates geocoding, enforces active tenant and bounds provider responses', () => {
    expect(geocoder).toContain('client.auth.getUser()');
    expect(geocoder).toContain('requireActiveTenant(req, body.tenant_id)');
    expect(geocoder).toContain("countrycodes', 'br'");
    expect(geocoder).toContain('latitude < -90 || latitude > 90');
    expect(geocoder.indexOf('client.auth.getUser()')).toBeLessThan(geocoder.indexOf("createClient(url, serviceKey"));
    expect(geocoder).toContain(".from('address_geocoding_cache')");
    expect(geocoder).toContain(".from('tenant_memberships')");
    expect(geocoder).toContain('actorId = data.user.id');
    expect(geocoder).toContain(".eq('user_id', actorId).eq('active', true)");
    expect(geocoder).toContain("!['owner', 'admin', 'operator'].includes(role)");
    expect(geocoder).toContain("hasEntityTarget && !['owner', 'admin'].includes(role)");
  });

  it('scopes generated delivery fences to the active trip vehicle and stop lifecycle', () => {
    expect(hardening).toContain('sync_delivery_geofence_from_stop');
    expect(hardening).toContain('sync_delivery_geofences_from_trip');
    expect(hardening).toContain("t.vehicle_id=_vehicle_id and t.status in ('in_transit','in_progress')");
    expect(hardening).toContain('not (s.status=any(public.stop_terminal_statuses()))');
    expect(hardening).toContain('process_geofence_position_batch_v2');
    expect(hardening).toMatch(/revoke all on function public\.process_geofence_position_batch_v2[\s\S]*from public,anon,authenticated,service_role/);
    expect(hardening).toContain('grant execute on function public.process_geofence_position_batch_v2(uuid,uuid,jsonb) to service_role');
  });

  it('materializes delivery fences through the dispatch lifecycle without broad operator table access', () => {
    const dispatchV3 = hardening.slice(hardening.indexOf('create or replace function public.dispatch_planned_route_v3'));
    expect(dispatchV3).not.toContain('insert into public.geofences');
    expect(hardening).toContain('security definer');
    expect(hardening).toContain("new.location_source in ('address_geocoded','map_selected')");
  });
});
