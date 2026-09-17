import { describe, expect, it } from 'vitest';

describe('bugs 1076 e 1077 de devolução de paletes', () => {
  it('derives the total KPI from the same realized-status type totals', async () => {
    const source = (await import('@/pages/PalletReturns?raw')).default;
    expect(source).toContain('totalPallets: Object.values(totals).reduce');
    expect(source).not.toContain('totalPallets: protocols.reduce');
  });

  it('clears manual and import drafts when tenant changes', async () => {
    const source = (await import('@/pages/PalletReturns?raw')).default;
    expect(source).toContain('setSupplierId(\'\'); setSupplierName(\'\'); setIssueDate(localDateInputValue())');
    expect(source).toContain("setDriverName(''); setPlate(''); setItems([])");
    expect(source).toContain("setPreviewList([]); setImportFileName('importacao')");
    expect(source).toContain('}, [currentTenant?.id]);');
  });
});
