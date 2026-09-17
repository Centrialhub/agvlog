import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve('supabase/migrations/20260917152400_use_operational_date_for_driver_progress.sql'),
  'utf8',
);

describe('reported driver progress local time and operational date bugs', () => {
  it('casts the local finish field directly to time without timezone', () => {
    expect(migration).toContain("nullif(_payload->>'city_finished_at','')::time");
    expect(migration).not.toContain("nullif(_payload->>'city_finished_at','')::timestamptz");
  });

  it('rejects future/pre-start operational dates and derives freshness from the declared date', () => {
    expect(migration).toContain('v_update_date > v_today');
    expect(migration).toContain("v_update_date < (v_monitor_row.started_at at time zone 'America/Sao_Paulo')::date");
    expect(migration).toContain("at time zone 'America/Sao_Paulo'");
    expect(migration).toContain('last_update_at = v_effective_last_update');
    expect(migration).not.toContain('last_update_at = v_now');
  });
});
