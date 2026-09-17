import { describe, expect, it } from 'vitest';
import { resolveNFSeNationalServiceCode } from '@/lib/fiscal/nfseServiceCode';

describe('NFS-e national service code', () => {
  it.each(['2010', '16.02'])('maps legacy transport code %s to 160201', code => {
    expect(resolveNFSeNationalServiceCode(code)).toBe('160201');
  });

  it('preserves an explicit six-digit national code', () => {
    expect(resolveNFSeNationalServiceCode('16.02.01')).toBe('160201');
  });

  it('does not invent a mapping for an unrelated legacy code', () => {
    expect(resolveNFSeNationalServiceCode('11.04')).toBe('');
  });
});
