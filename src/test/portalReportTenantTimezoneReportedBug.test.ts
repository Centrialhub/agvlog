import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260917145800_use_tenant_timezone_in_portal_reports.sql',
  'utf8',
);

describe('portal report tenant civil timezone', () => {
  it('derives the default period from the tenant local date', () => {
    expect(migration).toContain('v_today := timezone(v_timezone, now())::date');
    expect(migration).toContain('v_start := coalesce(_start_date, v_today - 90)');
    expect(migration).toContain('v_end := coalesce(_end_date, v_today)');
  });

  it('uses tenant-local half-open boundaries for timestamped records', () => {
    expect(migration).toContain('v_start_at := v_start::timestamp at time zone v_timezone');
    expect(migration).toContain("v_end_at := (v_end + 1)::timestamp at time zone v_timezone");
    expect(migration.match(/created_at >= v_start_at/g)).toHaveLength(2);
    expect(migration.match(/created_at < v_end_at/g)).toHaveLength(2);
  });

  it('converts the fiscal-document timestamp fallback to the same civil timezone', () => {
    expect(migration).toContain('coalesce(f.issue_date, timezone(v_timezone, f.created_at)::date)');
  });
});
