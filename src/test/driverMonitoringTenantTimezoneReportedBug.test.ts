import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260917145500_use_tenant_timezone_for_driver_monitoring.sql', 'utf8');

describe('driver monitoring tenant-local civil time', () => {
  it('resolves a valid tenant timezone with a legacy fallback', () => {
    expect(migration).toContain('private.driver_monitor_tenant_timezone(_tenant_id uuid)');
    expect(migration).toContain('pg_catalog.pg_timezone_names');
    expect(migration).toContain("), 'America/Sao_Paulo')");
  });

  it('rebuilds progress, forecast and workbook writers without fixed conversions', () => {
    expect(migration).toContain("'public.add_driver_progress_v1(jsonb)'::regprocedure");
    expect(migration).toContain("'public.add_driver_forecast_v1(jsonb)'::regprocedure");
    expect(migration).toContain("'private.import_driver_monitoring_workbook_unsafe_20260917(jsonb)'::regprocedure");
    expect(migration).toContain("'private.driver_monitor_effective_status_tenant(v_tenant,'");
    expect(migration).toContain("'private.driver_monitor_tenant_timezone(v_tenant)'");
  });
});
