import {readFileSync} from 'node:fs';import{describe,expect,it}from'vitest';
const page=readFileSync('src/pages/BillingEdi.tsx','utf8'),hook=readFileSync('src/hooks/useBillingEdi.tsx','utf8');
describe('bounded DOCCOB history',()=>{it('pages metadata without eagerly loading TXT bodies',()=>{
 expect(hook).toContain('EDI_HISTORY_PAGE_SIZE = 30');expect(hook).not.toContain(".select('*')\n        .eq('tenant_id', currentTenant!.id).order('generated_at'");expect(hook).toContain(".select('generated_content')");expect(page).toContain('<DataPagination page={page}');expect(page).toContain('fetchEdiExportContent');
});});
