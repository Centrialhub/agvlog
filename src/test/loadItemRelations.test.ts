import { describe, expect, it } from 'vitest';
import {
  LOAD_ITEM_FISCAL_DOCUMENT_RELATION,
  selectLoadItemFiscalDocument,
} from '@/lib/loads/loadItemRelations';

describe('load item fiscal-document relationship', () => {
  it('uses the tenant-scoped FK so PostgREST does not return PGRST201', () => {
    expect(LOAD_ITEM_FISCAL_DOCUMENT_RELATION)
      .toBe('fiscal_documents!load_items_fiscal_tenant_fkey');
    expect(selectLoadItemFiscalDocument('invoice_number, value'))
      .toBe('fiscal_documents!load_items_fiscal_tenant_fkey(invoice_number, value)');
  });
});
