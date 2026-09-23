import{readFileSync}from'node:fs';import{describe,expect,it}from'vitest';
const page=readFileSync('src/pages/BillingEdi.tsx','utf8'),hook=readFileSync('src/hooks/useBillingEdi.tsx','utf8');
describe('bounded DOCCOB generation batches',()=>{it('pages eligible invoices and chunks bundle filters',()=>{
 expect(hook).toContain('EDI_ELIGIBLE_PAGE_SIZE = 50');expect(hook).toContain("{count:'exact'}");expect(hook).toContain('index+=100');expect(hook).toContain('invoiceIds.slice(index,index+100)');expect(page).toContain('totalCount={eligibleTotal}');expect(page).toContain('setInvoicePage(1)');
});});
