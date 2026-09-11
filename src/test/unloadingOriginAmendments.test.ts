// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {afterAll,afterEach,beforeAll,beforeEach,expect,it} from 'vitest';
import {createUnloadingProjectionRepairDatabase,seedUnloadingRepairSource} from './helpers/unloadingProjectionRepairDatabase';
import {unloadingOriginCorrectionContextSchema,unloadingOriginCorrectionResultSchema,unloadingEffectiveOriginSchema} from '@/lib/financial/unloadingOriginCorrectionContract';
import {expenseHistorySchema} from '@/lib/financial/expenseHistoryContract';
import {periodUnloadingFlowSchema} from '@/lib/financial/periodUnloadingFlowContract';
import {seedAccountCloseStatement} from './helpers/accountPeriodCloseDatabase';
import {financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
let db:Awaited<ReturnType<typeof createUnloadingProjectionRepairDatabase>>;
beforeAll(async()=>{db=await createUnloadingProjectionRepairDatabase();},30000);
beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[i.operator]);await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);});
afterEach(async()=>db.exec('rollback'));afterAll(async()=>db.close());
async function install(){for(const n of ['20260910205941_finance_unloading_receivable_source_guard','20260910210433_finance_unloading_receivable_context','20260910211156_finance_unloading_projection_repair','20260911045402_finance_unloading_origin_amendments','20260911051405_finance_unloading_origin_economic_flow']){await db.exec(readFileSync('supabase/migrations/'+n+'.sql','utf8'));}}
async function context(charge:string,proposal:unknown){const value=(await db.query<{v:Record<string,unknown>}>('select finance_private.unloading_origin_correction_context($1,$2,$3) v',[i.tenant,charge,proposal])).rows[0].v;delete value._evidence;return unloadingOriginCorrectionContextSchema.parse(value);}
async function correct(payload:unknown){await db.exec('savepoint correction');try{const out=(await db.query<{v:Record<string,unknown>}>('select finance_private.correct_unloading_origin($1) v',[payload])).rows[0].v;await db.exec('release savepoint correction');return unloadingOriginCorrectionResultSchema.parse(out);}catch(e){await db.exec('rollback to savepoint correction');throw e;}}
const request=(charge:string,proposal:unknown,revision:string)=>({version:1,tenant_id:i.tenant,request_id:randomUUID(),charge_id:charge,proposal,revision,reason:'Correção explícita apenas do direito de cobrança'});
it('amends the same charge from150 to120, changes supplier through two legs, and cancels without changing the cost or payable',async()=>{
 const c=await seedUnloadingRepairSource(db,true);await install();const expenseRows=(await db.query('select to_jsonb(e) v from finance_expense_items e')).rows;const payableRows=(await db.query('select to_jsonb(p) v from payables p')).rows;
 const proposal={operation:'amend_origin',supplier_id:c.supplier,amount_cents:'12000',effective_on:'2026-08-03',collection_right_only:true};const preview=await context(c.charge_id,proposal);expect(preview.blockers).toEqual([]);
 const payload=request(c.charge_id,proposal,preview.revision);const result=await correct(payload);expect(await correct(payload)).toEqual(result);
 const second=randomUUID();await db.query("insert into clients(id,tenant_id,company_name,active) values($1,$2,'Novo devedor explícito',true)",[second,i.tenant]);const change={...proposal,supplier_id:second,effective_on:'2026-08-04'};const ctx=await context(c.charge_id,change);expect(ctx.blockers).toEqual([]);await correct(request(c.charge_id,change,ctx.revision));
 const cancel={operation:'cancel_origin',effective_on:'2026-08-05',collection_right_only:true};const last=await context(c.charge_id,cancel);expect(last.blockers).toEqual([]);await correct(request(c.charge_id,cancel,last.revision));
 await db.exec('set constraints all immediate');
 const effective=(await db.query<{v:{verified:boolean,effective:{status:string,amount_cents:string},history:Array<{economic_effects:Array<{leg:string,amount_cents:string}>}>}}> ('select finance_private.unloading_effective_origin($1,$2) v',[i.tenant,c.charge_id])).rows[0].v;
 const flow=periodUnloadingFlowSchema.parse((await financeAs<{v:unknown}>(db,i.operator,'select get_finance_period_unloading_flow($1,$2,$3,$4,$5,$6,$7) v',[i.tenant,'2026-08-01','2026-08-31',[i.account],null,1,null])).rows[0].v);expect(flow.version).toBe(2);expect(flow.origin_totals.amount_cents).toBe('15000');expect(flow.adjustment_totals?.amount_cents).toBe('-15000');expect(flow.net_origin_totals?.amount_cents).toBe('0');expect(flow.rows.filter(x=>x.kind==='adjustment')).toHaveLength(5);expect(flow.money_links).toEqual([]);
 unloadingEffectiveOriginSchema.parse(effective);expect(effective.verified).toBe(true);expect(effective.effective).toMatchObject({status:'cancelled',amount_cents:'0'});expect(effective.history).toHaveLength(3);expect(effective.history[0].economic_effects.map(x=>x.amount_cents)).toEqual(['-15000','12000']);expect(effective.history[2].economic_effects.map(x=>x.amount_cents)).toEqual(['-12000']);
 expect((await db.query('select amount_cents from finance_unloading_charges')).rows).toEqual([{amount_cents:15000}]);expect((await db.query('select to_jsonb(e) v from finance_expense_items e')).rows).toEqual(expenseRows);expect((await db.query('select to_jsonb(p) v from payables p')).rows).toEqual(payableRows);
 expect((await db.query('select trunc(amount*100)::text amount,status from receivables where id=$1',[c.receivable_id])).rows).toEqual([{amount:'12000',status:'cancelled'}]);expect((await db.query('select count(*)::int n from finance_movements')).rows).toEqual([{n:0}]);
 const repair=(await db.query<{v:{eligible:boolean}}> ('select finance_private.unloading_projection_repair_context($1,$2) v',[i.tenant,c.charge_id])).rows[0].v;expect(repair.eligible).toBe(false);
});
it('retains direct write denial and denies tenant/mixed-driver access and private writer grants',async()=>{
 const c=await seedUnloadingRepairSource(db);await install();await db.exec('savepoint direct');await expect(db.query('update receivables set amount=1 where id=$1',[c.receivable_id])).rejects.toMatchObject({code:'55000'});await db.exec('rollback to savepoint direct');
 const p={operation:'amend_origin',supplier_id:c.supplier,amount_cents:'12000',effective_on:'2026-08-03',collection_right_only:true};const ctx=await context(c.charge_id,p);await expect(correct({...request(c.charge_id,p,ctx.revision),tenant_id:i.otherTenant})).rejects.toMatchObject({code:'42501'});
 await db.query("insert into tenant_memberships values($1,$2,'driver',true)",[i.tenant,i.operator]);await expect(correct(request(c.charge_id,p,ctx.revision))).rejects.toMatchObject({code:'42501'});
 expect((await db.query("select has_function_privilege('authenticated','finance_private.correct_unloading_origin(jsonb)','EXECUTE') allowed")).rows).toEqual([{allowed:false}]);
});
it('receives against the new supplier/version but blocks another amendment once real financial history exists',async()=>{
 const c=await seedUnloadingRepairSource(db);await install();const supplier=randomUUID();await db.query("insert into clients(id,tenant_id,company_name,active) values($1,$2,'Devedor corrigido',true)",[supplier,i.tenant]);
 const proposal={operation:'amend_origin',supplier_id:supplier,amount_cents:'12000',effective_on:'2026-08-03',collection_right_only:true};await correct(request(c.charge_id,proposal,(await context(c.charge_id,proposal)).revision));
 const financial=(await financeAs<{v:{revision:string,can_receive:boolean,source_issue:null}}>(db,i.operator,'select get_receivable_financial_context($1,$2) v',[i.tenant,c.receivable_id])).rows[0].v;expect(financial.can_receive).toBe(true);expect(financial.source_issue).toBeNull();
 const movement=(await financeAs<{v:{movement_id:string}}>(db,i.operator,'select record_finance_movement($1) v',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),bank_account_id:i.account,direction:'in',nature:'receipt',amount_cents:1000,occurred_on:'2026-08-10',description:'Recebimento após correção de origem',beneficiary_name:'Devedor corrigido',reason:'Recebimento válido da versão atual'}])).rows[0].v;
 await financeAs(db,i.operator,'select apply_receivable_financial_command($1)',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),actor_id:i.operator,receivable_id:c.receivable_id,expected_revision:financial.revision,action:'receive',amount_cents:1000,effective_date:'2026-08-10',bank_account_id:i.account,method:'pix',movement_id:movement.movement_id,reason:'Recebimento após correção auditada'}]);
 const recorded=(await db.query<{v:Record<string,unknown>}>("select before_snapshot->'unloading_origin' v from receivable_financial_commands where receivable_id=$1 and action='receive'",[c.receivable_id])).rows[0].v;expect(recorded).toMatchObject({version:1,charge_id:c.charge_id,verified:true,effective:{supplier_id:supplier,amount_cents:'12000'}});expect(recorded.amendment_id).toBeTruthy();
 const receiptFlow=periodUnloadingFlowSchema.parse((await financeAs<{v:unknown}>(db,i.operator,'select get_finance_period_unloading_flow($1,$2,$3,$4,$5,$6,$7) v',[i.tenant,'2026-08-01','2026-08-31',[i.account],supplier,1,null])).rows[0].v);expect(receiptFlow.receipt_totals).toMatchObject({valid:true,amount_cents:'1000'});expect(receiptFlow.origin_totals.amount_cents).toBe('0');expect(receiptFlow.adjustment_totals?.amount_cents).toBe('12000');expect(receiptFlow.rows.find(x=>x.kind==='receipt')).toMatchObject({supplier_id:supplier,valid:true});expect(receiptFlow.money_links).toHaveLength(1);
 const rpc=async<T>(name:string,args:unknown[])=>(await financeAs<{v:T}>(db,i.operator,`select ${name}(${args.map((_,n)=>'$'+(n+1)).join(',')}) v`,args)).rows[0].v;
 const scope={account_id:i.account,from:'2026-08-01',to:'2026-08-31'};const command=()=>({version:1,tenant_id:i.tenant,request_id:randomUUID(),reason:'Fechamento real após correção de cobrança'});
 await seedAccountCloseStatement(db,'2026-07-31',10000);const statement=await seedAccountCloseStatement(db,'2026-08-31',11000,scope.from,scope.to,[{day:'2026-08-10',cents:1000}]);
 await db.exec('select finance_private.run_automatic_reconciliation_queue()');
 const recon=await rpc<{revision:string}>('get_finance_reconciliation_context',[i.tenant,[movement.movement_id],statement.entryIds]);await rpc('reconcile_finance_bank_group',[{...command(),movement_ids:[movement.movement_id],bank_entry_ids:statement.entryIds,expected_revision:recon.revision,account_evidence:'Conta e origem bancária conferidas'}]);
 for(const [writer,reader,extra] of [['record_finance_account_opening','get_finance_statement_period_evidence',{}],['record_finance_statement_coverage_approval','get_finance_statement_coverage_review',{originals_obtained_from_bank:true,complete_period_confirmed:true}],['review_finance_legacy_cut','get_finance_legacy_cut_review',{sources_reviewed:true}]] as const){const evidence=await rpc<{revision:string}>(reader,[i.tenant,i.account,scope.from,scope.to]);await rpc(writer,[{...command(),...scope,revision:evidence.revision,...extra}]);}
 const closePreview=await rpc<{revision:string}>('preview_finance_account_period_close',[i.tenant,i.account,scope.from,scope.to]);const closed=await rpc<{closure_id:string,revision:string}>('close_finance_account_period',[{...command(),...scope,revision:closePreview.revision}]);
 const covered=periodUnloadingFlowSchema.parse(await rpc('get_finance_period_unloading_flow',[i.tenant,scope.from,scope.to,[i.account],supplier,1,null]));expect(covered.receipt_totals.amount_cents).toBe('1000');expect(covered.money_links[0].money_covered).toBe(true);expect(covered.rows.filter(x=>x.kind==='adjustment').every(x=>!x.money_covered)).toBe(true);
 const next={...proposal,amount_cents:'11000',effective_on:'2026-08-11'};const blocked=await context(c.charge_id,next);expect(blocked.eligible).toBe(false);expect(JSON.stringify(blocked.blockers)).toContain('receivables_payments');await expect(correct(request(c.charge_id,next,blocked.revision))).rejects.toMatchObject({code:'55000'});
 await rpc('reopen_finance_account_period',[{...command(),closure_id:closed.closure_id,revision:closed.revision}]);expect((await context(c.charge_id,next)).eligible).toBe(false);
 expect((await db.query('select count(*)::int n from finance_private.unloading_origin_amendments')).rows).toEqual([{n:1}]);
});
it('rolls the title, ticket and amendment back if the permanent audit write fails',async()=>{
 const c=await seedUnloadingRepairSource(db);await install();const p={operation:'amend_origin',supplier_id:c.supplier,amount_cents:'12000',effective_on:'2026-08-03',collection_right_only:true};const ctx=await context(c.charge_id,p);
 await db.exec("create function public.qa_fail_origin_audit() returns trigger language plpgsql as $$begin if new.action='unloading_origin_corrected' then raise exception 'audit unavailable';end if;return new;end$$;create trigger qa_fail_origin_audit before insert on finance_events for each row execute function qa_fail_origin_audit()");
 await expect(correct(request(c.charge_id,p,ctx.revision))).rejects.toThrow('audit unavailable');
 expect((await db.query('select trunc(amount*100)::text cents from receivables where id=$1',[c.receivable_id])).rows).toEqual([{cents:'15000'}]);expect((await db.query('select count(*)::int n from finance_private.unloading_origin_amendments')).rows).toEqual([{n:0}]);expect((await db.query('select count(*)::int n from finance_private.unloading_origin_tickets')).rows).toEqual([{n:0}]);
});
it('rejects stale review and unaudited chain inserts and keeps amendment rows immutable',async()=>{
 const c=await seedUnloadingRepairSource(db);await install();const p={operation:'amend_origin',supplier_id:c.supplier,amount_cents:'12000',effective_on:'2026-08-03',collection_right_only:true};const old=await context(c.charge_id,p);
 await db.query("update receivables set notes='Anotação posterior à revisão' where id=$1",[c.receivable_id]);await expect(correct(request(c.charge_id,p,old.revision))).rejects.toMatchObject({code:'40001'});
 const current=await context(c.charge_id,p);await correct(request(c.charge_id,p,current.revision));await db.exec('set constraints all immediate');
 await db.exec('savepoint immutable');await expect(db.exec("update finance_private.unloading_origin_amendments set reason='Tentativa de substituir o motivo anterior'")).rejects.toMatchObject({code:'55000'});await db.exec('rollback to savepoint immutable');
 await db.exec('savepoint invalid_chain');
 await expect(db.query("insert into finance_private.unloading_origin_amendments(tenant_id,charge_id,receivable_id,ordinal,previous_id,request_id,operation,revision_before,before_state,after_state,effective_on,actor_id,actor_name,reason,evidence) select tenant_id,charge_id,receivable_id,2,id,$1,'amend_origin','incorrect',after_state,after_state,'2026-08-04',actor_id,actor_name,'Evento sem comando e sem prova','{}' from finance_private.unloading_origin_amendments",[randomUUID()])).rejects.toMatchObject({code:'23514'});
 await db.exec('rollback to savepoint invalid_chain');expect((await db.query('select count(*)::int n from finance_private.unloading_origin_amendments')).rows).toEqual([{n:1}]);
});

it('lists the effective collection right beside the unchanged original expense with the final receipt reader',async()=>{
 const c=await seedUnloadingRepairSource(db,true);await install();
 const proposal={operation:'amend_origin',supplier_id:c.supplier,amount_cents:'12000',effective_on:'2026-08-03',collection_right_only:true};await correct(request(c.charge_id,proposal,(await context(c.charge_id,proposal)).revision));
 // Install real receipt metadata definitions needed by the reader; upload/Edge execution is proved in its own suite.
 const sql=(name:string)=>readFileSync('supabase/migrations/'+name+'.sql','utf8');
 const quarantine=sql('20260911040123_finance_upload_quarantine_artifacts_v2');await db.exec(quarantine.slice(0,quarantine.indexOf('create function secure_upload_private.authorization_revision')));
 const dtoStart=quarantine.indexOf('create function secure_upload_private.dto(');await db.exec(quarantine.slice(dtoStart,quarantine.indexOf('create function secure_upload_private.assert_source',dtoStart)));
 const receipts=sql('20260911042754_finance_expense_quarantine_receipt_links');const tableStart=receipts.indexOf('create table secure_upload_private.expense_receipts');await db.exec(receipts.slice(tableStart,receipts.indexOf(');',tableStart)+2));
 await db.exec('alter table storage.objects add column if not exists user_metadata jsonb');
 const cancellation=sql('20260910175641_finance_unpaid_expense_cancellation');if(!(await db.query<{v:boolean}>("select to_regclass('public.finance_expense_cancellations') is not null v")).rows[0].v)await db.exec(cancellation.slice(0,cancellation.indexOf('create function finance_private.expense_is_cancelled')));
 await db.exec(sql('20260909221405_finance_expense_history_queries'));
 const ddl=sql('20260824224152_baseline').match(/CREATE TABLE public\.cost_centers \([\s\S]*?\n\);/)?.[0];if(!ddl)throw new Error('cost centers definition missing');await db.exec(ddl);
 const reader=sql('20260910175733_finance_expense_cancellation_preview');await db.exec(reader.slice(reader.indexOf('create or replace function finance_private.list_expenses')));
 await db.exec(sql('20260911044823_finance_expense_receipt_artifact_status'));await db.exec(sql('20260911051729_finance_expense_unloading_effective_origin'));
 const result=expenseHistorySchema.parse((await financeAs<{v:unknown}>(db,i.operator,'select list_finance_expenses($1,$2) v',[i.tenant,{}])).rows[0].v);
 expect(result.total_cents).toBe('15000');expect(result.rows).toHaveLength(1);expect(result.rows[0].unloading_origin).toMatchObject({verified:true,charge_id:c.charge_id,original:{amount_cents:'15000'},effective:{amount_cents:'12000',status:'active'}});expect(result.rows[0].receipt_artifact_count).toBe(0);
 const boundary=sql('20260909235237_finance_legacy_rpc_boundary');await db.exec(boundary.slice(0,boundary.indexOf('-- Wrap')));
 await db.exec(sql('20260911052521_finance_unloading_origin_public_boundary'));
 const next={...proposal,amount_cents:'11000',effective_on:'2026-08-04'};
 const publicPreview=async()=>unloadingOriginCorrectionContextSchema.parse((await financeAs<{v:unknown}>(db,i.operator,'select get_finance_unloading_origin_correction_context($1,$2,$3) v',[i.tenant,c.charge_id,next])).rows[0].v);
 const ready=await publicPreview();expect(ready.can_execute).toBe(true);expect(ready).not.toHaveProperty('_evidence');
 const command=request(c.charge_id,next,ready.revision);const execute=async()=>unloadingOriginCorrectionResultSchema.parse((await financeAs<{v:unknown}>(db,i.operator,'select correct_finance_unloading_origin($1) v',[command])).rows[0].v);
 const confirmed=await execute();expect(await execute()).toEqual(confirmed);
 await db.exec('revoke execute on function public.correct_finance_unloading_origin(jsonb) from authenticated');expect((await publicPreview()).can_execute).toBe(false);
 await db.query("insert into tenant_memberships values($1,$2,'driver',true)",[i.tenant,i.operator]);await expect(publicPreview()).rejects.toMatchObject({code:'42501'});

});

it('preserves a genuinely built settlement cost snapshot and blocks a materialization referencing the title',async()=>{
 const c=await seedUnloadingRepairSource(db,true);await install();
 const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8');
 for(const match of baseline.matchAll(/CREATE TYPE public\.([a-z_]+) AS ENUM \([\s\S]*?\);/g))if(!(await db.query<{v:boolean}>('select to_regtype($1) is not null v',['public.'+match[1]])).rows[0].v)await db.exec(match[0]);
 await db.exec('create schema settlement_test_definitions');
 for(const table of ['driver_settlements','driver_settlement_items','driver_settlement_payments','driver_settlement_events','driver_expenses','dispatch_trip_loads','loads','trip_routes']){
  const ddl=baseline.match(new RegExp('CREATE TABLE public\\.'+table+' \\([\\s\\S]*?\\n\\);'))?.[0];if(!ddl)throw new Error(table);
  if(!(await db.query<{v:boolean}>('select to_regclass($1) is not null v',['public.'+table])).rows[0].v)await db.exec(ddl);
  else{
   await db.exec(ddl.replace('public.'+table,'settlement_test_definitions.'+table));
   const columns=(await db.query<{name:string,type:string}>("select attname name,format_type(atttypid,atttypmod) type from pg_attribute where attrelid=$1::regclass and attnum>0 and not attisdropped",['settlement_test_definitions.'+table])).rows;
   for(const col of columns)await db.exec('alter table public.'+table+' add column if not exists "'+col.name+'" '+col.type);
  }
  for(const d of baseline.matchAll(new RegExp('ALTER TABLE ONLY public\\.'+table+'\\s+ALTER COLUMN[\\s\\S]*?;','g')))await db.exec(d[0]);
 }
 for(const name of ['_log_settlement_event','_build_driver_settlement']){const fn=baseline.match(new RegExp('CREATE OR REPLACE FUNCTION public\\.'+name+'\\([\\s\\S]*?\\$function\\$;'))?.[0];if(!fn)throw new Error(name);await db.exec(fn);}
 const costs=readFileSync('supabase/migrations/20260910134948_finance_canonical_trip_cost_settlement.sql','utf8');await db.exec(costs.slice(0,costs.indexOf('-- Extend, rather than bypass')));
 const trip=(await db.query<{id:string}>('select b.trip_id id from finance_expense_items e join finance_expense_batches b on b.id=e.batch_id where e.unloading_id=$1',[c.charge_id])).rows[0].id;
 await db.query('update dispatch_trips set driver_id=$1 where id=$2',[i.driver,trip]);
 const settlement=(await db.query<{id:string}>('select _build_driver_settlement($1,$2) id',[i.tenant,trip])).rows[0].id;
 const before=(await db.query('select to_jsonb(s) v from driver_settlements s where id=$1',[settlement])).rows;
 const items=(await db.query<{v:{source_table:string,amount:number}}>('select to_jsonb(x) v from driver_settlement_items x where settlement_id=$1 order by id',[settlement])).rows;
 expect(items.some(x=>(x.v as {source_table:string,amount:number}).source_table==='finance_expense_items'&&(x.v as {amount:number}).amount===150)).toBe(true);
 const proposal={operation:'amend_origin',supplier_id:c.supplier,amount_cents:'12000',effective_on:'2026-08-03',collection_right_only:true};const preview=await context(c.charge_id,proposal);expect(preview.blockers).toEqual([]);expect(preview.dependencies.some(x=>x.source_table==='driver_settlement_items'&&!x.blocking)).toBe(true);await correct(request(c.charge_id,proposal,preview.revision));
 expect((await db.query('select to_jsonb(s) v from driver_settlements s where id=$1',[settlement])).rows).toEqual(before);expect((await db.query('select to_jsonb(x) v from driver_settlement_items x where settlement_id=$1 order by id',[settlement])).rows).toEqual(items);
 const dependent=randomUUID();await db.query("insert into driver_settlement_items(id,tenant_id,settlement_id,item_type,source_table,source_id,description,amount,metadata) values($1,$2,$3,'expense','receivables',$4,'Materialização explícita do título',120,'{}')",[dependent,i.tenant,settlement,c.receivable_id]);
 const next={...proposal,amount_cents:'11000'};const blocked=await context(c.charge_id,next);expect(blocked.eligible).toBe(false);expect(blocked.blockers).toContainEqual({code:'unloading_financial_history_requires_resolution',source_table:'driver_settlement_items',source_ids:[dependent]});await expect(correct(request(c.charge_id,next,blocked.revision))).rejects.toMatchObject({code:'55000'});
});
