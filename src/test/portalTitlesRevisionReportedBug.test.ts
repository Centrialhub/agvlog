import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('portal financial titles stable pagination', () => {
  it('binds later offset pages to the server revision of the ordered result set', () => {
    const migration = readFileSync(
      'supabase/migrations/20260921204000_portal_financial_titles_revision.sql',
      'utf8',
    );
    const hook = readFileSync('src/hooks/portal/usePortalFinancialTitles.ts', 'utf8');
    const page = readFileSync('src/pages/portal/PortalTitles.tsx', 'utf8');

    expect(migration).toContain('financial_titles_revision_changed');
    expect(migration).toContain("string_agg(");
    expect(migration).toContain("order by due_date asc nulls last, id");
    expect(hook).toContain("portal_list_financial_titles_v2");
    expect(hook).toContain('_revision: filters.revision');
    expect(page).toContain('revision: page > 0 ? revision : undefined');
    expect(page).toContain('A lista de títulos mudou enquanto você navegava.');
  });
});
