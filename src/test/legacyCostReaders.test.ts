// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import {beforeAll,beforeEach,afterEach,afterAll,it,expect} from 'vitest';
import {createLegacyExpenseCostDatabase} from './helpers/legacyExpenseCostDatabase';
import {financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
import {legacyCostContextSchema,legacyCostInventorySchema} from '@/lib/financial/legacyCostAssociationContract';
import {financeAuditSchema} from '@/lib/financial/financeAuditContract';
let db:PGlite;const trip=randomUUID();
beforeAll(async()=>{db=await createLegacyExpenseCostDatabase();await db.exec(readFileSync('supabase/migrations/20260910155523_finance_legacy_cost_readers.sql','utf8'));
 // Empty statement dependencies for the audit left joins; association events are real.
 await db.exec('create table finance_statement_imports(id uuid,tenant_id uuid,file_name text);create table finance_statement_rows(id uuid,tenant_id uuid,source_row integer)');
 for(const name of ['20260909233625_finance_audit_queries','20260910160822_finance_legacy_cost_manual_audit'])await db.exec(readFileSync(`supabase/migrations/${name}.sql`,'utf8'));
},30000);
beforeEach(async()=>{await db.exec('begin');await db.query("insert into dispatch_trips(id,tenant_id,driver_id,status,actual_end_at) values($1,$2,$3,'completed','2026-01-20T12:00:00Z')",[trip,i.tenant,i.driver]);});
afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
async function inventory(page=1,source='all'){return legacyCostInventorySchema.parse((await financeAs<{result:unknown}>(db,i.operator,'select get_finance_legacy_cost_inventory($1,$2,$3) result',[i.tenant,page,source])).rows[0].result);}
async function context(expense:string,page=1){return legacyCostContextSchema.parse((await financeAs<{result:unknown}>(db,i.operator,'select get_finance_legacy_expense_cost_context($1,$2,$3) result',[i.tenant,expense,page])).rows[0].result);}
async function seed(count=1){await db.query("insert into driver_expenses(id,tenant_id,dispatch_trip_id,driver_id,category,amount,expense_at,approval_status,reimbursable,payment_source,notes) select gen_random_uuid(),$1,$2,$3,'food',10,'2026-01-20T12:00:00Z','approved',false,'company','Despesa antiga '||n from generate_series(1,$4)n",[i.tenant,trip,i.driver,count]);return (await db.query<{id:string}>('select id from driver_expenses order by id limit 1')).rows[0].id;}
it('returns complete inventory counts above 1000 and keeps maintenance separate',async()=>{
 await seed(1005);await db.query("insert into maintenance_orders(tenant_id,order_number,total_cost,opened_at) values($1,'OS QA',50,'2026-01-20T12:00:00Z')",[i.tenant]);
 const first=await inventory(),last=await inventory(34);expect(first.total).toBe(1006);expect(first.rows).toHaveLength(30);expect(last.rows).toHaveLength(16);
 const maintenance=await inventory(1,'maintenance_orders');expect(maintenance).toMatchObject({total:1,coverage_complete:false});expect(maintenance.rows[0]).toMatchObject({source_table:'maintenance_orders',amount_cents:'5000',issue:'maintenance_components_require_review',active_link_id:null});
 expect((await inventory(1,'driver_expenses')).total).toBe(1005);
});
it('paginates real cost candidates with revisions and preserves association history',async()=>{
 const expense=await seed();const items=Array.from({length:31},()=>({id:randomUUID(),category:'food',description:'Refeição registrada',amount_cents:1000,occurred_on:'2026-01-20',supplier_name:'Restaurante QA',no_receipt_reason:'Recibo antigo em conferência',payee_type:'supplier',allocations:[]}));
 await financeAs(db,i.operator,'select record_finance_expense_batch($1::jsonb)',[JSON.stringify({version:1,tenant_id:i.tenant,request_id:randomUUID(),context:'trip',trip_id:trip,description:'Registro de gastos da viagem',reason:'Conferência dos registros antigos',items})]);
 const first=await context(expense),last=await context(expense,2);expect(first.total).toBe(31);expect(first.candidates).toHaveLength(30);expect(last.candidates).toHaveLength(1);expect(new Set([...first.candidates,...last.candidates].map(x=>x.cost_id)).size).toBe(31);
 const candidate=first.candidates[0];expect(candidate.issue).toBeNull();
 const command={version:1,tenant_id:i.tenant,request_id:randomUUID(),expense_id:expense,cost_id:candidate.cost_id,revision:candidate.revision,reason:'Conferi a identidade da despesa pelos documentos',same_expense_confirmed:true};
 await financeAs(db,i.operator,'select associate_finance_legacy_expense_cost($1::jsonb)',[JSON.stringify(command)]);
 const linked=await context(expense,2);expect(linked.active_link?.cost_id).toBe(candidate.cost_id);expect(linked.history.total).toBe(1);expect(linked.history.rows).toHaveLength(0);
 await financeAs(db,i.operator,'select reverse_finance_legacy_expense_cost_association($1::jsonb)',[JSON.stringify({version:1,tenant_id:i.tenant,request_id:randomUUID(),link_id:linked.active_link!.id,reason:'Associação incorreta após conferência adicional'})]);
 const reversed=await context(expense);expect(reversed.active_link).toBeNull();expect(reversed.history.rows[0].reversal?.actor_id).toBe(i.operator);expect(reversed.history.rows[0].actor_id).toBe(i.operator);
 const audit=financeAuditSchema.parse((await financeAs<{result:unknown}>(db,i.operator,'select list_finance_audit_events($1,$2::jsonb) result',[i.tenant,JSON.stringify({manual_only:true})])).rows[0].result);
 expect(audit.total).toBe(2);expect(audit.manual_count).toBe(2);expect(audit.rows.every(row=>row.manual_intervention&&row.actor_id===i.operator)).toBe(true);
 expect(new Set(audit.rows.map(row=>row.action))).toEqual(new Set(['legacy_expense_cost_associated','legacy_expense_cost_association_reversed']));
});
it('retains invalid dated/value sources and rejects foreign identities and driver access',async()=>{
 const expense=await seed();await db.query("update driver_expenses set expense_at='infinity',amount='NaN' where id=$1",[expense]);
 const row=(await inventory()).rows[0];expect(row.occurred_on).toBeNull();expect(row.amount_cents).toBeNull();expect(row.issue).toBeTruthy();
 await expect(context(randomUUID())).rejects.toThrow('finance_expense_not_found');await expect(inventory(0)).rejects.toThrow('finance_invalid_filters');
 await expect(financeAs(db,i.driverUser,'select get_finance_legacy_cost_inventory($1)',[i.tenant])).rejects.toThrow('finance_access_denied');
});
