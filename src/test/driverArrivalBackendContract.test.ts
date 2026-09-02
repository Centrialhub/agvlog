import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const superseded = readFileSync(join(
  process.cwd(),
  'supabase',
  'migrations',
  '20260830003721_require_driver_arrival_geolocation.sql',
), 'utf8');
const migration = readFileSync(join(
  process.cwd(),
  'supabase',
  'migrations',
  '20260831232458_add_gps_driver_arrival_rpc.sql',
), 'utf8');
const cutover = readFileSync(join(
  process.cwd(),
  'docs',
  'qa',
  'DRIVER-ARRIVAL-GPS-CUTOVER-2026-08-31.sql',
), 'utf8');

describe('driver arrival backend contract', () => {
  it('keeps the rejected destructive migration inert and adds GPS as an overload', () => {
    expect(superseded).toContain('Superseded before publication');
    expect(superseded.trimStart()).toMatch(/^\/\*/);
    expect(migration).not.toContain('drop function public.driver_mark_arrival(uuid)');
    expect(migration).toContain("to_regprocedure('public.driver_mark_arrival(uuid)')");
    expect(migration).toContain('71506404e6bafbaeb3dc17a3e2530a1c');
    expect(migration).toContain('_latitude double precision');
    expect(migration).toContain('_longitude double precision');
    expect(migration).toContain('_accuracy_m double precision');
  });

  it('stages the legacy removal outside the automatic migration chain', () => {
    expect(cutover).toContain('deliberately outside supabase/migrations');
    expect(cutover).toContain('74a957d4c16ef52847b8c7c6859f5e20');
    expect(cutover).toContain('drop function public.driver_mark_arrival(uuid)');
    expect(cutover.indexOf('GPS RPC hash changed')).toBeLessThan(
      cutover.indexOf('drop function public.driver_mark_arrival(uuid)'),
    );
    expect(cutover.indexOf('drop function public.driver_mark_arrival(uuid)')).toBeLessThan(
      cutover.indexOf('Arrival cutover postcondition failed'),
    );
    expect(cutover).toContain("notify pgrst, 'reload schema'");
  });

  it('checks trip state, GPS accuracy, and stop proximity', () => {
    expect(migration).toContain("v_trip.status not in ('in_transit', 'in_progress')");
    expect(migration).toContain('v_max_accuracy_m constant double precision := 150');
    expect(migration).toContain('extensions.st_distance');
    expect(migration).toContain('v_max_distance_m constant double precision := 500');
  });

  it('stores auditable geofence evidence in the arrival event', () => {
    expect(migration).toContain("'distance_to_stop_m'");
    expect(migration).toContain("'geofence_verified', true");
    expect(migration).toMatch(/grant execute[\s\S]*to authenticated/);
    expect(migration).not.toMatch(/grant execute[\s\S]*to service_role/);
  });

  it('locks the trip before the stop and rechecks tenant/assignment after waiting', () => {
    const firstLock = migration.indexOf('for update;');
    expect(firstLock).toBeGreaterThan(migration.indexOf('from public.dispatch_trips as trip'));
    expect(migration.slice(0, firstLock)).not.toContain('for update');
    expect(migration.slice(firstLock)).toContain('stop.dispatch_trip_id = v_trip.id');
    expect(migration.slice(firstLock)).toContain('stop.tenant_id = v_trip.tenant_id');
    expect(migration).toContain("'Parada reatribuída; atualize a viagem'");
  });

  it('accepts pre-arrival states, fails closed on null status and scopes replay to the actor', () => {
    expect(migration).toContain("v_stop.status is null or v_stop.status not in ('pending', 'planned', 'arriving')");
    expect(migration).toContain('v_trip.status is null or');
    expect(migration).toContain('event.tenant_id = v_trip.tenant_id');
    expect(migration).toContain('event.dispatch_trip_id = v_trip.id');
    expect(migration).toContain('event.created_by = auth.uid()');
  });
});
