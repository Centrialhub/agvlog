// @vitest-environment node
import {beforeAll,afterAll,beforeEach,afterEach,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {seedAccountCloseStatement} from './helpers/accountPeriodCloseDatabase';
import {financeAs} from './helpers/financeLedgerDatabase';
import type {PGlite} from '@electric-sql/pglite';
import {createReceivableBalanceAdjustmentReviewDatabase,balanceAdjustmentReviewIds as i,seedBalanceAdjustmentFiscalReceivable} from './helpers/receivableBalanceAdjustmentReviewDatabase';
let db:PGlite;
beforeAll(async()=>{db=await createReceivableBalanceAdjustmentReviewDatabase();const sql=readFileSync('supabase/migrations/20260911115046_finance_receivable_balance_adjustments.sql','utf8');if(sql.trim().length<100)throw Error('Adjustment core not ready');await db.exec(sql);},60000);
afterAll(async()=>{await db?.close();});beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[i.operator]);await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);});afterEach(async()=>{await db.exec('rollback');});
async function title(){return(await db.query<{id:string}>("insert into receivables(tenant_id,amount,received_amount,status,description,due_date) values($1,100,0,'pending','Adjustment review',current_date+5) returning id",[i.tenant])).rows[0].id;}
async function snapshot(id:string){return(await db.query<{v:Record<string,unknown>&{revision:string}}>('select public._receivable_financial_snapshot($1,$2) v',[i.tenant,id])).rows[0].v;}
async function day(){return(await db.query<{v:string}>("select (clock_timestamp() at time zone 'America/Sao_Paulo')::date::text v")).rows[0].v;}
async function adjustment(id:string,amount:string,kind='discount',original:string|null=null,effectiveOn?:string){const date=effectiveOn??await day();const context=(await db.query<{v:{revision:string,eligible:boolean,blockers:string[]}}>('select finance_private.receivable_balance_adjustment_context($1,$2,$3,$4,$5,$6) v',[i.tenant,id,kind,amount,date,original])).rows[0].v;expect(context.eligible).toBe(true);return{version:1,tenant_id:i.tenant,request_id:randomUUID(),receivable_id:id,action:original?'reverse':'apply',kind,adjustment_id:original,amount_cents:amount,effective_on:date,expected_revision:context.revision,reason:'Independent adjustment review'};}
async function write(payload:unknown){return(await db.query<{v:{event_id:string,adjustment_id:string,cash_movement_created:boolean}}>('select finance_private.record_receivable_balance_adjustment($1) v',[payload])).rows[0].v;}
async function money(){return(await db.query('select to_jsonb(b) value from bank_transactions b order by id')).rows;}
async function cash(id:string,amount:number,effectiveOn?:string){return(await db.query<{v:{payment_id:string}}>('select public.apply_receivable_financial_command($1) v',[{version:1,tenant_id:i.tenant,actor_id:i.operator,request_id:randomUUID(),receivable_id:id,action:'receive',amount_cents:amount,effective_date:effectiveOn??await day(),bank_account_id:i.account,method:'pix',expected_revision:(await snapshot(id)).revision,reason:'Actual receipt before residual adjustment'}])).rows[0].v;}
it('settles only the remaining debt without manufacturing cash; partial reversal and replay preserve originals',async()=>{
 const id=await title();await cash(id,6000);const before=await money();const payload=await adjustment(id,'4000');const result=await write(payload);expect(result.cash_movement_created).toBe(false);expect(await write(payload)).toEqual(result);
 expect(await snapshot(id)).toMatchObject({amount_cents:10000,cash_received_cents:6000,settled_cents:10000,open_cents:0});expect(await money()).toEqual(before);
 await write(await adjustment(id,'1000','discount',result.adjustment_id));expect(await snapshot(id)).toMatchObject({cash_received_cents:6000,settled_cents:9000,open_cents:1000});expect(await money()).toEqual(before);
 const context=(await db.query<{v:{eligible:boolean}}>('select finance_private.receivable_balance_adjustment_context($1,$2,$3,$4,$5,null) v',[i.tenant,id,'loss','1001',await day()])).rows[0].v;expect(context.eligible).toBe(false);
});
it('reverses only actual cash while preserving independent noncash settlement',async()=>{
 const id=await title();const received=await cash(id,6000);await write(await adjustment(id,'4000','loss'));
 await db.query('select public.apply_receivable_financial_command($1)',[{version:1,tenant_id:i.tenant,actor_id:i.operator,request_id:randomUUID(),receivable_id:id,expected_revision:(await snapshot(id)).revision,action:'reverse',payment_id:received.payment_id,refund_kind:'money_returned',effective_date:await day(),reason:'Only the actual cash is returned'}]);
 expect(await snapshot(id)).toMatchObject({cash_received_cents:0,settled_cents:4000,open_cents:6000});expect(await money()).toHaveLength(2);
});
it('rejects stale requests and revoked identities before any new adjustment',async()=>{
 const id=await title();const stale=await adjustment(id,'2000');await write(await adjustment(id,'1000'));
 await db.exec('savepoint stale');await expect(write(stale)).rejects.toMatchObject({code:'40001'});await db.exec('rollback to savepoint stale');
 const next=await adjustment(id,'1000');await db.query('update tenant_memberships set active=false where tenant_id=$1 and user_id=$2',[i.tenant,i.operator]);await db.exec('savepoint revoked');await expect(write(next)).rejects.toMatchObject({code:'42501'});await db.exec('rollback to savepoint revoked');
});

it('confirmed fiscal cancellation compensates discount and creates customer credit only from actual cash',async()=>{
 const source=await seedBalanceAdjustmentFiscalReceivable(db);await cash(source.receivable,6000);await write(await adjustment(source.receivable,'4000'));
 const before=await money();await db.query("update hub_fiscal_emissions set status='cancelled',provider_document_version=2 where id=$1",[source.emission]);
 const obs=(await db.query<{id:string,snapshot:{status:string}}>('select id,snapshot from finance_fiscal_observations where emission_id=$1 order by observed_order desc limit 1',[source.emission])).rows[0];expect(obs.snapshot.status).toBe('cancelled');
 await db.query("select set_config('request.jwt.claim.sub','',true)");await db.query('select finance_private.run_fiscal_queue(50)');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[i.operator]);
 const job=(await db.query<{status:string,issue:string|null}>('select status,issue from finance_fiscal_projection_jobs where observation_id=$1',[obs.id])).rows[0];expect(job).toMatchObject({status:'applied',issue:null});
 expect((await db.query<{amount_cents:string}>('select amount_cents::text from finance_customer_credits where receivable_id=$1',[source.receivable])).rows).toEqual([{amount_cents:'6000'}]);
 expect(await snapshot(source.receivable)).toMatchObject({status:'cancelled',cash_received_cents:0,settled_cents:0,open_cents:0});expect(await money()).toEqual(before);
 const financialBefore=(await db.query('select to_jsonb(c) value from finance_customer_credits c order by id')).rows;await db.query('select finance_private.process_fiscal_observation($1,$2)',[i.tenant,obs.id]);expect((await db.query('select to_jsonb(c) value from finance_customer_credits c order by id')).rows).toEqual(financialBefore);
});

it('keeps a previous closed period immutable while compensating a fiscal cancellation in the current open day',async()=>{
 const source=await seedBalanceAdjustmentFiscalReceivable(db);const date=(await db.query<{v:string}>("select ((clock_timestamp() at time zone 'America/Sao_Paulo')::date-1)::text v")).rows[0].v;await db.query('update receivables set created_at=$1::date-1 where id=$2',[date,source.receivable]);await cash(source.receivable,6000,date);await write(await adjustment(source.receivable,'4000','discount',null,date));
 const previous=(await db.query<{v:string}>('select ($1::date-1)::text v',[date])).rows[0].v;const scope={account_id:i.account,from:date,to:date};
 const base=()=>({version:1,tenant_id:i.tenant,request_id:randomUUID(),reason:'Real closed period cancellation review'});
 async function rpc<T>(name:string,args:unknown[]){return(await financeAs<{v:T}>(db,i.operator,`select ${name}(${args.map((_,n)=>'$'+(n+1)).join(',')}) v`,args)).rows[0].v;}
 const movement=(await db.query<{id:string}>("select id from finance_movements where tenant_id=$1 and direction='in' order by created_at desc limit 1",[i.tenant])).rows[0].id;
 await seedAccountCloseStatement(db,previous,0);const statement=await seedAccountCloseStatement(db,date,6000,date,date,[{day:date,cents:6000}]);await db.exec('select finance_private.run_automatic_reconciliation_queue()');
 const recon=await rpc<{revision:string}>('get_finance_reconciliation_context',[i.tenant,[movement],statement.entryIds]);await rpc('reconcile_finance_bank_group',[{...base(),movement_ids:[movement],bank_entry_ids:statement.entryIds,expected_revision:recon.revision,account_evidence:'Real statement account checked'}]);
 for(const[writer,reader,extra]of[
  ['record_finance_account_opening','get_finance_statement_period_evidence',{}],
  ['record_finance_statement_coverage_approval','get_finance_statement_coverage_review',{originals_obtained_from_bank:true,complete_period_confirmed:true}],
  ['review_finance_legacy_cut','get_finance_legacy_cut_review',{sources_reviewed:true}],
 ]as const){const c=await rpc<{revision:string}>(reader,[i.tenant,i.account,date,date]);await rpc(writer,[{...base(),...scope,revision:c.revision,...extra}]);}
 const preview=await rpc<{revision:string,eligible:boolean,blockers:unknown[]}>('preview_finance_account_period_close',[i.tenant,i.account,date,date]);expect(preview.blockers).toEqual([]);expect(preview.eligible).toBe(true);const closed=await rpc<{closure_id:string}>('close_finance_account_period',[{...base(),...scope,revision:preview.revision}]);
 const frozen=(await db.query('select to_jsonb(c) value from finance_account_period_closures c where id=$1',[closed.closure_id])).rows;
 const original=(await db.query<{id:string}>("select id from finance_private.receivable_balance_adjustment_events where receivable_id=$1 and action='apply'",[source.receivable])).rows[0].id;
 const blocked=(await db.query<{v:{revision:string,eligible:boolean}}>('select finance_private.receivable_balance_adjustment_context($1,$2,$3,$4,$5,$6) v',[i.tenant,source.receivable,'discount','4000',date,original])).rows[0].v;expect(blocked.eligible).toBe(false);
 await db.exec('savepoint closed_manual');await expect(write({version:1,tenant_id:i.tenant,request_id:randomUUID(),receivable_id:source.receivable,action:'reverse',kind:'discount',adjustment_id:original,amount_cents:'4000',effective_on:date,expected_revision:blocked.revision,reason:'Manual reversal in closed period must fail'})).rejects.toThrow();await db.exec('rollback to savepoint closed_manual');
 const before=await money();const events=(await db.query("select to_jsonb(e) value from finance_private.receivable_balance_adjustment_events e where action='apply' order by id")).rows;
 await db.query("update hub_fiscal_emissions set status='cancelled',provider_document_version=2 where id=$1",[source.emission]);const obs=(await db.query<{id:string}>('select id from finance_fiscal_observations where emission_id=$1 order by observed_order desc limit 1',[source.emission])).rows[0].id;
 await db.query("select set_config('request.jwt.claim.sub','',true)");await db.query('select finance_private.run_fiscal_queue(50)');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[i.operator]);
 expect((await db.query<{status:string}>('select status from hub_fiscal_emissions where id=$1',[source.emission])).rows[0].status).toBe('cancelled');expect((await db.query<{v:string}>("select snapshot->>'status' v from finance_fiscal_observations where id=$1",[obs])).rows[0].v).toBe('cancelled');
 expect((await db.query('select status,issue,automatic_failures,last_error_code from finance_fiscal_projection_jobs where observation_id=$1',[obs])).rows[0]).toMatchObject({status:'applied',issue:null,automatic_failures:0,last_error_code:null});
 expect((await db.query("select to_jsonb(e) value from finance_private.receivable_balance_adjustment_events e where action='apply' order by id")).rows).toEqual(events);expect(await money()).toEqual(before);expect((await db.query<{v:string}>("select effective_on::text v from finance_private.receivable_balance_adjustment_events where receivable_id=$1 and action='reverse'",[source.receivable])).rows[0].v).toBe(await day());expect((await db.query('select to_jsonb(c) value from finance_account_period_closures c where id=$1',[closed.closure_id])).rows).toEqual(frozen);
});

it('injected local journal failure preserves captured fiscal truth and a durable worker retry atomically',async()=>{
 const source=await seedBalanceAdjustmentFiscalReceivable(db);await cash(source.receivable,6000);await write(await adjustment(source.receivable,'4000'));
 const before=await money();const events=(await db.query('select to_jsonb(e) value from finance_private.receivable_balance_adjustment_events e order by id')).rows;
 // Fault injection only in this rollback-only fixture. Existing guards remain active.
 await db.exec('set constraints all immediate;set constraints all deferred');
 await db.exec("alter table finance_private.receivable_balance_adjustment_events add constraint qa_reversal_fault check(action='apply')");
 await db.query("update hub_fiscal_emissions set status='cancelled',provider_document_version=2 where id=$1",[source.emission]);const obs=(await db.query<{id:string}>('select id from finance_fiscal_observations where emission_id=$1 order by observed_order desc limit 1',[source.emission])).rows[0].id;
 await db.query("select set_config('request.jwt.claim.sub','',true)");await db.query('select finance_private.run_fiscal_queue(50)');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[i.operator]);
 expect((await db.query<{v:string}>("select snapshot->>'status' v from finance_fiscal_observations where id=$1",[obs])).rows[0].v).toBe('cancelled');expect((await db.query<{status:string}>('select status from hub_fiscal_emissions where id=$1',[source.emission])).rows[0].status).toBe('cancelled');
 expect((await db.query('select status,issue,automatic_failures,last_error_code from finance_fiscal_projection_jobs where observation_id=$1',[obs])).rows[0]).toMatchObject({status:'pending',issue:'automatic_projection_retry',automatic_failures:1,last_error_code:'23514'});
 expect((await db.query('select to_jsonb(e) value from finance_private.receivable_balance_adjustment_events e order by id')).rows).toEqual(events);expect(await money()).toEqual(before);expect((await db.query<{n:number}>('select count(*)::int n from finance_customer_credits where receivable_id=$1',[source.receivable])).rows[0].n).toBe(0);
});

it('rejects effective dates before title existence or before the original adjustment without journal residue',async()=>{
 const id=await title(),today=await day(),yesterday=(await db.query<{v:string}>('select ($1::date-1)::text v',[today])).rows[0].v;
 const blocked=(await db.query<{v:{eligible:boolean,revision:string}}>('select finance_private.receivable_balance_adjustment_context($1,$2,$3,$4,$5,null) v',[i.tenant,id,'discount','1000',yesterday])).rows[0].v;expect(blocked.eligible).toBe(false);
 await db.exec('savepoint before_title');await expect(write({version:1,tenant_id:i.tenant,request_id:randomUUID(),receivable_id:id,action:'apply',kind:'discount',adjustment_id:null,amount_cents:'1000',effective_on:yesterday,expected_revision:blocked.revision,reason:'Reject effective date before source'})).rejects.toThrow();await db.exec('rollback to savepoint before_title');
 expect((await db.query<{n:number}>('select count(*)::int n from finance_private.receivable_balance_adjustment_events where receivable_id=$1',[id])).rows[0].n).toBe(0);
 await db.query('update receivables set created_at=$1::date-5 where id=$2',[today,id]);const applied=await write(await adjustment(id,'1000'));
 const early=(await db.query<{v:{eligible:boolean,revision:string}}>('select finance_private.receivable_balance_adjustment_context($1,$2,$3,$4,$5,$6) v',[i.tenant,id,'discount','1000',yesterday,applied.adjustment_id])).rows[0].v;expect(early.eligible).toBe(false);
 await db.exec('savepoint before_apply');await expect(write({version:1,tenant_id:i.tenant,request_id:randomUUID(),receivable_id:id,action:'reverse',kind:'discount',adjustment_id:applied.adjustment_id,amount_cents:'1000',effective_on:yesterday,expected_revision:early.revision,reason:'Reject reversal before original adjustment'})).rejects.toThrow();await db.exec('rollback to savepoint before_apply');
 expect((await db.query<{n:number}>('select count(*)::int n from finance_private.receivable_balance_adjustment_events where receivable_id=$1',[id])).rows[0].n).toBe(1);
});
it('propagates cash and discount separately through invoice and closing settlement and partial reopening',async()=>{
 const payer=randomUUID(),invoice=randomUUID(),closing=randomUUID(),id=randomUUID();
 await db.query("insert into clients(id,tenant_id,company_name,active) values($1,$2,'Adjustment invoice payer',true)",[payer,i.tenant]);
 await db.query("insert into client_invoices(id,tenant_id,client_id,receivable_id,total_amount,status,invoice_number,issue_date) values($1,$2,$3,$4,100,'generated','ADJUST-INVOICE',current_date)",[invoice,i.tenant,payer,id]);
 await db.query("insert into closing_reports(id,tenant_id,client_id,receivable_id,client_invoice_id,total_amount,received_amount,open_amount,status,payment_status,closing_number,title,report_type,report_model,period_start,period_end) values($1,$2,$3,$4,$5,100,0,100,'invoiced','unpaid','ADJUST-CLOSE','Adjustment closing','freight','standard','2026-01-01','2026-01-31')",[closing,i.tenant,payer,id,invoice]);
 await db.query("insert into receivables(id,tenant_id,client_id,client_invoice_id,closing_report_id,amount,received_amount,status,description) values($1,$2,$3,$4,$5,100,0,'invoiced','Coherent adjustment graph')",[id,i.tenant,payer,invoice,closing]);
 await cash(id,9000);const before=await money();const event=await write(await adjustment(id,'1000'));
 const contexts=async()=>Promise.all([
  financeAs<{v:Record<string,unknown>}>(db,i.operator,'select public.get_client_invoice_action_context($1,$2) v',[i.tenant,invoice]),
  financeAs<{v:Record<string,unknown>}>(db,i.operator,'select public.get_closing_report_action_context($1,$2) v',[i.tenant,closing]),
 ]);
 for(const r of await contexts())expect(r.rows[0].v).toMatchObject({cash_received_cents:9000,credit_applied_cents:0,discount_cents:1000,loss_cents:0,adjustment_cents:1000,settled_cents:10000,balance_adjustment_event_count:1});
 expect((await db.query('select status from client_invoices where id=$1',[invoice])).rows[0]).toMatchObject({status:'paid'});expect((await db.query('select payment_status,open_amount from closing_reports where id=$1',[closing])).rows[0]).toMatchObject({payment_status:'paid',open_amount:'0.00'});
 await write(await adjustment(id,'500','discount',event.adjustment_id));
 for(const r of await contexts())expect(r.rows[0].v).toMatchObject({cash_received_cents:9000,discount_cents:500,adjustment_cents:500,settled_cents:9500,balance_adjustment_event_count:2});
 expect(await snapshot(id)).toMatchObject({open_cents:500});expect(await money()).toEqual(before);
});
