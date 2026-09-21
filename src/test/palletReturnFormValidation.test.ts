import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/pages/PalletReturns.tsx', 'utf8');

describe('pallet return form validation', () => {
  it('blocks invalid or concurrent protocol creation', () => {
    expect(source).toContain('const newProtocolInvalid =');
    expect(source).toContain('if (createLock.current || createMut.isPending) return');
    expect(source).toContain('disabled={newProtocolInvalid || createMut.isPending}');
    expect(source).toContain('(client?.company_name || supplierName).trim()');
  });

  it('describes every pallet return dialog', () => {
    expect(source.match(/<DialogContent/g)).toHaveLength(4);
    expect(source.match(/<DialogDescription>/g)).toHaveLength(4);
  });
});
