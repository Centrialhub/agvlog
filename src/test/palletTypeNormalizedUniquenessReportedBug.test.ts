import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizePalletTypeCode } from '@/hooks/usePalletReturns';

const hook = readFileSync('src/hooks/usePalletReturns.tsx', 'utf8');
const migration = readFileSync(
  'supabase/migrations/20260922018000_unique_normalized_pallet_type_codes.sql',
  'utf8',
);

describe('normalized pallet type code uniqueness', () => {
  it('normalizes whitespace and case consistently', () => {
    expect(normalizePalletTypeCode('  pbr ')).toBe('PBR');
  });

  it('preflights duplicates and enforces the same tenant-scoped rule atomically', () => {
    expect(hook).toContain('normalizePalletTypeCode(row.code) === code');
    expect(hook).toContain('Já existe um tipo de palete com o código');
    expect(migration).toContain('partition by tenant_id,upper(btrim(code))');
    expect(migration).toContain('on public.pallet_types(tenant_id,upper(btrim(code)))');
    expect(migration.indexOf('delete from public.pallet_types')).toBeLessThan(
      migration.indexOf('create unique index ux_pallet_types_tenant_code'),
    );
  });
});
