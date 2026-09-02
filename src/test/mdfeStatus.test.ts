import { describe, expect, it } from 'vitest';
import { canCloseMdfe, canDownloadMdfe, normalizeMdfeStatus } from '@/lib/fiscal/mdfeStatus';

describe('MDF-e lifecycle presentation', () => {
  it('normalizes provider and closure states', () => {
    expect(normalizeMdfeStatus('authorized')).toBe('authorized');
    expect(normalizeMdfeStatus('encerrado')).toBe('closed');
    expect(normalizeMdfeStatus('interrupted')).toBe('provider_unknown');
    expect(normalizeMdfeStatus('cancel_processing')).toBe('closing');
  });

  it('allows closure and official files only in safe states', () => {
    expect(canCloseMdfe('authorized')).toBe(true);
    expect(canCloseMdfe('closing')).toBe(false);
    expect(canDownloadMdfe('authorized')).toBe(true);
    expect(canDownloadMdfe('closed')).toBe(true);
    expect(canDownloadMdfe('rejected')).toBe(false);
  });
});
