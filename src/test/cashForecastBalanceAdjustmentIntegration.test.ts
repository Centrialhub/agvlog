// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {it,expect} from 'vitest';
import {createReceivableBalanceAdjustmentReviewDatabase,balanceAdjustmentReviewIds as i} from './helpers/receivableBalanceAdjustmentReviewDatabase';
import {cashForecastCollectorSchema} from '@/lib/financial/cashForecastCollectorContract';
import {projectCollectedCashForecast} from '@/lib/financial/cashForecastCollectorProjection';
it('collects real discounts and reversals with cash unchanged and saved forecast preserved',async()=>{
 const db=await createReceivableBalanceAdjustmentReviewDatabase();try{
 // Base review fixture carries pre02519 forecast readers. Restore captured published readers exactly.
 const published=JSON.parse(readFileSync('docs/qa/finance-cash-forecast-adjustment-predecessors-2026-09-11.json','utf8')) as Array<{proname:string,definition:string}>;
 for(const name of ['cash_forecast_collect','cash_forecast_collect_before_agenda'])await db.exec(published.find(p=>p.proname===name)!.definition);
 await db.exec(readFileSync('supabase/migrations/20260911115046_finance_receivable_balance_adjustments.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20260911115916_finance_cash_forecast_balance_adjustments.sql','utf8'));
 await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[i.operator]);
 await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);
 const date=(await db.query<{v:string}>("select (clock_timestamp() at time zone 'America/Sao_Paulo')::date::text v")).rows[0].v;
 const target=(await db.query<{id:string}>("insert into receivables(tenant_id,amount,received_amount,status,description,due_date) values($1,1000,0,'pending','Actual forecast adjustment',current_date+5) returning id",[i.tenant])).rows[0].id;
 const snap=async()=>(await db.query<{v:{revision:string}}>('select public._receivable_financial_snapshot($1,$2) v',[i.tenant,target])).rows[0].v;
 await db.query('select public.apply_receivable_financial_command($1)',[{version:1,tenant_id:i.tenant,actor_id:i.operator,request_id:randomUUID(),receivable_id:target,action:'receive',amount_cents:90000,effective_date:date,bank_account_id:i.account,method:'pix',expected_revision:(await snap()).revision,reason:'Actual receipt before discount'}]);
 const collect=async()=>cashForecastCollectorSchema.parse((await db.query<{v:unknown}>('select finance_private.cash_forecast_collect($1,current_date-1,current_date+30) v',[i.tenant])).rows[0].v);
 const before=await collect();expect(before.origins.find(r=>r.source_id===target)).toMatchObject({fulfilled_cents:'90000',discount_cents:'0',adjustment_cents:'0'});
 const bank=async()=>(await db.query('select to_jsonb(b) v from bank_transactions b order by id')).rows;const money=await bank();
 const saved=(await db.query<{v:{snapshot_id:string}}>('select finance_private.record_cash_forecast_snapshot($1) v',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),cutoff:before.cutoff,period_end:before.period_end,source_revision:before.revision,title:'Before discount',reason:'Preserve existing forecast before adjustment'}])).rows[0].v;
 const savedRows=async()=>(await db.query('select to_jsonb(s) v from finance_private.cash_forecast_snapshots s where id=$1',[saved.snapshot_id])).rows;const original=await savedRows();
 const write=async(amount:string,adjustment:string|null=null)=>{const ctx=(await db.query<{v:{revision:string,eligible:boolean}}>('select finance_private.receivable_balance_adjustment_context($1,$2,$3,$4,$5,$6) v',[i.tenant,target,'discount',amount,date,adjustment])).rows[0].v;expect(ctx.eligible).toBe(true);return(await db.query<{v:{adjustment_id:string}}>('select finance_private.record_receivable_balance_adjustment($1) v',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),receivable_id:target,action:adjustment?'reverse':'apply',kind:'discount',adjustment_id:adjustment,amount_cents:amount,effective_on:date,expected_revision:ctx.revision,reason:'Audited adjustment for forecast'}])).rows[0].v;};
 const agendaCommand=async(revision:string)=>db.query('select finance_private.record_cash_forecast_agenda($1)',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),economic_key:'receivable:'+target,action:'set',expected_on:before.period_end,reason:'Reviewed expected receipt date',expected_revision:revision,cutoff:before.cutoff,period_end:before.period_end}]);
 await agendaCommand(before.revision);const scheduledBefore=await collect();expect(scheduledBefore.origins.find(r=>r.source_id===target)?.expected_date_source).toBe('reviewed_date');
 const applied=await write('10000');const after=await collect();expect(after.origins.find(r=>r.source_id===target)).toMatchObject({nominal_cents:'100000',fulfilled_cents:'90000',reserved_credit_cents:'0',discount_cents:'10000',loss_cents:'0',adjustment_cents:'10000',valid:true});expect(after.recorded_after_cutoff).toEqual(before.recorded_after_cutoff);
 const compare=async(c:typeof after)=>{const expected=projectCollectedCashForecast(c,c);expect((await db.query<{v:unknown}>('select finance_private.project_collected_cash_forecast($1) v',[c])).rows[0].v).toEqual(expected);return expected;};
 expect((await compare(after)).projection!.rows.find(r=>r.source_id===target)?.remaining_cents).toBe('0');
 expect(after.origins.find(r=>r.source_id===target)?.agenda?.stale).toBe(true);expect(after.source_issues.some(r=>r.code==='forecast_agenda_source_changed')).toBe(false);
 const agenda=(await db.query<{v:{eligible:boolean}}>('select finance_private.cash_forecast_agenda_preview($1,current_date-1,current_date+30,$2) v',[i.tenant,'receivable:'+target])).rows[0].v;expect(agenda.eligible).toBe(false);
 await write('5000',applied.adjustment_id);const reversed=await collect();expect((await compare(reversed)).projection!.rows.find(r=>r.source_id===target)?.remaining_cents).toBe('5000');expect(await bank()).toEqual(money);expect(await savedRows()).toEqual(original);
 expect(reversed.source_issues.some(r=>r.code==='forecast_agenda_source_changed')).toBe(true);expect((await compare(reversed)).projection!.unscheduled.confirmed_cents).toBe('5000');
 await agendaCommand(reversed.revision);const renewed=await collect();expect(renewed.origins.find(r=>r.source_id===target)?.agenda?.history).toHaveLength(2);expect(renewed.origins.find(r=>r.source_id===target)?.agenda?.stale).toBe(false);expect((await compare(renewed)).projection!.scheduled.confirmed_in_cents).toBe('5000');expect(await savedRows()).toEqual(original);
 await db.exec('set constraints all immediate');await db.exec('rollback');
 }finally{await db.close();}
},60000);
