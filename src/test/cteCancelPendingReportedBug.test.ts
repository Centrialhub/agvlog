import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mapOutboundStatus } from '@/hooks/useCteMonitor';
import { mapSearchOutboundStatus } from '@/hooks/useCteSearch';

describe('CT-e cancel_pending synchronization regression', () => {
  it('preserves cancel_pending in both fiscal status mappers', () => {
    expect(mapSearchOutboundStatus('authorized', 'cancel_pending', 'hub-1')).toBe('cancel_pending');
    expect(mapOutboundStatus('authorized', 'cancel_pending', 'hub-1')).toBe('cancel_pending');
  });

  it('includes cancel_pending rows in the search polling set', () => {
    const source = readFileSync('src/pages/CteSearch.tsx', 'utf8');
    const polling = source.slice(source.indexOf('const transientRows'), source.indexOf('if (transientRows.length'));

    expect(polling).toContain("r.sefaz_status === 'cancel_pending'");
  });
});
