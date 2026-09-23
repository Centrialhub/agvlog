import { describe, expect, it } from 'vitest';
import { mapOutboundStatus } from '@/hooks/useCteMonitor';
import { mapSearchOutboundStatus } from '@/hooks/useCteSearch';

describe('timeout sem prova de autorização do CT-e', () => {
  it.each([null, 'hub-document-id'])('continua como falha mesmo com identificador remoto %s', (hubId) => {
    expect(mapOutboundStatus('error', 'status_timeout', hubId)).toBe('processed_error');
    expect(mapSearchOutboundStatus('error', 'status_timeout', hubId)).toBe('sefaz_error');
  });

  it('ainda reconhece autorização fiscal explícita', () => {
    expect(mapOutboundStatus('authorized', 'authorized', 'hub-document-id')).toBe('processed');
    expect(mapSearchOutboundStatus('authorized', 'authorized', 'hub-document-id')).toBe('processed');
  });
});
