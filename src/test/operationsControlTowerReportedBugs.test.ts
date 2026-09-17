import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const operationsSource = readFileSync('src/pages/OperationsCenter.tsx', 'utf8');
const towerMigration = readFileSync(
  'supabase/migrations/20260917132000_make_control_tower_reader_catalog_compatible.sql',
  'utf8',
);
const boundedTowerMigration = readFileSync(
  'supabase/migrations/20260917143600_bound_control_tower_snapshot.sql',
  'utf8',
);
const towerHook = readFileSync('src/hooks/useActiveTripsLive.ts', 'utf8');

describe('reported Operations Center and Control Tower regressions', () => {
  it('excludes delivered and cancelled loads from the destination chart', () => {
    expect(operationsSource).toContain(
      "const activeLoads = loads.filter((load) => !['delivered', 'cancelled'].includes(load.status));",
    );
  });

  it('polls every Operations Center data family at the same cadence', () => {
    for (const key of [
      'ops_loads',
      'ops_fiscal',
      'ops_alerts',
      'ops_incidents',
      'ops_expenses_count',
      'ops_maintenance',
      'ops_trips',
    ]) {
      const queryStart = operationsSource.indexOf(`queryKey: ['${key}'`);
      expect(queryStart, `${key} query`).toBeGreaterThan(-1);
      expect(operationsSource.slice(queryStart, queryStart + 2_500)).toContain(
        'refetchInterval: 30000',
      );
    }
  });

  it('returns the mandatory trip identity and tracking contract', () => {
    expect(towerMigration).toContain('dispatch_trip.tenant_id');
    expect(towerMigration).toContain('dispatch_trip.status as trip_status');
    expect(towerMigration).toContain('_tracking as tracking_enabled');
  });

  it('keeps canonical in-transit trips in the live result', () => {
    expect(towerMigration).toContain(
      "('planned', 'loading', 'dispatched', 'in_progress', 'in_transit')",
    );
  });

  it('hides coordinates and live states unless SSX is enabled with a fresh position', () => {
    expect(towerMigration).toContain("policy.feature_key = 'ssx_enabled'");
    expect(towerMigration).toContain("policy.feature_key = 'ssx_kill_switch'");
    expect(towerMigration).toContain("_read_at - interval '15 minutes'");
    expect(towerMigration).toContain('case when freshness.fresh then position.lat end as lat');
    expect(towerMigration).toContain("when not freshness.fresh then 'no_signal'");
    expect(towerMigration).toContain("when not _tracking then 'tracking_disabled'");
  });

  it('reconciles automatic alerts against the restored live fields', () => {
    expect(towerMigration).toContain("trip ->> 'tracking_enabled'");
    expect(towerMigration).toContain("trip ->> 'trip_status' in ('in_transit', 'in_progress')");
    expect(towerMigration).toContain("trip ->> 'state' = alert.type");
  });

  it('polls one bounded snapshot without rebuilding the full trip catalog for alerts', () => {
    expect(boundedTowerMigration).toContain('limit 200');
    const alertStart=boundedTowerMigration.lastIndexOf('create or replace function public.get_open_trip_alerts');
    const optimizedAlerts=boundedTowerMigration.slice(alertStart,boundedTowerMigration.indexOf('create or replace function public.get_control_tower_snapshot_v1',alertStart));
    expect(optimizedAlerts).not.toContain('_trips := public.get_active_trips_live');
    expect(boundedTowerMigration).toContain('get_control_tower_snapshot_v1');
    expect(towerHook).toContain("supabase.rpc('get_control_tower_snapshot_v1'");
    expect(towerHook.match(/refetchInterval: 10_000/g)).toHaveLength(1);
  });
});
