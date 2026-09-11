// @vitest-environment node
import {randomUUID} from 'node:crypto';
import {beforeAll,beforeEach,afterEach,afterAll,it,expect} from 'vitest';
import {createLegacyExpenseCostDatabase} from './helpers/legacyExpenseCostDatabase';
import {financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
let db:Awaited<ReturnType<typeof createLegacyExpenseCostDatabase>>;
beforeAll(async()=>{db=await createLegacyExpenseCostDatabase();},30000);
beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
async function seed(){
 const trip=randomUUID(),expense=randomUUID(),cost=randomUUID();
 await db.query("insert into dispatch_trips(id,tenant_id,driver_id,status,actual_end_at) values($1,$2,$3,'completed','2026-01-20T12:00:00Z')",[trip,i.tenant,i.driver]);
 await db.query("insert into driver_expenses(id,tenant_id,driver_id,dispatch_trip_id,category,amount,expense_at,approval_status,reimbursable,payment_source) values($1,$2,$3,$4,'food',50,'2026-01-20T12:00:00Z','approved',false,'company_account')",[expense,i.tenant,i.driver,trip]);
 const payload={version:1,tenant_id:i.tenant,request_id:randomUUID(),context:'trip',trip_id:trip,description:'Despesas conferidas',reason:'Conferência no retorno',items:[{id:cost,category:'food',amount_cents:5000,description:'Alimentação',occurred_on:'2026-01-20',supplier_name:'Restaurante QA',payee_type:'supplier',no_receipt_reason:'Recibo solicitado',allocations:[]}]};
 await financeAs(db,i.operator,'select record_finance_expense_batch($1)',[payload]);return{trip,expense,cost};
}
async function revision(e:string,c:string){return (await db.query<{v:string}>('select finance_private.legacy_expense_cost_revision($1,$2,$3) v',[i.tenant,e,c])).rows[0].v;}
async function payload(s:Awaited<ReturnType<typeof seed>>){return{version:1,tenant_id:i.tenant,request_id:randomUUID(),expense_id:s.expense,cost_id:s.cost,revision:await revision(s.expense,s.cost),reason:'Conferi os recibos da mesma despesa',same_expense_confirmed:true};}
async function link(p:Record<string,unknown>,actor=i.operator){return (await financeAs<{v:Record<string,unknown>}>(db,actor,'select associate_finance_legacy_expense_cost($1) v',[p])).rows[0].v;}
async function reverse(id:unknown){return (await financeAs<{v:Record<string,unknown>}>(db,i.operator,'select reverse_finance_legacy_expense_cost_association($1) v',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),link_id:id,reason:'Vínculo incorreto identificado na revisão'}])).rows[0].v;}
async function build(trip:string){return(await db.query<{v:string}>('select _build_driver_settlement($1,$2) v',[i.tenant,trip])).rows[0].v;}
it('associates a real unpaid canonical cost without creating or changing money or obligations; replay is exact',async()=>{
 const s=await seed(),p=await payload(s);const before=(await db.query('select * from payables')).rows;
 const result=await link(p);expect(result).toMatchObject({expense_id:s.expense,cost_id:s.cost,amount_cents:'5000',cash_created:false,obligation_created:false,confirmed:true});expect(await link(p)).toEqual(result);
 expect((await db.query('select * from payables')).rows).toEqual(before);expect((await db.query('select count(*)::int n from finance_movements')).rows[0]).toEqual({n:0});
 expect((await db.query('select count(*)::int n from finance_legacy_expense_cost_links')).rows[0]).toEqual({n:1});
});
it('removes only the duplicate canonical representation on actual settlement rebuild, preserving legacy expense identity and reimbursement',async()=>{
 const s=await seed();const reimb=randomUUID();await db.query("insert into driver_expenses(id,tenant_id,driver_id,dispatch_trip_id,category,amount,expense_at,approval_status,reimbursable,payment_source) values($1,$2,$3,$4,'food',25,'2026-01-20T12:00:00Z','approved',true,'driver')",[reimb,i.tenant,i.driver,s.trip]);
 const settlement=await build(s.trip);expect(Number((await db.query<{expenses_total:string}>('select expenses_total from driver_settlements where id=$1',[settlement])).rows[0].expenses_total)).toBe(125);
 await link(await payload(s));expect((await db.query('select needs_recalculation from driver_settlements where id=$1',[settlement])).rows[0]).toEqual({needs_recalculation:true});
 await build(s.trip);expect((await db.query('select expenses_total,driver_reimbursement_total from driver_settlements where id=$1',[settlement])).rows[0]).toEqual({expenses_total:'75',driver_reimbursement_total:'25'});
 expect((await db.query("select source_table,source_id from driver_settlement_items where settlement_id=$1 and item_type='expense'",[settlement])).rows).toEqual(expect.arrayContaining([{source_table:'driver_expenses',source_id:s.expense},{source_table:'driver_expenses',source_id:reimb}]));
});
it('rejects another obligation materialized from the same legacy expense instead of marking it paid',async()=>{
 const s=await seed();await db.query("insert into payables(id,tenant_id,supplier_name,category,amount,status,source_table,source_id) values(gen_random_uuid(),$1,'Outro título','other',50,'pending','driver_expenses',$2)",[i.tenant,s.expense]);
 await expect(link(await payload(s))).rejects.toThrow('finance_legacy_cost_obligation_conflict');expect((await db.query('select count(*)::int n from payables')).rows[0]).toEqual({n:2});
});
it('requires a fresh combined revision after the existing obligation changes',async()=>{
 const s=await seed(),p=await payload(s);await db.query("update payables set notes='Contexto revisado do título' where id=(select payable_id from finance_expense_items where id=$1)",[s.cost]);
 await expect(link(p)).rejects.toThrow('finance_legacy_cost_changed');
});
it('protects approved payroll and preserves the entire source after association reversal',async()=>{
 const s=await seed(),result=await link(await payload(s));await reverse(result.link_id);
 await db.exec('savepoint source_history');await expect(db.query("update driver_expenses set notes='Corrigir origem histórica' where id=$1",[s.expense])).rejects.toThrow('finance_legacy_cost_source_immutable');await db.exec('rollback to savepoint source_history');
 const period=randomUUID(),employee=randomUUID();await db.query("insert into employees(id,tenant_id,name) values($1,$2,'Funcionário')",[employee,i.tenant]);
 await db.query("insert into payroll_periods(id,tenant_id,period_name,period_start,period_end,status) values($1,$2,'Janeiro','2026-01-01','2026-01-31','draft')",[period,i.tenant]);
 await db.query("insert into payroll_entries(id,tenant_id,payroll_period_id,employee_id,driver_id,status,entry_type) values(gen_random_uuid(),$1,$2,$3,$4,'approved','driver')",[i.tenant,period,employee,i.driver]);
 await db.query("update payroll_periods set status='approved' where id=$1",[period]);
 await expect(link(await payload(s))).rejects.toThrow('finance_legacy_cost_payroll_protected');
});
it('reverses only the association and retains immutable history and payment evidence',async()=>{
 const s=await seed(),first=await link(await payload(s));const before=(await db.query('select * from payables')).rows;
 expect(await reverse(first.link_id)).toMatchObject({cash_changed:false,obligation_changed:false,confirmed:true});
 expect((await db.query('select * from payables')).rows).toEqual(before);const second=await link(await payload(s));expect(second.link_id).not.toBe(first.link_id);
 expect((await db.query('select count(*)::int n from finance_legacy_expense_cost_links')).rows[0]).toEqual({n:2});
});
it('refuses reimbursement instead of hiding a driver credit',async()=>{
 const s=await seed();await db.query('update driver_expenses set reimbursable=true where id=$1',[s.expense]);await expect(link(await payload(s))).rejects.toThrow('finance_legacy_expense_reimbursement_requires_review');
});
it('rejects mismatched centavos and stale source revision',async()=>{
 const s=await seed(),p=await payload(s);await db.query('update driver_expenses set amount=51 where id=$1',[s.expense]);await expect(link(p)).rejects.toThrow('finance_legacy_cost_changed');await expect(link(await payload(s))).rejects.toThrow('finance_legacy_cost_source_mismatch');
});
it('does not rewrite protected settlement snapshots on association or reversal',async()=>{
 const s=await seed(),settlement=await build(s.trip);await db.query("update driver_settlements set status='approved' where id=$1",[settlement]);const before=(await db.query('select * from driver_settlements where id=$1',[settlement])).rows;
 await expect(link(await payload(s))).rejects.toThrow('finance_legacy_cost_settlement_protected');expect((await db.query('select * from driver_settlements where id=$1',[settlement])).rows).toEqual(before);
});
it('requires an explicit identity declaration, rejects drivers, and prevents two active targets',async()=>{
 const s=await seed(),p=await payload(s);await expect(link({...p,same_expense_confirmed:false})).rejects.toThrow('finance_invalid_payload');await expect(link(p,i.driverUser)).rejects.toThrow('finance_access_denied');
 await link(p);await expect(link({...p,request_id:randomUUID(),revision:await revision(s.expense,s.cost)})).rejects.toThrow('finance_legacy_cost_already_associated');
 await db.exec('savepoint immutable_source');await expect(db.query('update driver_expenses set amount=51 where id=$1',[s.expense])).rejects.toThrow('finance_legacy_cost_source_immutable');await db.exec('rollback to savepoint immutable_source');
});
