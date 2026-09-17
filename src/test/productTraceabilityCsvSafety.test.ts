import { describe, expect, it } from 'vitest';
import { csvSafeCell } from '@/lib/csvSafety';

describe('bug 1072 do CSV de rastreabilidade', () => {
  it.each(['=CMD()', '+SUM(1;1)', '-10+20', '@IMPORT()', '\tformula'])('neutralizes spreadsheet formula prefix %s', value => {
    expect(csvSafeCell(value)).toContain(`'${value}`);
  });

  it('uses the shared safe-cell encoder for every exported field and header', async () => {
    const source = (await import('@/pages/ProductTraceability?raw')).default;
    expect(source).toContain('.map(csvSafeCell).join(\';\')');
    expect(source).toContain('headers.map(csvSafeCell)');
    expect(source).not.toContain('String(v).replace');
  });

  it('removes soft-deleted invoice metadata and resets filters across tenants', async () => {
    const source = (await import('@/pages/ProductTraceability?raw')).default;
    expect(source).toContain('pickup_order_id, deleted_at');
    expect(source).toContain('row.fiscal_documents?.deleted_at');
    expect(source).toContain('fiscal_document_id: null, fiscal_documents: null');
    expect(source).toContain('}, [currentTenant?.id]);');
    expect(source).toContain('setAppliedFilters(DEFAULT_FILTERS)');
  });
});
