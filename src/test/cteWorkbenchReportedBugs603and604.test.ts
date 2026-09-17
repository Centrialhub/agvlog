import { describe, expect, it } from 'vitest';

describe('bugs 603 e 604 do workbench de CT-e', () => {
  it('binds the calculated freight to the exact selected document snapshot', async () => {
    const source = (await import('@/components/loads/CTeWorkbench?raw')).default;
    expect(source).toContain('const selectionKey = useMemo');
    expect(source).toContain('ids: selectedDocs.map(document => document.id).sort()');
    expect(source).toContain('calculation?.selectionKey === selectionKey');
    expect(source).toContain('if (selectionKeyRef.current !== requestedSelection) return');
    expect(source).toContain('setCalculation(null)');
  });

  it('does not turn calculation failures into a valid zero-freight preview', async () => {
    const source = (await import('@/components/loads/CTeWorkbench?raw')).default;
    expect(source).not.toContain('setCalculatedFreight(0)');
    expect(source).toContain('result.value > 0');
    expect(source).toContain('disabled={!canPreview}');
    expect(source).toContain('!Number.isFinite(freightValue) || freightValue <= 0');
  });
});
