import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260922023000_use_tenant_year_for_return_sheets.sql',
  'utf8',
);

describe('occurrence return sheet tenant year', () => {
  it('allocates the year from the tenant civil date with a validated fallback timezone', () => {
    expect(migration).toContain('pg_catalog.pg_timezone_names');
    expect(migration).toContain("else 'America/Sao_Paulo'");
    expect(migration).toContain('(statement_timestamp() at time zone v_timezone)::date');
    expect(migration).toContain('v_year:=extract(year from v_local_date)::integer');
    expect(migration).toContain('on conflict(tenant_id,sequence_year) do update');
    expect(migration).not.toContain('EXTRACT(YEAR FROM _date)');
  });
});
