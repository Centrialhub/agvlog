import{readFileSync}from'node:fs';import{describe,expect,it}from'vitest';
const migration=readFileSync('supabase/migrations/20260922015000_audit_payable_material_edits.sql','utf8');
describe('payable material edit audit',()=>{
 it('records actor plus complete before and after versions',()=>{expect(migration).toContain('add column if not exists updated_by uuid');expect(migration).toContain('new.updated_by:=auth.uid()');expect(migration).toContain("'payable',new.id,'material_update',to_jsonb(old),to_jsonb(new),auth.uid(),'payable_editor'");});
 it('covers every field exposed by the direct editor, including status',()=>{for(const field of ['supplier_name','category','description','amount','due_date','competence_date','document_number','status','notes'])expect(migration).toContain(`old.${field}`);});
});
