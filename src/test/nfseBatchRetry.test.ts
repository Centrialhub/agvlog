import { describe, expect, it } from 'vitest';
import { assertNFSeBatchRetryable } from '@/lib/fiscal/nfseBatchRetry';

describe('assertNFSeBatchRetryable', () => {
  it('permite recuperar rascunhos e falhas locais não definitivas', () => {
    expect(() => assertNFSeBatchRetryable([
      { rps_number: '120', status: 'draft' },
      { rps_number: '121', status: 'error' },
    ])).not.toThrow();
  });

  it('bloqueia retransmissão do mesmo RPS após rejeição definitiva', () => {
    expect(() => assertNFSeBatchRetryable([
      { rps_number: '115', invoice_number: '547015', status: 'rejected' },
    ])).toThrow(/RPS 115.*não pode ser retransmitida.*nova emissão/is);
  });
});
