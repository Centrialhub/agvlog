import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');
const migration = read('supabase/migrations/20260910154838_address_resolution_tracking_operations.sql');
const geocoder = read('supabase/functions/geocode-address/index.ts');
const scheduler = read('supabase/functions/agvlog-schedule-tenants/index.ts');
const cron = read('supabase/bootstrap/tracking_tenant_cron.sql');
const dispatch = read('src/hooks/route-planning/useDispatchRoutePlan.ts');
const geofenceForm = read('src/components/geofences/GeofenceFormDialog.tsx');

describe('address resolution and tracking operations contract', () => {
  it('creates an assisted queue and invalidates verified coordinates after an address change', () => {
    expect(migration).toContain('create table public.address_resolution_queue');
    expect(migration).toContain('clients_invalidate_geocode');
    expect(migration).toContain("new.address_geocode_status:=case when length(v_address)>=8 then 'pending' else 'ignored' end");
    expect(migration).toContain("'reason','address_changed'");
    expect(migration).toContain('initial_backfill');
    expect(migration).toContain('resolve_address_queue_item_v1');
    expect(migration).toContain('address_changed_during_resolution');
  });

  it('uses tenant-scoped persistent cache and an atomic provider quota', () => {
    expect(migration).toContain('create table public.address_geocoding_cache');
    expect(migration).toContain('create table public.geocoding_rate_limits');
    expect(migration).toContain('create table public.geocoding_provider_rate_limits');
    expect(migration).toContain('consume_geocoding_quota_v1');
    expect(migration).toContain("current_user not in ('service_role','postgres')");
    expect(geocoder).toContain("cache: 'hit'");
    expect(geocoder).toContain("cache: 'miss'");
    expect(geocoder).toContain('geocoding_rate_limited');
    expect(geocoder).toContain('address_resolution_queue');
  });

  it('blocks dispatch without verified coordinates unless a detailed exception is audited', () => {
    expect(migration).toContain('dispatch_planned_route_v3');
    expect(migration).toContain('dispatch_location_verification_or_exception_required');
    expect(migration).toContain('location_exception_by=auth.uid()');
    expect(dispatch).toContain("['address_geocoded','map_selected']");
    expect(dispatch).toContain('location_exception_reason');
    expect(dispatch).toContain("dispatch_planned_route_v3");
  });

  it('separates delivery fences from fleet fences and applies per-type radius policy', () => {
    expect(migration).toContain("scope_kind in ('fleet','delivery')");
    expect(migration).toContain('create table public.geofence_radius_policies');
    expect(migration).toContain('uq_delivery_geofence_per_stop');
    expect(migration).toContain("'delivery','delivery',500");
    expect(migration).toContain("'fleet','base',250");
    expect(geofenceForm).toContain("scope_kind: 'fleet'");
    expect(geofenceForm).toContain('upsert_geofence_v4');
  });

  it('claims only due enabled tenants and replaces the former single-tenant cron', () => {
    expect(migration).toContain('create table public.tenant_tracking_schedules');
    expect(migration).toContain('claim_due_tracking_schedules_v1');
    expect(migration).toContain('for update skip locked');
    expect(migration).toContain("feature_key='ssx_kill_switch'");
    expect(scheduler).toContain("isCronRequest(req, url, serviceKey)");
    expect(scheduler).toContain("claim_due_tracking_schedules_v1");
    expect(scheduler).toContain("record_tracking_schedule_result_v1");
    expect(cron).toContain("'agvlog-schedule-tenants-every-minute'");
    expect(cron).toContain("'agvlog-poll-positions-3min'");
  });

  it('keeps new public tables behind explicit grants and RLS', () => {
    for (const table of ['address_resolution_queue', 'address_geocoding_cache', 'geocoding_rate_limits', 'geocoding_provider_rate_limits',
      'geofence_radius_policies', 'tenant_tracking_schedules']) {
      expect(migration).toContain(`alter table public.${table} enable row level security`);
    }
    expect(migration).toContain('revoke all on table public.address_resolution_queue');
    expect(migration).not.toContain('grant select,insert,update,delete on table public.address_resolution_queue to anon');
  });
});
