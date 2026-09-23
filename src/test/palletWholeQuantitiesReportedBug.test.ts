import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isPositiveWholePalletQuantity } from '@/lib/palletReturns/palletReturnImporter';

const page = readFileSync('src/pages/PalletReturns.tsx', 'utf8');
const createMigration = readFileSync('supabase/migrations/20260922017000_idempotent_pallet_protocol_creation.sql', 'utf8');
const editMigration = readFileSync('supabase/migrations/20260922019000_require_whole_pallet_edit_quantities.sql', 'utf8');

describe('whole pallet quantities', () => {
  it('accepts only safe positive integers in both editors', () => {
    expect(isPositiveWholePalletQuantity(1)).toBe(true);
    expect(isPositiveWholePalletQuantity(1.4)).toBe(false);
    expect(isPositiveWholePalletQuantity(0)).toBe(false);
    expect(isPositiveWholePalletQuantity(Number.NaN)).toBe(false);
    expect(page.match(/step=\{1\}/g)).toHaveLength(2);
    expect(page.match(/isPositiveWholePalletQuantity\(i\.quantity\)/g)).toHaveLength(2);
  });

  it('rejects fractional lines before both server totals and inserts', () => {
    for (const migration of [createMigration, editMigration]) {
      expect(migration).toContain('quantity<>trunc(');
      expect(migration).toContain('2147483647');
    }
    expect(editMigration.indexOf('quantity<>trunc(')).toBeLessThan(editMigration.indexOf('select coalesce(sum'));
    expect(editMigration).toContain('x.quantity::integer');
  });
});
