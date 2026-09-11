// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {beforeAll,beforeEach,afterEach,afterAll,it,expect} from 'vitest';
import {createCashPeriodCloseDatabase} from './helpers/cashPeriodCloseDatabase';
import {financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
import {cashPeriodCountResultSchema,cashPeriodCountHistorySchema} from '@/lib/financial/cashPeriodContract';
import {financeAuditSchema} from '@/lib/financial/financeAuditContract';
let db:Awaited<ReturnType<typeof createCashPeriodCloseDatabase>>;
const end='2026-08-31';
beforeAll(async()=>{db=await createCashPeriodCloseDatabase();for(const file of ['20260910165830_finance_period_manual_audit.sql','20260910174142_finance_cash_period_count_readers.sql','20260910174822_finance_cash_period_manual_audit.sql'])await db.exec(readFileSync(`supabase/migrations/${file}`,'utf8'));},30000);
beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);await db.query("update bank_accounts set account_type='cash' where id=$1",[i.account]);});
afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
async function history(page=1,day=end){return cashPeriodCountHistorySchema.parse((await financeAs<{v:unknown}>(db,i.operator,'select get_finance_cash_period_counts($1,$2,$3,$4) v',[i.tenant,i.account,day,page])).rows[0].v);}
async function count(quantity=1){return cashPeriodCountResultSchema.parse((await financeAs<{v:unknown}>(db,i.operator,'select record_finance_cash_period_count($1) v',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),account_id:i.account,period_end:end,counts:[{denomination_cents:100,quantity}],custodian_name:'Responsável pelo caixa',reason:'Contagem física registrada após conferência',counted_at_boundary:'end_of_day'}])).rows[0].v);}
async function reverse(c:Awaited<ReturnType<typeof count>>){await financeAs(db,i.operator,'select reverse_finance_cash_period_count($1)',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),count_id:c.count_id,revision:c.revision,reason:'Contagem corrigida mantendo o registro original'}]);}
it('paginates real count corrections and preserves the active selection outside the requested page',async()=>{
 for(let n=0;n<30;n++){const c=await count(n);await reverse(c);}const active=await count(31);
 const first=await history(),second=await history(2),empty=await history(3);
 expect(first.total).toBe(31);expect(first.rows).toHaveLength(30);expect(second.rows).toHaveLength(1);expect(empty.rows).toEqual([]);
 for(const page of [first,second,empty]){expect(page.active_count_id).toBe(active.count_id);expect(page.can_record).toBe(false);}
 const rows=[...first.rows,...second.rows];expect(new Set(rows.map(row=>row.id)).size).toBe(31);
 expect(rows.filter(row=>row.reversal!==null)).toHaveLength(30);expect(rows.find(row=>row.id===active.count_id)).toMatchObject({total_cents:'3100',can_reverse:true,actor_id:i.operator});
 expect(rows.filter(row=>row.reversal!==null).every(row=>!row.can_reverse&&row.reversal?.actor_id===i.operator)).toBe(true);
},30000);
it('keeps zero counts and operator capabilities distinct from administrative reversal',async()=>{
 expect((await history()).can_record).toBe(true);const c=await count(0);await db.query("update tenant_memberships set role='operator' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);
 const result=await history();expect(result.can_reverse).toBe(false);expect(result.rows[0]).toMatchObject({id:c.count_id,total_cents:'0',can_reverse:false});expect((await history(1,'2026-08-30')).rows).toEqual([]);
});
it('denies drivers including mixed membership, cross-tenant access, invalid paging and bank accounts',async()=>{
 const read=(actor:string,tenant=i.tenant,account=i.account)=>financeAs(db,actor,'select get_finance_cash_period_counts($1,$2,$3)',[tenant,account,end]);
 await expect(read(i.driverUser)).rejects.toThrow('finance_access_denied');
 await db.query("update tenant_memberships set role='admin' where user_id=$1",[i.driverUser]);await expect(read(i.driverUser)).rejects.toThrow('finance_access_denied');
 await expect(read(i.operator,i.otherTenant,i.otherAccount)).rejects.toThrow('finance_access_denied');await expect(history(0)).rejects.toThrow('finance_invalid_filters');
 await db.query("update bank_accounts set account_type='checking' where id=$1",[i.account]);await expect(history()).rejects.toThrow('finance_cash_account_required');
});
it('keeps real count, correction, close and reopening visible in manual-only audit',async()=>{
 const old=await count(1);await reverse(old);const current=await count(0);
 await financeAs(db,i.operator,'select record_finance_cash_opening($1)',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),account_id:i.account,effective_from:'2026-08-01',custodian_name:'Responsável pelo caixa',counts:[{denomination_cents:100,quantity:0}],reason:'Abertura de caixa vazio conferida'}]);
 const legacy=(await financeAs<{v:{revision:string}}>(db,i.operator,'select get_finance_legacy_cut_review($1,$2,$3,$4) v',[i.tenant,i.account,'2026-08-01',end])).rows[0].v;
 await financeAs(db,i.operator,'select review_finance_legacy_cut($1)',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),account_id:i.account,from:'2026-08-01',to:end,revision:legacy.revision,sources_reviewed:true,reason:'Fontes conferidas para fechamento do caixa'}]);
 const preview=(await financeAs<{v:{revision:string}}>(db,i.operator,'select preview_finance_cash_period_close($1,$2,$3,$4,$5) v',[i.tenant,i.account,'2026-08-01',end,current.count_id])).rows[0].v;
 const closed=(await financeAs<{v:{closure_id:string;revision:string}}>(db,i.operator,'select close_finance_cash_period($1) v',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),account_id:i.account,from:'2026-08-01',to:end,count_id:current.count_id,revision:preview.revision,reason:'Caixa contado e fechado após conferência'}])).rows[0].v;
 const frozen=await history();expect(frozen.can_record).toBe(false);expect(frozen.can_reverse).toBe(false);expect(frozen.rows.every(row=>!row.can_reverse)).toBe(true);
 await financeAs(db,i.operator,'select reopen_finance_account_period($1)',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),closure_id:closed.closure_id,revision:closed.revision,reason:'Reabertura de caixa para revisão documentada'}]);
 expect((await history()).rows.find(row=>row.id===current.count_id)?.can_reverse).toBe(true);
 const audit=financeAuditSchema.parse((await financeAs<{v:unknown}>(db,i.operator,'select list_finance_audit_events($1,$2) v',[i.tenant,{manual_only:true,page_size:100}])).rows[0].v);
 for(const action of ['cash_period_count_recorded','cash_period_count_reversed','cash_period_closed','account_period_reopened'])expect(audit.rows.filter(row=>row.action===action)).toEqual(expect.arrayContaining([expect.objectContaining({actor_id:i.operator,manual_intervention:true})]));
 expect(audit.rows.filter(row=>row.action==='cash_period_count_recorded')).toHaveLength(2);
 expect(audit.manual_count).toBe(audit.total);expect((await db.query('select count(*)::int n from finance_movements')).rows[0]).toEqual({n:0});
});
