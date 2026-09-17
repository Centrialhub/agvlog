import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260917150700_snapshot_finance_audit_in_tenant_timezone.sql',
  'utf8',
);
const contract = readFileSync('src/lib/financial/financeAuditContract.ts', 'utf8');
const page = readFileSync('src/pages/FinanceAudit.tsx', 'utf8');

describe('finance audit civil dates and stable paging', () => {
  it('derives date boundaries and response timezone from the tenant', () => {
    expect(migration).toContain('pg_catalog.pg_timezone_names');
    expect(migration).toContain('at time zone tenant_timezone');
    expect(migration).toContain("'timezone',tenant_timezone");
    expect(contract).not.toContain("timezone:z.literal('America/Sao_Paulo')");
  });

  it('freezes the collection at the first response snapshot across page controls', () => {
    expect(migration).toContain('event.created_at <= snapshot_at');
    expect(migration).toContain("'snapshot_at',snapshot_at");
    expect(contract).toContain('snapshot_at:z.string().datetime');
    expect(page).toContain('snapshot_at:data.snapshot_at');
  });
});
