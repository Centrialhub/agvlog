// @vitest-environment node
import {randomUUID} from 'node:crypto';
import {recordedCostSummarySchema} from '@/lib/financial/recordedCostSummaryContract';
import {beforeAll,beforeEach,afterEach,afterAll,it,expect} from 'vitest';
import {createRecordedCostSummaryDatabase} from './helpers/recordedCostSummaryDatabase';
import {financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
let db:Awaited<ReturnType<typeof createRecordedCostSummaryDatabase>>;
type Summary=ReturnType<typeof recordedCostSummarySchema.parse>;
beforeAll(async()=>{db=await createRecordedCostSummaryDatabase();},30000);
beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
async function read(from:string|null=null,to:string|null=null,category:string|null=null,center:string|null=null,actor=i.operator){return recordedCostSummarySchema.parse((await financeAs<{result:Summary}>(db,actor,'select get_finance_recorded_cost_summary($1,$2,$3,$4,$5) result',[i.tenant,from,to,category,center ])).rows[0].result);}
async function batch(n=1,payable:string|null=null){
 const id=randomUUID();await db.query("insert into finance_expense_batches(id,tenant_id,context,description,created_by) values($1,$2,'office','QA',$3)",[id,i.tenant,i.operator]);
 await db.query("insert into finance_expense_items(id,tenant_id,batch_id,category,description,amount_cents,occurred_on,supplier_name,no_receipt_reason,payable_id,created_by) select gen_random_uuid(),$1,$2,'food','QA',101,'2026-01-01','Fornecedor','Comprovante solicitado',$4,$3 from generate_series(1,$5)",[i.tenant,id,i.operator,payable,n]);return id;
}
async function manual(created='2026-01-02T02:59:59Z',amount=100,center:string|null=null){
 const id=randomUUID();await db.query("insert into payables(id,tenant_id,amount,status,supplier_name,category) values($1,$2,$3,'pending','QA','other')",[id,i.tenant,amount]);
 await db.query("insert into finance_commands(tenant_id,request_id,actor_id,action,payload,result,created_at) values($1,$2,$3,'record_manual_expense',$4,$5,$6)",[i.tenant,randomUUID(),i.operator,JSON.stringify({category:'other',description:'Sede',amount_cents:amount*100,cost_center_id:center}),JSON.stringify({payable_id:id}),created]);return id;
}
it('aggregates 1005 costs without sample caps and keeps month/category balances',async()=>{
 await batch(1005);expect(await read()).toMatchObject({total_count:1005,total_cents:'101505',totals_valid:true,categories:[{category:'food',amount_cents:'101505'}],months:[{month:'2026-01',amount_cents:'101505'}],coverage_complete:false,excludes_bank_cash:true});
});
it('deduplicates the manual obligation by exact batch payable ID and excludes canceled manual costs',async()=>{
 const id=await manual();await batch(1,id);expect(await read()).toMatchObject({total_count:1,total_cents:'101'});
 const canceled=await manual();await db.query("update payables set status='cancelled' where id=$1",[canceled]);expect(await read()).toMatchObject({total_count:2,cancelled_count:1,total_cents:'101'});
});
it('uses Sao Paulo recorded-date fallback and filters category and unassigned center',async()=>{
 await manual();await manual('2026-01-02T03:00:00Z',20);
 expect(await read('2026-01-01','2026-01-01','other','unassigned')).toMatchObject({total_count:1,total_cents:'10000',recorded_date_count:1});
 expect(await read(null,null,'food')).toMatchObject({total_count:0,total_cents:'0'});
});
it('invalidates all totals for inconsistent obligations and does not hide nonfinite dates',async()=>{
 const id=await manual();await db.query('update payables set amount=50 where id=$1',[id]);await batch();
 const result=await read();expect(result).toMatchObject({invalid_count:1,total_cents:null,totals_valid:false});expect(result.categories.every(g=>g.amount_cents===null)).toBe(true);
 await manual('infinity');expect(await read('2026-01-01','2026-01-01')).toMatchObject({invalid_count:2,total_cents:null});
});
it('protects access and validates foreign centers and invalid dates',async()=>{
 await expect(read(null,null,null,null,i.driverUser)).rejects.toThrow('finance_access_denied');
 await db.query("insert into tenant_memberships values($1,$2,'operator',true)",[i.tenant,i.driverUser]);await expect(read(null,null,null,null,i.driverUser)).rejects.toThrow('finance_access_denied');
 await expect(read('infinity')).rejects.toThrow('finance_invalid_cost_filters');await expect(read(null,null,null,randomUUID())).rejects.toThrow('finance_invalid_cost_center');
});
async function payroll(){
 const period=randomUUID(),entry=randomUUID(),employee=randomUUID();
 await db.query("insert into employees(id,tenant_id,name) values($1,$2,'QA')",[employee,i.tenant]);
 await db.query("insert into payroll_periods(id,tenant_id,status,period_start,period_end,period_name) values($1,$2,'approved','2026-01-01','2026-01-31','QA')",[period,i.tenant]);
 await db.query("insert into payroll_entries(id,tenant_id,payroll_period_id,employee_id,status,entry_type) values($1,$2,$3,$4,'approved','employee')",[entry,i.tenant,period,employee]);
 const add=async(type:string,nature:string,amount:number)=>db.query("insert into payroll_entry_items(id,tenant_id,payroll_period_id,payroll_entry_id,employee_id,item_type,nature,description,amount) values(gen_random_uuid(),$1,$2,$3,$4,$5,$6,'QA',$7)",[i.tenant,period,entry,employee,type,nature,amount]);
 return {period,entry,employee,add};
}
it('includes remuneration once and does not count paid advances, discounts or payroll payables',async()=>{
 const p=await payroll();await p.add('base_salary','credit',3000);await p.add('commission','credit',50);await p.add('driver_advance','already_paid',1000);await p.add('other','discount',50);
 await db.query("insert into payables(id,tenant_id,supplier_name,category,amount,status,source_table,source_id) values(gen_random_uuid(),$1,'QA','payroll',2000,'approved','payroll_entries',$2)",[i.tenant,p.entry]);
 expect(await read()).toMatchObject({total_count:2,total_cents:'305000',payroll_unclassified_count:0});
 await db.query("update payroll_periods set status='draft' where id=$1",[p.period]);expect(await read()).toMatchObject({total_count:0,total_cents:'0'});
});
it('surfaces unclassified payroll credits instead of double counting reimbursements and settlements',async()=>{
 const p=await payroll();await p.add('base_salary','credit',3000);await p.add('driver_expense_reimbursement','credit',200);await p.add('driver_settlement','credit',500);
 expect(await read()).toMatchObject({total_count:3,payroll_unclassified_count:2,invalid_count:2,totals_valid:false,total_cents:null});
 expect(await read(null,null,'food')).toMatchObject({total_count:0,totals_valid:true,total_cents:'0'});
});
it('filters exact tenant centers and excludes other tenants canonical costs',async()=>{
 const center=randomUUID();await db.query("insert into cost_centers(id,tenant_id,name) values($1,$2,'Sede')",[center,i.tenant]);
 await manual(undefined,100,center);await manual(undefined,25);
 expect(await read(null,null,null,center)).toMatchObject({total_count:1,total_cents:'10000',cost_centers:[{cost_center_id:center,cost_center_name:'Sede',amount_cents:'10000'}]});
 expect(await read(null,null,null,'unassigned')).toMatchObject({total_count:1,total_cents:'2500'});
 await db.query("insert into finance_expense_batches(id,tenant_id,context,description,created_by) values(gen_random_uuid(),$1,'office','Outro tenant',$2)",[i.otherTenant,i.operator]);
 await db.query("insert into finance_expense_items(id,tenant_id,batch_id,category,description,amount_cents,occurred_on,supplier_name,no_receipt_reason,created_by) select gen_random_uuid(),$1,id,'food','Outro tenant',999999,'2026-01-01','Outro','Comprovante solicitado',$2 from finance_expense_batches where tenant_id=$1",[i.otherTenant,i.operator]);
 expect(await read()).toMatchObject({total_count:2,total_cents:'12500'});
});
