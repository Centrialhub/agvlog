import {expect,it} from 'vitest';
import {parseInvoiceList} from '@/lib/financial/clientInvoiceList';
const tenant=crypto.randomUUID(),actor=crypto.randomUUID();
const original={id:crypto.randomUUID(),tenant_id:tenant,client_id:crypto.randomUUID(),invoice_number:'F-100',sequence_number:1,installment_number:1,issue_date:'2026-09-11',due_date:null,gross_amount:1.01,discount_amount:0,interest_amount:0,total_amount:1.01,status:'generated',notes:null,pdf_url:null,sent_at:null,receivable_id:null,cancelled_at:null,cancellation_reason:null,created_at:'2026-09-11T12:00:00Z',clients:null,received_amount:0.29,open_amount:0.72,requires_reconciliation:false};
function parse(patch:Partial<typeof original>={}){return parseInvoiceList({version:1,tenant_id:tenant,actor_id:actor,truncated:false,rows:[{...original,...patch}]},tenant,actor);}
it('uses exact decimal cents and accepts binary multiplication edge0.29',()=>{
 expect(parse().rows[0]).toMatchObject({received_amount:0.29,open_amount:0.72,total_amount:1.01});expect(parse({gross_amount:999999999999.99,total_amount:999999999999.99,received_amount:999999999999.98,open_amount:0.01}).rows[0].total_amount).toBe(999999999999.99);
});
it('rejects extra decimal precision even when both rounded totals coincide',()=>{
 expect(Math.round((0.29+0.714)*100)).toBe(Math.round(1.005*100));
 expect(()=>parse({total_amount:1.005,gross_amount:1.005,received_amount:0.29,open_amount:0.714})).toThrow();
 for(const field of ['gross_amount','discount_amount','interest_amount','total_amount','received_amount','open_amount'] as const){for(const value of [1.005,NaN,Infinity,-Infinity,-1,1000000000000])expect(()=>parse({[field]:value})).toThrow();}
 expect(()=>parse({received_amount:0.29,open_amount:0.73})).toThrow();
});
it('preserves unknown reconciliation and cancelled nominal without inventing settlement',()=>{
 const raw={...original,requires_reconciliation:true,received_amount:null,open_amount:null};const result=parseInvoiceList({version:1,tenant_id:tenant,actor_id:actor,truncated:false,rows:[raw]},tenant,actor);expect(result.rows[0]).toMatchObject({received_amount:null,open_amount:null,requires_reconciliation:true});
 expect(parse({status:'cancelled',received_amount:0,open_amount:0}).rows[0]).toMatchObject({total_amount:1.01,received_amount:0,open_amount:0});expect(()=>parse({status:'cancelled',received_amount:0,open_amount:1.01})).toThrow();
});
