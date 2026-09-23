import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { returnSheetCompanyHeader } from '@/lib/occurrences/occurrenceReturnSheetPdf';

const page = readFileSync('src/pages/OccurrenceReturnSheet.tsx', 'utf8');
const pdf = readFileSync('src/lib/occurrences/occurrenceReturnSheetPdf.ts', 'utf8');
const migration = readFileSync('supabase/migrations/20260922022000_snapshot_return_sheet_company_header.sql', 'utf8');

describe('occurrence return sheet company snapshot', () => {
  it('builds the header only from immutable snapshot fields', () => {
    expect(returnSheetCompanyHeader({
      name: 'Nome antigo', trade_name: 'Fantasia antiga', legal_name: 'Razão antiga',
      tax_id: '00.000.000/0001-00', city: 'São Paulo', state: 'SP', phone: '1100000000',
    }, 'Nome vivo')).toEqual(expect.objectContaining({
      name: 'Fantasia antiga', taxId: '00.000.000/0001-00', city: 'São Paulo', state: 'SP', phone: '1100000000',
    }));
    expect(pdf).not.toContain('companyInfo');
    expect(page).not.toContain('useCompanyProfile');
  });

  it('captures the full tenant company profile when a sheet is inserted', () => {
    expect(migration).toContain("tenant.settings->'company'");
    expect(migration).toContain("nullif(v_profile->>'trade_name','')");
    expect(migration).toContain("nullif(v_profile->>'legal_name','')");
    expect(migration).toContain("before insert on public.occurrence_return_sheets");
  });
});
