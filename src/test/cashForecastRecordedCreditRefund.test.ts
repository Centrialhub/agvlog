// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {it,expect} from 'vitest';
import {financeIds as i} from './helpers/financeLedgerDatabase';
import {createCustomerCreditRefundDatabase,seedCustomerCreditRefundSource} from './helpers/customerCreditRefundDatabase';
import {cashForecastCollectorSchema} from '@/lib/financial/cashForecastCollectorContract';
import {projectCollectedCashForecast} from '@/lib/financial/cashForecastCollectorProjection';

it('collects available credit after a recorded refund once and preserves the original forecast and bank facts',async()=>{
 const db=await createCustomerCreditRefundDatabase();try{
  // Production order matters:02519 pins01312;04822 extends the already published position later.
  await db.exec(readFileSync('supabase/migrations/20260911102519_finance_cash_forecast_applied_credit_balance.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20260911104822_finance_customer_credit_recorded_refunds.sql','utf8'));
  const {credit,target,day}=await seedCustomerCreditRefundSource(db);
  const outgoing=(await db.query<{v:{movement_id:string}}>('select public.record_finance_movement($1) v',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),bank_account_id:i.account,direction:'out',nature:'refund',amount_cents:20000,occurred_on:day,description:'Devolução já registrada para previsão',beneficiary_name:'Crédito para previsão',beneficiary_document:'11222333000181',reason:'Saída existente conferida antes da vinculação'}])).rows[0].v.movement_id;
  const collect=async()=>cashForecastCollectorSchema.parse((await db.query<{v:unknown}>('select finance_private.cash_forecast_collect($1,current_date-1,current_date+30) v',[i.tenant])).rows[0].v);
  const before=await collect();expect(before.unassigned_credit_cents).toBe('60000');expect(before.recorded_after_cutoff.filter(row=>row.movement_id===outgoing)).toHaveLength(1);
  const bank=async()=>(await db.query('select to_jsonb(b) v from bank_transactions b order by id')).rows;
  const payments=async()=>(await db.query('select to_jsonb(p) v from receivables_payments p order by id')).rows;
  const credits=async()=>(await db.query('select to_jsonb(c) v from finance_customer_credits c order by id')).rows;
  const originalBank=await bank(),originalPayments=await payments(),originalCredits=await credits();
  const saved=(await db.query<{v:{snapshot_id:string}}> ('select finance_private.record_cash_forecast_snapshot($1) v',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),cutoff:before.cutoff,period_end:before.period_end,source_revision:before.revision,title:'Antes da vinculação da devolução',reason:'Preservar a interpretação anterior do crédito'}])).rows[0].v;
  const originalSnapshot=(await db.query('select to_jsonb(s) v from finance_private.cash_forecast_snapshots s where id=$1',[saved.snapshot_id])).rows;
  const refundContext=(await db.query<{v:{revision:string,eligible:boolean}}> ('select finance_private.customer_credit_refund_context($1,$2,$3,$4) v',[i.tenant,credit,outgoing,'20000'])).rows[0].v;expect(refundContext.eligible).toBe(true);
  const refunded=(await db.query<{v:{refund_id:string}}> ('select finance_private.record_customer_credit_refund($1) v',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),credit_id:credit,outgoing_movement_id:outgoing,amount_cents:'20000',expected_revision:refundContext.revision,reason:'Vincular devolução existente ao crédito'}])).rows[0].v;
  const afterRefund=await collect();expect(afterRefund.unassigned_credit_cents).toBe('40000');expect(afterRefund.revision).not.toBe(before.revision);expect(afterRefund.recorded_after_cutoff).toEqual(before.recorded_after_cutoff);
  const apply=(await db.query<{v:{revision:string,eligible:boolean}}> ('select finance_private.customer_credit_application_context($1,$2,$3,$4,null) v',[i.tenant,credit,target,'40000'])).rows[0].v;expect(apply.eligible).toBe(true);
  await db.query('select finance_private.record_customer_credit_application($1)',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),credit_id:credit,receivable_id:target,application_id:null,action:'apply',amount_cents:'40000',expected_revision:apply.revision,reason:'Aplicar o saldo restante sem nova entrada'}]);
  const final=await collect();expect(final.unassigned_credit_cents).toBe('0');expect(final.credits.find(row=>row.credit_id===credit)).toMatchObject({valid:true,amount_cents:'0'});expect(final.revision).not.toBe(afterRefund.revision);
  expect(final.source_issues.some(row=>row.code==='unassigned_customer_credit')).toBe(false);
  expect(final.origins.find(row=>row.source_id===target)).toMatchObject({valid:true,nominal_cents:'50000',fulfilled_cents:'0',reserved_credit_cents:'40000'});
  expect(final.recorded_after_cutoff).toEqual(before.recorded_after_cutoff);
  const projected=projectCollectedCashForecast(final,final);expect(projected.projection).not.toBeNull();expect(projected.projection!.recorded_totals.out_cents).toBe('20000');expect(projected.projection!.scheduled.confirmed_in_cents).toBe('10000');
  expect((await db.query<{v:unknown}>('select finance_private.project_collected_cash_forecast($1) v',[final])).rows[0].v).toEqual(projected);
  const position=(await db.query<{v:{valid:boolean,original_cents:string,applied_cents:string,returned_cents:string,available_cents:string,refund_history:Array<{id:string}>}}> ('select finance_private.customer_credit_position($1,$2) v',[i.tenant,credit])).rows[0].v;
  expect(position).toMatchObject({valid:true,original_cents:'60000',applied_cents:'40000',returned_cents:'20000',available_cents:'0'});expect(position.refund_history.map(row=>row.id)).toEqual([refunded.refund_id]);
  expect(await bank()).toEqual(originalBank);expect(await payments()).toEqual(originalPayments);expect(await credits()).toEqual(originalCredits);expect((await db.query('select to_jsonb(s) v from finance_private.cash_forecast_snapshots s where id=$1',[saved.snapshot_id])).rows).toEqual(originalSnapshot);
  await db.exec('set constraints all immediate');await db.exec('rollback');
 }finally{await db.close();}
},30000);
