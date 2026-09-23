import{readFileSync}from'node:fs';import{describe,expect,it}from'vitest';
const page=readFileSync('src/pages/LoadExtractionAudit.tsx','utf8');
describe('load extraction audit boundaries',()=>{
 it('reads only active inbound invoices',()=>{expect(page).toContain(".is('deleted_at', null)");expect(page).toContain(".in('document_type', ['nfe','inbound'])");});
 it('neutralizes every exported spreadsheet cell',()=>{expect(page).toContain("import { csvSafeCell }");expect(page).toContain("r.map(csvSafeCell).join(';')");});
 it('clears tenant-captured filters and dialogs',()=>{expect(page).toContain('setOpenDoc(null)');expect(page).toContain('setClientFilter(SENTINEL_ALL)');expect(page).toContain('[currentTenant?.id]');});
});
