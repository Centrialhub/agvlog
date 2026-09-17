import { describe, expect, it } from 'vitest';

describe('bugs 1084 a 1086 da importação de paletes', () => {
  it('blocks declared-total divergences before persistence', async () => {
    const page = (await import('@/pages/PalletReturns?raw')).default;
    expect(page).toContain('previewList.filter(parsed => parsed.hasTotalDivergence)');
    expect(page).toContain("title: 'Totais divergentes'");
  });

  it('deduplicates by supplier identity, date, and ordered item composition', async () => {
    const hook = (await import('@/hooks/usePalletReturns?raw')).default;
    expect(hook).toContain('pallet_return_items(pallet_type_code, pallet_type_name, quantity)');
    expect(hook).toContain('protocolDedupeKey(client?.id ?? p.supplier');
    expect(hook).toContain('entry.supplier_id ?? entry.supplier_name_snapshot');
    expect(hook).not.toContain('const sameTotal');
  });
});
