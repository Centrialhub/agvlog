// @vitest-environment node
import {it,expect} from 'vitest';
import {readFileSync,writeFileSync} from 'node:fs';
import {receivablePortfolioSchema} from '@/lib/financial/receivablePortfolioContract';
import {seedUnloadingRepairSource} from './helpers/unloadingProjectionRepairDatabase';
import {randomUUID} from 'node:crypto';
import {createReceivableBalanceAdjustmentReviewDatabase,balanceAdjustmentReviewIds as i} from './helpers/receivableBalanceAdjustmentReviewDatabase';
import {receivableAdjustmentPreviewSchema,receivableAdjustmentResultSchema,receivableAdjustmentHistorySchema} from '@/lib/financial/receivableAdjustmentContract';
it('parses actual adjustment, diagnostic and history DTOs while preserving the cash receipt',async()=>{
 const db=await createReceivableBalanceAdjustmentReviewDatabase();try{
  const sql=readFileSync('supabase/migrations/20260911115046_finance_receivable_balance_adjustments.sql','utf8');await db.exec(sql);
  await db.exec('begin');await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);await db.query("select set_config('request.jwt.claim.sub',$1,true)",[i.operator]);
  const id=(await db.query<{id:string}>("insert into receivables(tenant_id,amount,status,description) values($1,1000,'pending','Balance adjustment core') returning id",[i.tenant])).rows[0].id;
  const day=(await db.query<{day:string}>("select (statement_timestamp() at time zone 'America/Sao_Paulo')::date::text as day")).rows[0].day;
  const snap=(await db.query<{v:{revision:string}}>('select public._receivable_financial_snapshot($1,$2) v',[i.tenant,id])).rows[0].v;
  await db.query('select public.apply_receivable_financial_command($1)',[{version:1,tenant_id:i.tenant,actor_id:i.operator,request_id:randomUUID(),receivable_id:id,expected_revision:snap.revision,action:'receive',amount_cents:90000,bank_account_id:i.account,method:'pix',effective_date:day,reason:'Actual receipt before discount'}]);
  const money=(await db.query('select to_jsonb(b) row from bank_transactions b order by id')).rows;
  const preview=receivableAdjustmentPreviewSchema.parse((await db.query<{v:unknown}>('select finance_private.receivable_balance_adjustment_context($1,$2,$3,$4,$5,null) v',[i.tenant,id,'discount','10000',day])).rows[0].v);expect(preview.eligible).toBe(true);
  const payload={version:1,tenant_id:i.tenant,request_id:randomUUID(),receivable_id:id,action:'apply',kind:'discount',adjustment_id:null,amount_cents:'10000',effective_on:day,expected_revision:preview.revision,reason:'Authorized residual discount'};
  const result=receivableAdjustmentResultSchema.parse((await db.query<{v:unknown}>('select finance_private.record_receivable_balance_adjustment($1) v',[payload])).rows[0].v);
  expect(result.effects.after).toMatchObject({cash_received_cents:'90000',discount_cents:'10000',settled_cents:'100000',open_cents:'0'});
  expect((await db.query<{v:unknown}>('select finance_private.record_receivable_balance_adjustment($1) v',[payload])).rows[0].v).toEqual(result);
  const denied=receivableAdjustmentPreviewSchema.parse((await db.query<{v:unknown}>('select finance_private.receivable_balance_adjustment_context($1,$2,$3,$4,$5,null) v',[i.tenant,id,'loss','1',day])).rows[0].v);expect(denied.eligible).toBe(false);expect(denied.effects.after.open_cents).toBeNull();
  const history=receivableAdjustmentHistorySchema.parse((await db.query<{v:unknown}>('select finance_private.receivable_balance_adjustment_history($1,$2,$3) v',[i.tenant,id,{offset:0,limit:30,expected_revision:null}])).rows[0].v);expect(history.total).toBe(1);expect(history.rows[0].available_to_reverse_cents).toBe('10000');
  const portfolio=receivablePortfolioSchema.parse((await db.query<{v:unknown}>('select public.get_finance_receivable_portfolio_summary($1,null,null,null) v',[i.tenant])).rows[0].v);expect(portfolio).toMatchObject({totals_valid:true,cash_received_cents:'90000',discount_cents:'10000',loss_cents:'0',adjustment_cents:'10000',settled_cents:'100000',open_cents:'0'});
  const page=(await db.query<{v:{rows:Array<Record<string,unknown>>}}>("select public.get_finance_receivables_page($1,'','all',null,null,null,1) v",[i.tenant])).rows[0].v;expect(page.rows.find(r=>r.id===id)).toMatchObject({cash_received_cents:'90000',discount_cents:'10000',loss_cents:'0',adjustment_cents:'10000',settled_cents:'100000',open_cents:'0'});
  const catalog=(await db.query("select n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' signature,md5(replace(p.prosrc,E'\\r\\n',E'\\n')) normalized_md5,p.prosecdef,p.provolatile,p.proconfig,p.proacl::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='finance_private' and(p.proname like '%receivable%adjustment%' or p.proname in('receivable_credit_list_fields','receivable_portfolio_summary','customer_credit_application_context','release_receivable_customer_credits','audit_events'))) or(n.nspname='public' and p.proname in('_receivable_financial_snapshot','_receivable_ledger_evidence','_guard_receivable_ledger','_invoice_lifecycle_snapshot','get_closing_report_action_context')) order by 1")).rows;
  writeFileSync('docs/qa/finance-receivable-balance-adjustment-core-catalog-2026-09-11.json',JSON.stringify(catalog,null,2)+'\n','utf8');
  expect((await db.query('select to_jsonb(b) row from bank_transactions b order by id')).rows).toEqual(money);await db.exec('set constraints all immediate');await db.exec('rollback');
 }finally{await db.close();}
},60000);

it('uses the verified latest economic date of the same amended unloading instead of its original charge date',async()=>{
 const db=await createReceivableBalanceAdjustmentReviewDatabase();try{
  await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[i.operator]);await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);
  const source=await seedUnloadingRepairSource(db);
  const proposal={operation:'amend_origin',supplier_id:source.supplier,amount_cents:'12000',effective_on:'2026-08-05',collection_right_only:true};
  const context=(await db.query<{v:{revision:string;eligible:boolean}}>('select finance_private.unloading_origin_correction_context($1,$2,$3) v',[i.tenant,source.charge_id,proposal])).rows[0].v;expect(context.eligible).toBe(true);
  await db.query('select finance_private.correct_unloading_origin($1)',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),charge_id:source.charge_id,proposal,revision:context.revision,reason:'Verified later economic amendment'}]);
  await db.exec(readFileSync('supabase/migrations/20260911115046_finance_receivable_balance_adjustments.sql','utf8'));
  const anchor=(await db.query<{v:{minimum_effective_on:string;source_revision:string;verified:boolean}}>('select finance_private.receivable_adjustment_date_source($1,$2) v',[i.tenant,source.receivable_id])).rows[0].v;expect(anchor).toMatchObject({minimum_effective_on:'2026-08-05',verified:true});expect(anchor.source_revision).toMatch(/^[a-f0-9]{32}$/);
  const before=receivableAdjustmentPreviewSchema.parse((await db.query<{v:unknown}>('select finance_private.receivable_balance_adjustment_context($1,$2,$3,$4,$5,null) v',[i.tenant,source.receivable_id,'discount','1000','2026-08-04'])).rows[0].v);expect(before.eligible).toBe(false);expect(before.blockers.some(b=>b.code==='finance_adjustment_date_before_source')).toBe(true);
  const after=receivableAdjustmentPreviewSchema.parse((await db.query<{v:unknown}>('select finance_private.receivable_balance_adjustment_context($1,$2,$3,$4,$5,null) v',[i.tenant,source.receivable_id,'discount','1000','2026-08-05'])).rows[0].v);expect(after.eligible).toBe(true);
  await db.exec('set constraints all immediate');await db.exec('rollback');
 }finally{await db.close();}
},60000);
