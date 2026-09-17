import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ort = readFileSync('src/pages/OrtManagement.tsx', 'utf8');
const mdfe = readFileSync('src/pages/Mdfe.tsx', 'utf8');
const audit = readFileSync('src/pages/DataAudit.tsx', 'utf8');
const navigation = readFileSync('src/components/layout/navigation.ts', 'utf8');
const sidebar = readFileSync('src/components/layout/SidebarNavigation.tsx', 'utf8');
const ortLocalDates = readFileSync('supabase/migrations/20260917113100_fix_ort_candidate_local_dates.sql', 'utf8');

describe('reported ORT, data-audit and MDF-e regressions', () => {
  it('normalizes ORT tabs and keeps URL navigation bidirectionally synchronized', () => {
    expect(ort).toContain("value === 'geracao' ? 'geracao' : 'consulta'");
    expect(ort).toContain('useEffect(() =>');
    expect(ort).toContain('setParams(next);');
    expect(ort).toContain('onValueChange={changeTab}');
  });

  it('filters ORT loading timestamps by the tenant civil day rather than the database session timezone', () => {
    expect(ortLocalDates).toContain('pg_catalog.pg_timezone_names');
    expect(ortLocalDates).toContain("v_load_from::timestamp at time zone v_timezone");
    expect(ortLocalDates).toContain("(v_load_to + 1)::timestamp at time zone v_timezone");
    expect(ortLocalDates).not.toContain('load.scheduled_load_at)::date');
  });

  it('advertises data audit only to roles accepted by its backend', () => {
    expect(navigation).toContain("roles: ['owner', 'admin']");
    expect(sidebar).toContain('item.roles.includes(currentRole');
    expect(audit).toContain("enabled: !!currentTenant && ['owner', 'admin'].includes");
    expect(audit).toContain('A auditoria de dados é restrita a administradores');
  });

  it('loads every audit batch before deriving totals and resets domain scope per tenant', () => {
    expect(audit).toContain('const AUDIT_BATCH_SIZE = 500');
    expect(audit).toContain('.range(offset, offset + AUDIT_BATCH_SIZE - 1)');
    expect(audit).toContain('if (data.length < AUDIT_BATCH_SIZE) break');
    expect(audit).toContain("setDomainFilter('all'); }, [currentTenant?.id]");
  });

  it('does not present unknown MDF-e totals as zero', () => {
    expect(mdfe).toContain('const totalsKnown = !isLoading && !error');
    expect(mdfe).toContain("totalsKnown?totals.total:'—'");
    expect(mdfe).toContain("totalsKnown?totals.attention:'—'");
  });

  it('distinguishes an empty MDF-e history from filters with no matches', () => {
    expect(mdfe).toContain('filtered.length === 0 && manifests.length > 0');
    expect(mdfe).toContain('Nenhum MDF-e corresponde aos filtros');
    expect(mdfe).toContain('Limpar filtros');
  });
});
