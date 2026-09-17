import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { expectedReturnDate } from '@/pages/DriverMonitoring';

const page = readFileSync(resolve('src/pages/DriverMonitoring.tsx'), 'utf8');
const migration = readFileSync(resolve('supabase/migrations/20260917152300_enforce_driver_monitor_start_schedule.sql'), 'utf8');

describe('reported driver monitor creation bugs', () => {
  it('adds the deadline to the Sao Paulo civil date, not the UTC date', () => {
    expect(expectedReturnDate('2026-09-17T02:30:00.000Z', 1)).toBe('2026-09-17');
    expect(expectedReturnDate('2026-09-18T02:30:00.000Z', 3)).toBe('2026-09-20');
  });

  it('requires at least one delivery in both UI and database', () => {
    expect(page).toContain('createForm.total <= 0');
    expect(page).toContain('type="number" min={1}');
    expect(migration).toContain("raise exception 'driver_monitor_requires_delivery'");
    expect(migration).toContain('total_deliveries > 0');
  });

  it('recomputes the return date authoritatively in Sao Paulo', () => {
    expect(migration).toContain("(new.started_at at time zone 'America/Sao_Paulo')::date + new.return_deadline_days");
    expect(migration).toContain("(v_started_at at time zone 'America/Sao_Paulo')::date + v_return_days");
  });
});
