import{readFileSync}from'node:fs';import{describe,expect,it}from'vitest';
const page=readFileSync('src/pages/BillingEdi.tsx','utf8'),migration=readFileSync('supabase/migrations/20260922009000_validate_doccob_content_authoritatively.sql','utf8');
describe('authoritative DOCCOB content registration',()=>{it('parses and binds every browser file to authoritative billing rows',()=>{
 expect(page).toContain('const built = await generateDoccob(buildInput)');expect(page).toContain('contentHash: built.hash');expect(migration).toContain('doccob_record_count_mismatch');expect(migration).toContain('doccob_trailer_mismatch');expect(migration).toContain('doccob_invoice_line_mismatch');expect(migration).toContain('doccob_charge_lines_mismatch');expect(migration).toContain('doccob_detail_lines_mismatch');expect(migration).toContain('perform public.validate_doccob_content_v1');
});});
