import { describe, expect, it } from 'vitest';
import { buildIndividualNFSeDescription } from '@/lib/fiscal/nfseDescription';

describe('NFS-e individual description', () => {
  it('mentions only the invoice related to the current NFS-e', () => {
    const descriptions = ['546985', '547005', '547011'].map(number =>
      buildIndividualNFSeDescription(number, null)
    );

    expect(descriptions).toEqual([
      'Prestacao de servico de transporte referente a NF 546985',
      'Prestacao de servico de transporte referente a NF 547005',
      'Prestacao de servico de transporte referente a NF 547011',
    ]);
    expect(descriptions[0]).not.toContain('547005');
    expect(descriptions[1]).not.toContain('547011');
  });
});
