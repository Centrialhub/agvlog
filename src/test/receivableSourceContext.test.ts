import {expect,it} from 'vitest';
import {parseFinancialContext} from '@/lib/financial/receivableCommands';
const tenant='ac100000-0000-4000-8000-000000000001',actor='ac100000-0000-4000-8000-000000000002',title='ac100000-0000-4000-8000-000000000003';
const context={version:1,tenant_id:tenant,actor_id:actor,receivable_id:title,invoice_id:null,report_id:null,reference:'Descarga',revision:'a'.repeat(32),status:'partial',amount_cents:15000,received_cents:6000,open_cents:9000,requires_reconciliation:false,reconciliation_reason:null,can_receive:false,can_reverse:true,can_reconcile:false,history_complete:true,payment_count:0,bank_accounts:[],payments:[]};
const parse=(value:unknown)=>parseFinancialContext(value,tenant,actor,title);
it('keeps source review separate from balanced money and permits an existing refund',()=>{
 const parsed=parse({...context,source_issue:'finance_unloading_source_mismatch',source_revision:'b'.repeat(32)});
 expect(parsed.can_receive).toBe(false);expect(parsed.can_reverse).toBe(true);expect(parsed.requires_reconciliation).toBe(false);expect(parsed.received_cents).toBe(6000);
});
it('rejects a source warning that still permits receiving or lacks the source revision',()=>{
 for(const change of [{can_receive:true,source_revision:'b'.repeat(32)},{source_revision:null},{source_revision:undefined}])expect(()=>parse({...context,source_issue:'finance_unloading_source_mismatch',...change})).toThrow('incompatível');
});
it('accepts earlier contexts without source fields and rejects unknown source diagnostics',()=>{
 expect(parse(context).source_issue).toBeUndefined();expect(()=>parse({...context,source_issue:'unrecognized',source_revision:'b'.repeat(32)})).toThrow('incompatível');
});
