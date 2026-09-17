import { describe, expect, it } from 'vitest';
import { parseTripCargoLoadDrafts, requireExactCargoDocuments } from '@/lib/driver/tripCargoConfirmation';

describe('bugs 589 a 592 da custódia de carga', () => {
  it('rejects empty and fractional pallet fields before upload', () => {
    expect(() => parseTripCargoLoadDrafts([
      { load_id: 'load-a', volume_count: '', pallet_count: '1', weight_kg: '20' },
    ], ['load-a'])).toThrow(/Volumes deve ser preenchido/);
    expect(() => parseTripCargoLoadDrafts([
      { load_id: 'load-a', volume_count: '10', pallet_count: '1.5', weight_kg: '20' },
    ], ['load-a'])).toThrow(/número inteiro/);
  });

  it('normalizes valid decimal fields without converting blanks to zero', () => {
    expect(parseTripCargoLoadDrafts([
      { load_id: 'load-a', volume_count: '10,25', pallet_count: '2', weight_kg: '100.50' },
    ], ['load-a'])).toEqual([{ load_id: 'load-a', volume_count: 10.25, pallet_count: 2, weight_kg: 100.5 }]);
  });

  it('requires the exact current load and document scopes', () => {
    expect(() => parseTripCargoLoadDrafts([], ['load-a'])).toThrow(/cargas da conferência mudaram/);
    expect(() => requireExactCargoDocuments(['doc-a'], ['doc-a', 'doc-b'])).toThrow(/Confirme todos os documentos/);
    expect(() => requireExactCargoDocuments(['doc-a', 'outside'], ['doc-a'])).toThrow(/Confirme todos os documentos/);
  });

  it('resets trip-scoped drafts and removes newly uploaded files after a failed confirmation', async () => {
    const source = (await import('@/pages/driver/DriverCargoCustody?raw')).default;
    expect(source).toContain('requestIds.current.clear()');
    expect(source).toContain('setEvidence(emptyEvidence())');
    expect(source).toContain("const identity = `${tripId}:${action}");
    expect(source).toContain("await removeSecureFiles(currentTenant.id, 'receipts', uploadedPaths)");
    expect(source).toContain('const activeEvidence = divergenceKind ? evidence : evidence.slice(0, 2)');
  });

  it('accepts stored and local base photos independently and cleans up partial seal resolution uploads', async () => {
    const source = (await import('@/pages/driver/DriverCargoCustody?raw')).default;
    expect(source).toContain("snapshot.evidence.some(item => item.evidence_kind === 'loading'))");
    expect(source).toContain("snapshot.evidence.some(item => item.evidence_kind === 'tie_down'))");
    expect(source).toContain('const uploadedPaths: string[] = []');
    expect(source).toContain("await removeSecureFiles(currentTenant.id, 'receipts', uploadedPaths)");
    expect(source.indexOf('for (const row of installed)')).toBeLessThan(source.indexOf('const items = await Promise.all(installed.map'));
  });
});
