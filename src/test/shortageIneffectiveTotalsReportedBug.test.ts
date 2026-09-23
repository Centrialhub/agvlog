import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync('src/pages/MerchandiseShortages.tsx', 'utf8');
const migration = readFileSync('supabase/migrations/20260922025000_clear_ineffective_shortage_amounts.sql', 'utf8');

describe('ineffective shortage totals', () => {
  it('uses the effective case set for every economic KPI and responsibility group', () => {
    expect(page.match(/effectiveCases\.reduce/g)).toHaveLength(4);
    expect(page).toContain('effectiveCases.filter(c => c.responsible_party_type === r)');
    expect(page).not.toContain('casesData.filter(c => c.responsible_party_type === r)');
  });

  it('clears residual economic values for cancelled and disproved cases in the database', () => {
    expect(migration).toContain("new.status in ('cancelled','not_shortage')");
    expect(migration).toContain('new.amount_to_charge:=0');
    expect(migration).toContain('new.amount_written_off:=0');
    expect(migration).toContain('new.amount_reimbursed:=0');
    expect(migration).toContain("where status in ('cancelled','not_shortage')");
  });
});
