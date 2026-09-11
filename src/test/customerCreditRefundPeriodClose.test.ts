// @vitest-environment node
import {randomUUID} from 'node:crypto';import {it,expect} from 'vitest';
import {createCustomerCreditRefundPublicDatabase} from './helpers/customerCreditRefundPublicDatabase';
import {seedCustomerCreditRefundSource} from './helpers/customerCreditRefundDatabase';
import {seedAccountCloseStatement} from './helpers/accountPeriodCloseDatabase';
import {financeIds as i,financeAs} from './helpers/financeLedgerDatabase';
import {customerCreditRefundPreviewSchema,customerCreditRefundResultSchema} from '@/lib/financial/customerCreditRefundContract';
it('real bank close prevents refund attribution until audited reopening, preserving the outgoing money',async()=>{
 const db=await createCustomerCreditRefundPublicDatabase();try{
  const source=await seedCustomerCreditRefundSource(db);const scope={account_id:i.account,from:'2026-08-01',to:'2026-08-31'};
  const base=()=>({version:1,tenant_id:i.tenant,request_id:randomUUID(),reason:'Real closed period customer refund review'});
  async function rpc<T>(name:string,args:unknown[]){return(await financeAs<{v:T}>(db,i.operator,`select ${name}(${args.map((_,n)=>'$'+(n+1)).join(',')}) v`,args)).rows[0].v;}
  const movement=await rpc<{movement_id:string}>('record_finance_movement',[{...base(),bank_account_id:i.account,direction:'out',nature:'refund',amount_cents:20000,occurred_on:'2026-08-10',description:'Customer refund recorded before bank closure',beneficiary_name:'Crédito para previsão',beneficiary_document:'11222333000181'}]);
  await seedAccountCloseStatement(db,'2026-07-31',100000);const statement=await seedAccountCloseStatement(db,'2026-08-31',80000,scope.from,scope.to,[{day:'2026-08-10',cents:-20000}]);
  await db.exec('select finance_private.run_automatic_reconciliation_queue()');
  const recon=await rpc<{revision:string}>('get_finance_reconciliation_context',[i.tenant,[movement.movement_id],statement.entryIds]);
  await rpc('reconcile_finance_bank_group',[{...base(),movement_ids:[movement.movement_id],bank_entry_ids:statement.entryIds,expected_revision:recon.revision,account_evidence:'Statement account and beneficiary verified'}]);
  for(const[writer,reader,extra]of[
   ['record_finance_account_opening','get_finance_statement_period_evidence',{}],
   ['record_finance_statement_coverage_approval','get_finance_statement_coverage_review',{originals_obtained_from_bank:true,complete_period_confirmed:true}],
   ['review_finance_legacy_cut','get_finance_legacy_cut_review',{sources_reviewed:true}],
  ]as const){const c=await rpc<{revision:string}>(reader,[i.tenant,i.account,scope.from,scope.to]);await rpc(writer,[{...base(),...scope,revision:c.revision,...extra}]);}
  const closePreview=await rpc<{revision:string;eligible:boolean;blockers:unknown[]}>('preview_finance_account_period_close',[i.tenant,i.account,scope.from,scope.to]);expect(closePreview.blockers).toEqual([]);expect(closePreview.eligible).toBe(true);
  const closed=await rpc<{closure_id:string;revision:string}>('close_finance_account_period',[{...base(),...scope,revision:closePreview.revision}]);
  const preview=async()=>customerCreditRefundPreviewSchema.parse(await rpc('preview_finance_customer_credit_refund',[i.tenant,source.credit,movement.movement_id,'20000']));
  const blocked=await preview();expect(blocked).toMatchObject({eligible:false,can_execute:false});expect(blocked.blockers).toContain('credit_refund_period_closed');
  const payload={...base(),credit_id:source.credit,outgoing_movement_id:movement.movement_id,amount_cents:'20000',expected_revision:blocked.revision};
  await expect(rpc('record_finance_customer_credit_refund',[payload])).rejects.toMatchObject({code:'23514',message:'finance_credit_refund_unavailable'});
  expect((await db.query<{n:number}>('select count(*)::int n from finance_private.customer_credit_refunds')).rows[0].n).toBe(0);
  const moneyBefore=(await db.query('select to_jsonb(m) v from finance_movements m where id=$1',[movement.movement_id])).rows;const bankBefore=(await db.query('select to_jsonb(b) v from bank_transactions b order by id')).rows;
  await rpc('reopen_finance_account_period',[{...base(),closure_id:closed.closure_id,revision:closed.revision}]);
  const current=await preview();expect(current).toMatchObject({eligible:true,can_execute:true,blockers:[]});expect(current.revision).not.toBe(blocked.revision);
  const result=customerCreditRefundResultSchema.parse(await rpc('record_finance_customer_credit_refund',[{...payload,request_id:randomUUID(),expected_revision:current.revision}]));expect(result).toMatchObject({cash_movement_created:false,amount_cents:'20000'});
  expect((await db.query('select to_jsonb(m) v from finance_movements m where id=$1',[movement.movement_id])).rows).toEqual(moneyBefore);expect((await db.query('select to_jsonb(b) v from bank_transactions b order by id')).rows).toEqual(bankBefore);
  expect((await db.query<{v:Record<string,unknown>}>('select finance_private.customer_credit_position($1,$2) v',[i.tenant,source.credit])).rows[0].v).toMatchObject({valid:true,returned_cents:'20000',available_cents:'40000'});
  await db.exec('set constraints all immediate;rollback');
 }finally{await db.close();}
},30000);
