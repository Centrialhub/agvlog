// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {beforeAll,beforeEach,afterEach,afterAll,it,expect} from 'vitest';
import {createCashPeriodCloseDatabase} from './helpers/cashPeriodCloseDatabase';
import {seedAccountCloseStatement} from './helpers/accountPeriodCloseDatabase';
import {financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
import {accountPeriodEvidenceSchema} from '@/lib/financial/accountPeriodEvidenceContract';
import {buildAccountPeriodEvidenceIndex} from '@/lib/financial/accountPeriodEvidenceIndex';
let db:Awaited<ReturnType<typeof createCashPeriodCloseDatabase>>;
beforeAll(async()=>{db=await createCashPeriodCloseDatabase();for(const n of ['20260910014238_finance_reconciliation_workspace','20260910182541_finance_movement_correction_foundation','20260910183438_finance_active_movement_period_projections','20260910183442_finance_reconciliation_active_movements'])await db.exec(readFileSync(`supabase/migrations/${n}.sql`,'utf8'));},30000);
beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);await db.query("update tenant_memberships set role='admin' where user_id=$1",[i.operator]);});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
async function money(direction:'in'|'out',day='2026-01-02'){
 const request=randomUUID(),v=(await financeAs<{v:{movement_id:string}}>(db,i.operator,'select record_finance_movement($1) v',[{version:1,tenant_id:i.tenant,request_id:request,bank_account_id:i.account,direction,nature:'other',amount_cents:1000,occurred_on:day,description:'Registro para projeção',beneficiary_name:'Responsável QA',reason:'Conferência do dinheiro registrado'}])).rows[0].v;
 return {id:v.movement_id,request};
}
async function voidStorage(m:{id:string;request:string}){
 // Test the projections only. No product correction command is available yet.
 const request=randomUUID();await db.query("insert into finance_commands(tenant_id,request_id,actor_id,action,payload,result) values($1,$2,$3,'qa_storage_only','{}','{}')",[i.tenant,request,i.operator]);
 return (await db.query<{id:string}>(`insert into finance_movement_voids(tenant_id,movement_id,original_request_id,request_id,kind,actor_id,actor_name,reason,revision,source_snapshot)
 values($1,$2,$3,$4,'void',$5,'Financeiro QA','Erro de registro verificado',md5('projection QA'),'{"fixture":"owner only"}') returning id`,[i.tenant,m.id,m.request,request,i.operator])).rows[0].id;
}
async function call(name:string,args:unknown[]){return(await financeAs<{v:Record<string,unknown>}>(db,i.operator,`select ${name}(${args.map((_,n)=>`$${n+1}`).join(',')}) v`,args)).rows[0].v;}
it('excludes a voided outflow from period totals and unmatched money without deleting the original',async()=>{
 const a=await money('out');await money('out');await voidStorage(a);
 const period=await call('get_finance_account_period_review',[i.tenant,i.account,'2026-01-01','2026-01-31']);
 expect(period).toMatchObject({recorded:{count:1,out_cents:'1000',net_cents:'-1000'},unmatched_movement_count:1});
 expect((await db.query('select count(*)::int n from finance_movements')).rows[0]).toEqual({n:2});
});
it('uses active money before and within the opening cut, while freezing explicit correction evidence in cash preview',async()=>{
 await db.query("update bank_accounts set account_type='cash' where id=$1",[i.account]);
 await call('record_finance_cash_opening',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),account_id:i.account,effective_from:'2026-01-01',custodian_name:'Responsável QA',counts:[{denomination_cents:1,quantity:10000}],reason:'Contagem inicial física conferida'}]);
 const prior=await money('out','2026-01-02'),inside=await money('out','2026-01-10');await money('out','2026-01-11');
 const priorVoid=await voidStorage(prior),insideVoid=await voidStorage(inside);
 expect(await call('get_finance_account_opening',[i.tenant,i.account,'2026-01-10','2026-01-31'])).toMatchObject({book:{opening_cents:'10000',out_cents:'1000',closing_cents:'9000'}});
 const count=await call('record_finance_cash_period_count',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),account_id:i.account,period_end:'2026-01-31',counts:[{denomination_cents:1,quantity:9000}],custodian_name:'Responsável QA',reason:'Contagem final física conferida',counted_at_boundary:'end_of_day'}]);
 const preview=await call('preview_finance_cash_period_close',[i.tenant,i.account,'2026-01-01','2026-01-31',count.count_id]);
 expect(preview).toMatchObject({balances:{out_cents:'1000',expected_closing_cents:'9000',difference_cents:'0'}});
 expect(preview.facts).toMatchObject({movements:[expect.any(Object)],movement_voids:expect.arrayContaining([expect.objectContaining({id:priorVoid}),expect.objectContaining({id:insideVoid})]),voided_movements:expect.arrayContaining([expect.objectContaining({id:prior.id}),expect.objectContaining({id:inside.id})])});
 expect(preview.dependencies).toEqual(expect.arrayContaining([expect.objectContaining({source_kind:'finance_movement_voids',source_id:priorVoid,dependency_role:'composition_snapshot'})]));
 const cut=await call('get_finance_legacy_cut_review',[i.tenant,i.account,'2026-01-01','2026-01-31']);
 await call('review_finance_legacy_cut',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),account_id:i.account,from:'2026-01-01',to:'2026-01-31',revision:cut.revision,sources_reviewed:true,reason:'Origens conferidas com histórico de correções'}]);
 const ready=await call('preview_finance_cash_period_close',[i.tenant,i.account,'2026-01-01','2026-01-31',count.count_id]);expect(ready.eligible).toBe(true);
 const closed=await call('close_finance_cash_period',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),account_id:i.account,from:'2026-01-01',to:'2026-01-31',count_id:count.count_id,revision:ready.revision,reason:'Fechamento com correções preservadas no histórico'}]);
 const saved=(await db.query('select snapshot from finance_account_period_closures where id=$1',[closed.closure_id])).rows[0];
 const evidence=accountPeriodEvidenceSchema.parse(await call('get_finance_account_period_evidence',[i.tenant,i.account,closed.closure_id]));
 expect(evidence.integrity).toEqual({snapshot_matches_revision:true,dependencies_match:true});
 expect(buildAccountPeriodEvidenceIndex(evidence).manual_decisions).toEqual(expect.arrayContaining([expect.objectContaining({id:priorVoid,kind:'movement_void',movement_id:prior.id,actor_id:i.operator,reason:'Erro de registro verificado'})]));
 await call('reopen_finance_account_period',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),closure_id:closed.closure_id,revision:closed.revision,reason:'Reabertura para conferir histórico preservado'}]);
 expect((await db.query('select snapshot from finance_account_period_closures where id=$1',[closed.closure_id])).rows[0]).toEqual(saved);
});
it('changes bank snapshot revision for offsetting corrections even when the net money remains zero',async()=>{
 const incoming=await money('in'),outgoing=await money('out');
 const before=await call('preview_finance_account_period_close',[i.tenant,i.account,'2026-01-01','2026-01-31']);
 await voidStorage(incoming);await voidStorage(outgoing);
 const after=await call('preview_finance_account_period_close',[i.tenant,i.account,'2026-01-01','2026-01-31']);
 expect(after.revision).not.toBe(before.revision);expect(after.facts).toMatchObject({movements:[],voided_movements:expect.arrayContaining([expect.objectContaining({id:incoming.id}),expect.objectContaining({id:outgoing.id})])});
 expect(after.balances).toMatchObject({recorded_in_cents:'0',recorded_out_cents:'0'});
});
it('keeps bank evidence authoritative and exposes an invalidated matched movement as an anomaly',async()=>{
 const m=await money('out');const statement=await seedAccountCloseStatement(db,'2026-01-31',9000,'2026-01-01','2026-01-31',[{day:'2026-01-02',cents:-1000}]);
 const context=await call('get_finance_reconciliation_context',[i.tenant,[m.id],statement.entryIds]);
 await call('reconcile_finance_bank_group',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),movement_ids:[m.id],bank_entry_ids:statement.entryIds,expected_revision:context.revision,reason:'Conferência manual do movimento com o extrato',account_evidence:'Conta e favorecido conferidos no comprovante'}]);
 await voidStorage(m); // Deliberate inconsistent owner state: future correction must block this dependency.
 expect(await call('get_finance_account_period_review',[i.tenant,i.account,'2026-01-01','2026-01-31'])).toMatchObject({bank:{count:1,out_cents:'1000'},recorded:{count:0,out_cents:'0'},unmatched_bank_count:1,evidence_review_count:1});
 const snapshot=await call('preview_finance_account_period_close',[i.tenant,i.account,'2026-01-01','2026-01-31']);
 expect(snapshot.eligible).toBe(false);expect(snapshot.facts).toMatchObject({movements:[],groups:[expect.any(Object)],movement_voids:[expect.any(Object)]});
});
