import {expect,it} from 'vitest';
import {parseFinancialContext} from '@/lib/financial/receivableCommands';
const tenant=crypto.randomUUID(),actor=crypto.randomUUID(),receivable=crypto.randomUUID();
const original={version:1,tenant_id:tenant,actor_id:actor,receivable_id:receivable,invoice_id:null,report_id:null,reference:'Título 500',revision:'a'.repeat(32),status:'partial',amount_cents:50000,received_cents:40000,open_cents:10000,requires_reconciliation:false,reconciliation_reason:null,can_receive:true,can_reverse:false,can_reconcile:false,history_complete:true,payment_count:0,bank_accounts:[],payments:[]};
const parse=(value:unknown)=>parseFinancialContext(value,tenant,actor,receivable);
it('preserves legacy contexts and accepts credit settlement without inventing payments',()=>{
 expect(parse(original).cash_received_cents).toBeUndefined();
 const value=parse({...original,cash_received_cents:0,credit_applied_cents:40000,settled_cents:40000});
 expect(value.received_cents).toBe(40000);expect(value.payments).toEqual([]);expect(value.can_reverse).toBe(false);expect(value.open_cents).toBe(10000);
});
it('rejects incoherent credit projections and unknown projections capable of receiving',()=>{
 for(const extra of [{cash_received_cents:0},{cash_received_cents:0,credit_applied_cents:40000,settled_cents:39999},{cash_received_cents:null,credit_applied_cents:null,settled_cents:null}])expect(()=>parse({...original,...extra})).toThrow();
 expect(parse({...original,cash_received_cents:null,credit_applied_cents:null,settled_cents:null,can_receive:false}).settled_cents).toBeNull();
});
it('validates credit history revision and count as a compatible optional pair',()=>{
 expect(parse({...original,credit_revision:'b'.repeat(32),credit_application_count:2}).credit_application_count).toBe(2);
 for(const extra of [{credit_revision:'b'.repeat(32)},{credit_application_count:1},{credit_revision:'bad',credit_application_count:1},{credit_revision:'b'.repeat(32),credit_application_count:-1}])expect(()=>parse({...original,...extra})).toThrow();
});
