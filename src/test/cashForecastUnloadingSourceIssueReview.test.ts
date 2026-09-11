// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {it,expect} from 'vitest';
import {createReceivableBalanceAdjustmentReviewDatabase,balanceAdjustmentReviewIds as i} from './helpers/receivableBalanceAdjustmentReviewDatabase';
import {seedUnloadingRepairSource} from './helpers/unloadingProjectionRepairDatabase';
it('diagnoses a real unloading legacy debtor mismatch before projecting future receipts',async()=>{
 const db=await createReceivableBalanceAdjustmentReviewDatabase();try{
 const published=JSON.parse(readFileSync('docs/qa/finance-cash-forecast-adjustment-predecessors-2026-09-11.json','utf8')) as Array<{proname:string,definition:string}>;
 for(const name of ['cash_forecast_collect','cash_forecast_collect_before_agenda'])await db.exec(published.find(p=>p.proname===name)!.definition);
 await db.exec(readFileSync('supabase/migrations/20260911115046_finance_receivable_balance_adjustments.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20260911115916_finance_cash_forecast_balance_adjustments.sql','utf8'));
 await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[i.operator]);await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);
 const source=await seedUnloadingRepairSource(db),other=randomUUID();await db.query("insert into clients(id,tenant_id,company_name,active) values($1,$2,'Wrong legacy debtor',true)",[other,i.tenant]);
 // Recreate the legacy pre205941 inconsistency only. Re-enable the source guard
 // before any proof/collector read. No function or monetary evidence is mocked.
 await db.exec('alter table public.receivables disable trigger a_unloading_receivable_source');
 await db.query('update public.receivables set client_id=$1 where tenant_id=$2 and id=$3',[other,i.tenant,source.receivable_id]);
 await db.exec('alter table public.receivables enable trigger a_unloading_receivable_source');
 const snapshot=(await db.query<{v:{source_issue:string,requires_reconciliation:boolean}}>('select public._receivable_financial_snapshot($1,$2) v',[i.tenant,source.receivable_id])).rows[0].v;
 expect(snapshot).toMatchObject({source_issue:'finance_unloading_source_mismatch',requires_reconciliation:false});
 const current=(await db.query<{definition:string}>("select pg_get_functiondef('finance_private.cash_forecast_collect_before_agenda(uuid,date,date)'::regprocedure) definition")).rows[0].definition;
 await db.exec(published.find(p=>p.proname==='cash_forecast_collect_before_agenda')!.definition);
 const previous=(await db.query<{v:{origins:Array<{source_id:string,valid:boolean,nominal_cents:string|null}>}}> ('select finance_private.cash_forecast_collect($1,current_date-1,current_date+30) v',[i.tenant])).rows[0].v;
 expect(previous.origins.find(r=>r.source_id===source.receivable_id)).toMatchObject({valid:true,nominal_cents:'15000'});
 await db.exec(current);
 const collected=(await db.query<{v:{origins:Array<{source_id:string,valid:boolean,nominal_cents:string|null}>}}> ('select finance_private.cash_forecast_collect($1,current_date-1,current_date+30) v',[i.tenant])).rows[0].v;
 expect(collected.origins.find(r=>r.source_id===source.receivable_id)).toMatchObject({valid:false,nominal_cents:null});
 await db.exec('rollback');
 }finally{await db.close();}
},60000);
