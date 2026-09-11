import {readFileSync} from 'node:fs';
import {createCustomerCreditRefundDatabase} from './customerCreditRefundDatabase';
/** Published order, including forecast02519 and composition04429 before refund04822. */
export async function createCustomerCreditRefundPublicDatabase(publish=true){const db=await createCustomerCreditRefundDatabase();try{
 await db.exec('revoke all on function public.apply_client_invoice_command(jsonb) from public,anon,service_role;grant execute on function public.apply_client_invoice_command(jsonb) to authenticated');
 for(const n of ['20260911102519_finance_cash_forecast_applied_credit_balance','20260911103921_finance_customer_credit_public_catalog'])await db.exec(readFileSync('supabase/migrations/'+n+'.sql','utf8'));
 const captured=JSON.parse(readFileSync('docs/qa/finance-credit-portfolio-predecessors-2026-09-11.json','utf8').replace(/^\uFEFF/,'')) as {functions:Array<{signature:string;definition:string}>};
 for(const f of captured.functions){await db.exec(f.definition);const sig=f.signature.includes('.')?f.signature:'public.'+f.signature;await db.exec('revoke all on function '+sig+' from public,anon,service_role;grant execute on function '+sig+' to authenticated');}
 for(const n of ['20260911104429_finance_customer_credit_portfolio_composition','20260911104822_finance_customer_credit_recorded_refunds'])await db.exec(readFileSync('supabase/migrations/'+n+'.sql','utf8'));
 if(publish)await db.exec(readFileSync('supabase/migrations/20260911110629_finance_customer_credit_refund_public_catalog.sql','utf8'));
 return db;
 }catch(error){await db.close();throw error;}}
