import { describe, expect, it } from 'vitest';
import { allocateCurrency } from '@/lib/fiscal/nfseBatchAllocation';

describe('NFS-e individual currency allocation', () => {
  it('preserves every cent with deterministic largest-remainder allocation', () => {
    const entries = [
      { key: 'nf-c', weight: 1 },
      { key: 'nf-a', weight: 1 },
      { key: 'nf-b', weight: 1 },
    ];

    expect(allocateCurrency(0.01, entries)).toEqual({ 'nf-c': 0, 'nf-a': 0.01, 'nf-b': 0 });
    expect(allocateCurrency(0.01, [...entries].reverse())).toEqual({ 'nf-b': 0, 'nf-a': 0.01, 'nf-c': 0 });
  });

  it('allocates proportionally and keeps the exact original total', () => {
    const allocated = allocateCurrency(10.01, [
      { key: 'nf-1', weight: 100 },
      { key: 'nf-2', weight: 200 },
      { key: 'nf-3', weight: 300 },
    ]);

    expect(allocated).toEqual({ 'nf-1': 1.67, 'nf-2': 3.34, 'nf-3': 5 });
    expect(Object.values(allocated).reduce((sum, amount) => sum + amount, 0)).toBeCloseTo(10.01, 2);
  });

  it('falls back to equal shares when every service value is zero', () => {
    expect(allocateCurrency(1, [
      { key: 'nf-b', weight: 0 },
      { key: 'nf-a', weight: 0 },
      { key: 'nf-c', weight: 0 },
    ])).toEqual({ 'nf-b': 0.33, 'nf-a': 0.34, 'nf-c': 0.33 });
  });

  it('rejects negative totals and duplicate source keys', () => {
    expect(() => allocateCurrency(-0.01, [{ key: 'nf-1', weight: 1 }])).toThrow('Valor monetário inválido');
    expect(() => allocateCurrency(1, [{ key: 'nf-1', weight: 1 }, { key: 'nf-1', weight: 2 }])).toThrow('Chaves duplicadas');
  });
});
