// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,beforeEach,afterEach,it,expect} from 'vitest';
import {createCashForecastCollectorDatabase} from './helpers/cashForecastCollectorDatabase';
import {financeIds as i,financeAs} from './helpers/financeLedgerDatabase';
import {financeAuditSchema,financeAuditActions} from '@/lib/financial/financeAuditContract';
let db:Awaited<ReturnType<typeof createCashForecastCollectorDatabase>>;
const current=()=>readFileSync('supabase/migrations/20260911094523_finance_current_manual_audit_actions.sql','utf8');
const actions=['unloading_cost_regularized','cost_disposition_return_recorded','unloading_open_complement_corrected','payable_approved_with_revision','cash_forecast_preserved','unloading_open_complement_extinguished'];
beforeAll(async()=>{db=await createCashForecastCollectorDatabase();await db.exec(readFileSync('docs/qa/finance-manual-audit-predecessor-2026-09-11.sql','utf8'));},30000);
beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>db.exec('rollback'));afterAll(async()=>db?.close());
async function seed(action:string,tenant=i.tenant){await db.query("insert into finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,after_data) values($1,'expense_item',$2,$3,$4,'Responsavel QA','Conferencia registrada',$5)",[tenant,randomUUID(),action,i.operator,{}]);}
async function query(filters:Record<string,unknown>={}){return financeAuditSchema.parse((await financeAs<{v:unknown}>(db,i.operator,'select list_finance_audit_events($1,$2) v',[i.tenant,filters])).rows[0].v);}
it('makes new manual events visible to the same manual filter and preserves actor/reason and old bank classifications',async()=>{
 for(const action of [...actions,'bank_reconciled_manually','bank_reconciled_automatically'])await seed(action);
 const before=await query({manual_only:true});expect(before.rows.map(x=>x.action)).toEqual(['bank_reconciled_manually']);
 await db.exec(current());const after=await query({manual_only:true});expect(after.total).toBe(7);expect(after.manual_count).toBe(7);for(const row of after.rows){expect(row).toMatchObject({manual_intervention:true,actor_id:i.operator,actor_name:'Responsavel QA',reason:'Conferencia registrada'});expect(financeAuditActions[row.action]).toBeTruthy();}
 expect((await query()).rows.find(x=>x.action==='bank_reconciled_automatically')?.manual_intervention).toBe(false);
});
it('paginates exact manual totals, combines action/actor filters and isolates companies',async()=>{
 await db.exec(current());for(let n=0;n<31;n++)await seed(actions[n%actions.length]);await seed(actions[0],i.otherTenant);
 const one=await query({manual_only:true,page:1,page_size:30}),two=await query({manual_only:true,page:2,page_size:30});expect(one.total).toBe(31);expect(one.rows).toHaveLength(30);expect(two.rows).toHaveLength(1);
 const filtered=await query({manual_only:true,action:actions[0],actor_id:i.operator});expect(filtered.total).toBe(6);expect(filtered.rows.every(x=>x.action===actions[0]&&x.tenant_id===i.tenant)).toBe(true);
 await expect(financeAs(db,i.driverUser,'select list_finance_audit_events($1,$2)',[i.tenant,{}])).rejects.toMatchObject({code:'42501'});
 await expect(financeAs(db,i.operator,'select list_finance_audit_events($1,$2)',[i.otherTenant,{}])).rejects.toMatchObject({code:'42501'});
});
it('rejects a changed predecessor rather than rewriting an unknown audit query',async()=>{
 await db.exec("alter function finance_private.audit_events(uuid,jsonb) volatile");await expect(db.exec(current())).rejects.toMatchObject({code:'55000'});
});
