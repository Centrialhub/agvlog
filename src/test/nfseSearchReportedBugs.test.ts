import { describe, expect, it } from 'vitest';
import {
  canCancelNFSeStatus,
  canRecoverNFSeStatus,
  isExactNFSeSelection,
  reconcileNFSeSelection,
  validateNFSeDateRange,
} from '@/lib/fiscal/nfseList';

describe('reported NFS-e search regressions', () => {
  it('rejects an inverted date interval', () => {
    expect(validateNFSeDateRange('2026-09-20', '2026-09-10')).toContain('posterior');
    expect(validateNFSeDateRange('2026-09-10', '2026-09-20')).toBeNull();
  });

  it('compares selection ids instead of only their count', () => {
    expect(isExactNFSeSelection(new Set(['hidden']), ['visible'])).toBe(false);
    expect(isExactNFSeSelection(new Set(['a', 'b']), ['a', 'b'])).toBe(true);
    expect([...reconcileNFSeSelection(new Set(['a', 'hidden']), ['a', 'b'])]).toEqual(['a']);
  });

  it('allows cancellation only after authorization', () => {
    expect(canCancelNFSeStatus('issued')).toBe(true);
    expect(canCancelNFSeStatus('authorized')).toBe(true);
    for (const status of ['draft', 'rejected', 'error', 'processing', 'cancelled']) {
      expect(canCancelNFSeStatus(status)).toBe(false);
    }
  });

  it('never retries a definitive rejection from the list', () => {
    expect(canRecoverNFSeStatus('rejected')).toBe(false);
    expect(canRecoverNFSeStatus('error')).toBe(true);
  });
});
