import {readFileSync} from 'node:fs';
import {createCustomerCreditRefundDatabase} from './customerCreditRefundDatabase';
export {financeIds as portfolioReviewIds} from './financeLedgerDatabase';
export {seedCustomerCreditRefundSource} from './customerCreditRefundDatabase';

/** Actual full finance dependencies, published credit/refund readers, plus an immutable scalar oracle. */
export async function createReceivablePortfolioBulkReviewDatabase(){
 const db=await createCustomerCreditRefundDatabase();
 try{
  const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8');
  if(!(await db.query<{present:boolean}>("select to_regclass('public.closing_report_history') is not null present")).rows[0].present){
   await db.exec(baseline.match(/CREATE TABLE public\.closing_report_history \([\s\S]*?\n\);/)![0]);
   for(const match of baseline.matchAll(/ALTER TABLE ONLY public\.closing_report_history\n {4}ALTER COLUMN[\s\S]*?;/g))await db.exec(match[0]);
  }

  const captured=JSON.parse(readFileSync('docs/qa/finance-credit-portfolio-predecessors-2026-09-11.json','utf8').replace(/^\uFEFF/,'')) as {functions:Array<{signature:string;definition:string}>};
  for(const f of captured.functions){
   await db.exec(f.definition);
   const signature=f.signature.includes('.')?f.signature:'public.'+f.signature;
   await db.exec('revoke all on function '+signature+' from public,anon,service_role;grant execute on function '+signature+' to authenticated');
  }
  await db.exec(readFileSync('supabase/migrations/20260911104429_finance_customer_credit_portfolio_composition.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20260911104822_finance_customer_credit_recorded_refunds.sql','utf8'));
  const original=(await db.query<{body:string;hash:string}>("select pg_get_functiondef('finance_private.receivable_portfolio_summary(uuid,date,date,uuid)'::regprocedure) body,md5(replace(prosrc,E'\\r\\n',E'\\n')) hash from pg_proc where oid='finance_private.receivable_portfolio_summary(uuid,date,date,uuid)'::regprocedure")).rows[0];
  if(original.hash!=='57b41ad9b959e236163ecb2e2cc590ac')throw Error('Published scalar portfolio changed');
  await db.exec(original.body.replace('finance_private.receivable_portfolio_summary(', 'finance_private.receivable_portfolio_scalar_oracle('));
  await db.exec('revoke all on function finance_private.receivable_portfolio_scalar_oracle(uuid,date,date,uuid) from public,anon,service_role;grant execute on function finance_private.receivable_portfolio_scalar_oracle(uuid,date,date,uuid) to authenticated');
  return db;
 }catch(error){await db.close();throw error;}
}
