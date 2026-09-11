// @vitest-environment node
import {randomUUID} from 'node:crypto';
import {beforeAll,beforeEach,afterAll,afterEach,expect,it} from 'vitest';
import {createCoordinatedUnloadingCancellationDatabase,installCoordinatedCancellation,seedUnloadingRepairSource,readCancellationMigration} from './helpers/coordinatedUnloadingCancellationDatabase';
import {seedAccountCloseStatement} from './helpers/accountPeriodCloseDatabase';
import {financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
import {unloadingCancellationResultSchema,unloadingCancellationPreviewSchema} from '@/lib/financial/unloadingCancellationContract';
import {unloadingEffectiveOriginSchema} from '@/lib/financial/unloadingOriginCorrectionContract';
let db:Awaited<ReturnType<typeof createCoordinatedUnloadingCancellationDatabase>>;
beforeAll(async()=>{db=await createCoordinatedUnloadingCancellationDatabase();},30000);beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[i.operator]);await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);});afterEach(async()=>db.exec('rollback'));afterAll(async()=>db.close());
async function setup(){const c=await seedUnloadingRepairSource(db,true);await installCoordinatedCancellation(db);const proposal={operation:'cancel_origin',effective_on:'2026-08-03',collection_right_only:true};const ctx=(await db.query<{v:{revision:string}}>('select finance_private.unloading_origin_correction_context($1,$2,$3) v',[i.tenant,c.charge_id,proposal])).rows[0].v;const result=(await db.query<{v:{amendment_id:string}}>('select finance_private.correct_unloading_origin($1) v',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),charge_id:c.charge_id,revision:ctx.revision,proposal,reason:'Cancelamento anterior apenas do direito'}])).rows[0].v;return {...c,amendment_id:result.amendment_id};}
async function install(){await db.exec(readCancellationMigration('20260911054915_finance_unloading_cancelled_claim_cost_resolution'));}
async function preview(charge:string){const p=(await financeAs<{v:{revision:string,eligible:boolean,can_execute:boolean,origin:unknown,effects:{collection_cancelled_cents:string,cost_removed_cents:string},history:unknown[]}}>(db,i.operator,'select preview_finance_unloading_cancellation($1,$2,$3) v',[i.tenant,charge,'2026-08-04'])).rows[0].v;expect(p).not.toHaveProperty('_evidence');unloadingEffectiveOriginSchema.parse(p.origin);return unloadingCancellationPreviewSchema.parse(p);}
const payload=(charge:string,amendment:string,revision:string)=>({version:1,tenant_id:i.tenant,request_id:randomUUID(),charge_id:charge,prior_origin_amendment_id:amendment,effective_on:'2026-08-04',revision,reason:'Cancelar custo e obrigação após cancelamento do direito'});
async function command(p:unknown){return unloadingCancellationResultSchema.parse((await financeAs<{v:unknown}>(db,i.operator,'select cancel_finance_unloading($1) v',[p])).rows[0].v);}
async function kpi(){return (await financeAs<{v:{total_cents:string}}>(db,i.operator,'select get_finance_recorded_cost_summary($1,$2,$3,$4,$5) v',[i.tenant,'2026-08-01','2026-08-31',null,null])).rows[0].v.total_cents;}
it('links the existing cancellation explicitly, removes remaining cost/payable and never emits a second release',async()=>{
 const c=await setup();expect((await preview(c.charge_id)).eligible).toBe(false);expect(await kpi()).toBe('15000');await install();
 const p=await preview(c.charge_id);expect(p.eligible).toBe(true);expect(p.can_execute).toBe(true);expect(p.effects).toMatchObject({cost_removed_cents:'15000',collection_cancelled_cents:'0'});
 const original=(await db.query('select to_jsonb(r) v from receivables r where id=$1',[c.receivable_id])).rows;const request=payload(c.charge_id,c.amendment_id,p.revision);const result=await command(request);expect(await command(request)).toEqual(result);expect(result).toMatchObject({origin_amendment_id:c.amendment_id,collection_cancelled_cents:'0',cost_removed_cents:'15000',obligation_cancelled_cents:'15000'});
 expect(await kpi()).toBe('0');expect((await db.query('select to_jsonb(r) v from receivables r where id=$1',[c.receivable_id])).rows).toEqual(original);expect((await db.query('select count(*)::int n from finance_private.unloading_origin_amendments')).rows).toEqual([{n:1}]);expect((await db.query("select count(*)::int n from finance_events where action='unloading_origin_corrected'")).rows).toEqual([{n:1}]);expect((await db.query('select count(*)::int n from finance_movements')).rows).toEqual([{n:0}]);expect((await preview(c.charge_id)).history).toHaveLength(1);await db.exec('set constraints all immediate');
});
it('requires the exact prior amendment and current revision rather than inferring a cancellation from status',async()=>{
 const c=await setup();await install();const p=await preview(c.charge_id);const request=payload(c.charge_id,c.amendment_id,p.revision);
 await expect(command({...request,prior_origin_amendment_id:randomUUID()})).rejects.toMatchObject({code:'40001'});const {prior_origin_amendment_id:prior,...missing}=request;expect(prior).toBe(c.amendment_id);await expect(command(missing)).rejects.toMatchObject({code:'40001'});
 await db.query('update receivables set notes=$1 where id=$2',['Informação posterior',c.receivable_id]);await expect(command(request)).rejects.toMatchObject({code:'40001'});expect(await kpi()).toBe('15000');
});
it('rolls back only the attempted cost cancellation while preserving the prior audited claim cancellation',async()=>{
 const c=await setup();await install();const p=await preview(c.charge_id);
 await db.exec("create function public.fail_remaining_cost_audit() returns trigger language plpgsql as $$begin if new.action='unloading_cancelled_coordinated' then raise exception 'audit_failure';end if;return new;end$$;create trigger fail_remaining_cost_audit before insert on finance_events for each row execute function public.fail_remaining_cost_audit()");
 await expect(command(payload(c.charge_id,c.amendment_id,p.revision))).rejects.toThrow('audit_failure');expect(await kpi()).toBe('15000');expect((await db.query('select count(*)::int n from finance_expense_cancellations')).rows).toEqual([{n:0}]);expect((await db.query('select count(*)::int n from finance_private.unloading_origin_amendments')).rows).toEqual([{n:1}]);expect((await db.query('select count(*)::int n from finance_private.unloading_cost_cancellation_tickets')).rows).toEqual([{n:0}]);expect((await preview(c.charge_id)).eligible).toBe(true);
});
it('keeps tenant and mixed-driver authorization after the extension',async()=>{
 const c=await setup();await install();const p=await preview(c.charge_id);const request=payload(c.charge_id,c.amendment_id,p.revision);await expect(command({...request,tenant_id:i.otherTenant})).rejects.toMatchObject({code:'42501'});await db.query("insert into tenant_memberships values($1,$2,'driver',true)",[i.tenant,i.operator]);await expect(command(request)).rejects.toMatchObject({code:'42501'});await expect(preview(c.charge_id)).rejects.toMatchObject({code:'42501'});
});

it('does not treat a legacy cancelled status without an amendment as proof',async()=>{
 const c=await seedUnloadingRepairSource(db,true);
 // The old generic path accepted status before the source guard; preserve that legacy state without disabling a guard.
 await db.query("update receivables set status='cancelled' where id=$1",[c.receivable_id]);await installCoordinatedCancellation(db);await install();
 const p=await preview(c.charge_id);expect(p.eligible).toBe(false);await expect(command(payload(c.charge_id,randomUUID(),p.revision))).rejects.toMatchObject({code:'55000'});expect(await kpi()).toBe('15000');expect((await db.query('select count(*)::int n from finance_expense_cancellations')).rows).toEqual([{n:0}]);
});

it('preserves active-origin cancellation and rejects an inapplicable prior amendment after54915',async()=>{
 const c=await seedUnloadingRepairSource(db,true);await installCoordinatedCancellation(db);await install();const p=await preview(c.charge_id);expect(p.eligible).toBe(true);
 const request=payload(c.charge_id,randomUUID(),p.revision);await expect(command(request)).rejects.toMatchObject({code:'22023'});const {prior_origin_amendment_id:prior,...active}=request;expect(prior).toBeTruthy();const result=await command(active);expect(result.collection_cancelled_cents).toBe('15000');expect(await kpi()).toBe('0');expect((await db.query('select count(*)::int n from finance_private.unloading_origin_amendments')).rows).toEqual([{n:1}]);
});
it('keeps a real closed period blocking the remaining cost after a prior claim cancellation',async()=>{
 const c=await setup();await install();const scope={account_id:i.account,from:'2026-08-01',to:'2026-08-31'};const rpc=async<T>(name:string,args:unknown[])=>(await financeAs<{v:T}>(db,i.operator,'select '+name+'('+args.map((_,n)=>'$'+(n+1)).join(',')+') v',args)).rows[0].v;const closeCommand=()=>({version:1,tenant_id:i.tenant,request_id:randomUUID(),reason:'Fechamento bancário real do período sem movimento'});
 await seedAccountCloseStatement(db,'2026-07-31',10000);await seedAccountCloseStatement(db,'2026-08-31',10000,scope.from,scope.to);await db.exec('select finance_private.run_automatic_reconciliation_queue()');
 for(const [writer,reader,extra] of [['record_finance_account_opening','get_finance_statement_period_evidence',{}],['record_finance_statement_coverage_approval','get_finance_statement_coverage_review',{originals_obtained_from_bank:true,complete_period_confirmed:true}],['review_finance_legacy_cut','get_finance_legacy_cut_review',{sources_reviewed:true}]] as const){const evidence=await rpc<{revision:string}>(reader,[i.tenant,i.account,scope.from,scope.to]);await rpc(writer,[{...closeCommand(),...scope,revision:evidence.revision,...extra}]);}
 const closePreview=await rpc<{revision:string}>('preview_finance_account_period_close',[i.tenant,i.account,scope.from,scope.to]);const closed=await rpc<{closure_id:string,revision:string}>('close_finance_account_period',[{...closeCommand(),...scope,revision:closePreview.revision}]);
 const p=await preview(c.charge_id);expect(p.eligible).toBe(false);expect(p.blockers.some(x=>x.code.includes('closed'))).toBe(true);await expect(command(payload(c.charge_id,c.amendment_id,p.revision))).rejects.toMatchObject({code:'55000'});expect(await kpi()).toBe('15000');
 await rpc('reopen_finance_account_period',[{...closeCommand(),closure_id:closed.closure_id,revision:closed.revision}]);expect((await preview(c.charge_id)).eligible).toBe(true);
});
